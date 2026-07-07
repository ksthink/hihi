// 기상청 단기예보 — 산 위치 기준 시간대별 날씨 (흑백, 오프라인 스냅샷 지원).
// 도메인 로직(격자변환·발표시각·병합·아이콘)은 전부 여기 모아 iOS 이식 시 1:1 참조.
// 실제 API 호출은 CORS 때문에 프록시(/api/weather) 경유 — 네이티브는 직접 호출.

// ── 위경도 → 기상청 LCC 격자 (dfs_xy_conv) ──
export function dfsXy(lat, lon) {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30, SLAT2 = 60, OLON = 126, OLAT = 38, XO = 43, YO = 136;
  const D = Math.PI / 180, re = RE / GRID, s1 = SLAT1 * D, s2 = SLAT2 * D, ol = OLON * D, oa = OLAT * D;
  let sn = Math.tan(Math.PI * 0.25 + s2 * 0.5) / Math.tan(Math.PI * 0.25 + s1 * 0.5);
  sn = Math.log(Math.cos(s1) / Math.cos(s2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + s1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(s1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + oa * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * D * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * D - ol;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}

// ── KST 시각 · 발표시각 계산 ──
function kstNow() { return new Date(Date.now() + (new Date().getTimezoneOffset() * 60000) + 9 * 3600000); }
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

// 초단기예보: 매시 30분 발표, 45분 뒤 제공
function ultraBase() {
  const t = new Date(kstNow().getTime() - 45 * 60000);
  return { base_date: ymd(t), base_time: `${String(t.getHours()).padStart(2, "0")}30` };
}
// 단기예보: 02/05/08/11/14/17/20/23시 발표, +10분 제공
function vilageBase() {
  const t = new Date(kstNow().getTime() - 15 * 60000);
  const slots = [2, 5, 8, 11, 14, 17, 20, 23];
  const cand = slots.filter((s) => s <= t.getHours());
  if (cand.length) return { base_date: ymd(t), base_time: `${String(Math.max(...cand)).padStart(2, "0")}00` };
  const y = new Date(t.getTime() - 86400000);
  return { base_date: ymd(y), base_time: "2300" };
}

async function callKma(op, nx, ny, base) {
  const q = new URLSearchParams({ op, nx, ny, base_date: base.base_date, base_time: base.base_time });
  const r = await fetch(`/api/weather?${q}`);
  if (!r.ok) throw new Error("weather " + r.status);
  const d = await r.json();
  const items = d?.response?.body?.items?.item;
  if (!items) throw new Error("no items");
  return items;
}

// items → { "YYYYMMDDHHMM": {cat:val} } (fcst) 또는 실황
function byHour(items, fcst = true) {
  const m = {};
  for (const i of items) {
    const k = fcst ? i.fcstDate + i.fcstTime : "now";
    (m[k] ||= {})[i.category] = fcst ? i.fcstValue : i.obsrValue;
  }
  return m;
}

// ── 산 위치 시간대별 예보 조회 (초단기예보 + 단기예보 병합) ──
// 2시간 간격(지금·+2h·+4h…)으로 count 개. 반환: { baseLabel, hours: [...] }
export async function fetchWeather(lat, lon, { stepHours = 2, count = 8, spanHours = 24 } = {}) {
  const { nx, ny } = dfsXy(lat, lon);
  const [uf, vf] = await Promise.allSettled([
    callKma("ufcst", nx, ny, ultraBase()),  // 초단기예보(6h, 낙뢰 포함)
    callKma("vfcst", nx, ny, vilageBase()),  // 단기예보(오늘, POP·강수량)
  ]);
  const U = uf.status === "fulfilled" ? byHour(uf.value) : {};
  const V = vf.status === "fulfilled" ? byHour(vf.value) : {};
  if (!Object.keys(U).length && !Object.keys(V).length) throw new Error("예보 없음");

  const now = kstNow();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
  const num = (v) => (v == null || v === "" ? null : Number(v));
  const hours = [];
  for (let h = 0; h < spanHours && hours.length < count; h += stepHours) {
    const t = new Date(start.getTime() + h * 3600000);
    const key = ymd(t) + String(t.getHours()).padStart(2, "0") + "00";
    const u = U[key], v = V[key];
    if (!u && !v) continue;
    hours.push({
      key, hh: t.getHours(),
      tmp: num(u?.T1H) ?? num(v?.TMP),
      sky: num(u?.SKY) ?? num(v?.SKY),
      pty: num(u?.PTY) ?? num(v?.PTY) ?? 0,
      lgt: num(u?.LGT) ?? 0,               // 낙뢰(초단기 6h 만)
      pop: num(v?.POP),                    // 강수확률(단기만)
      pcp: v?.PCP && v.PCP !== "강수없음" ? v.PCP : (u?.RN1 && u.RN1 !== "강수없음" && num(u.RN1) ? u.RN1 : null),
      sno: v?.SNO && v.SNO !== "적설없음" ? v.SNO : null,
      wsd: num(u?.WSD) ?? num(v?.WSD),
    });
  }
  return { baseLabel: `${now.getHours()}시 기준`, savedAt: now.toISOString(), hours };
}

// ── 날씨 → 상태(아이콘 키·라벨). 우선순위: 낙뢰 > 강수 > 강풍 > 하늘 ──
export function weatherState(h) {
  if (h.lgt > 0) return { icon: "thunder", label: "낙뢰" };
  if (h.pty === 3) return { icon: "snow", label: "눈" };
  if (h.pty === 2) return { icon: "sleet", label: "비/눈" };
  if (h.pty === 1) return { icon: "rain", label: "비" };
  if (h.pty === 4) return { icon: "rain", label: "소나기" };
  if (h.wsd != null && h.wsd >= 9) return { icon: "wind", label: "강풍" };
  if (h.sky === 4) return { icon: "overcast", label: "흐림" };
  if (h.sky === 3) return { icon: "cloud", label: "구름많음" };
  return { icon: "sun", label: "맑음" };
}

// ── 흑백 SVG 아이콘 (currentColor stroke, 24뷰박스) ──
const P = (d, o = "") => `<path d="${d}" ${o}/>`;
const ICONS = {
  sun: `<circle cx="12" cy="12" r="4.4"/>${["M12 2.5v2.5", "M12 19v2.5", "M2.5 12H5", "M19 12h2.5", "M5.2 5.2l1.8 1.8", "M17 17l1.8 1.8", "M18.8 5.2L17 7", "M7 17l-1.8 1.8"].map((d) => P(d)).join("")}`,
  cloud: P("M7.5 18h9a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 10.2 3.9 3.9 0 0 0 7.5 18z"),
  overcast: P("M7.5 18h9a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 10.2 3.9 3.9 0 0 0 7.5 18z") + P("M4.5 14a3 3 0 0 1 1.2-2.3", 'opacity=".6"'),
  rain: P("M7.5 15h9a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 7.2 3.9 3.9 0 0 0 7.5 15z") + ["M8.5 17.5l-1 2.5", "M12 17.5l-1 2.5", "M15.5 17.5l-1 2.5"].map((d) => P(d)).join(""),
  snow: P("M7.5 15h9a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 7.2 3.9 3.9 0 0 0 7.5 15z") + ["M9 18.5v2.5M7.8 19.2l2.4 1.1M10.2 19.2l-2.4 1.1", "M15 18.5v2.5M13.8 19.2l2.4 1.1M16.2 19.2l-2.4 1.1"].map((d) => P(d)).join(""),
  sleet: P("M7.5 15h9a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 7.2 3.9 3.9 0 0 0 7.5 15z") + P("M8.5 17.5l-1 2.5") + P("M15 18.5v2.5M13.8 19.2l2.4 1.1M16.2 19.2l-2.4 1.1"),
  thunder: P("M7.5 14h9a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 6.2 3.9 3.9 0 0 0 7.5 14z") + P("M12 15l-2 3.5h2l-1.2 3 3.2-4h-2l1.2-2.5z", 'fill="currentColor" stroke="none"'),
  wind: ["M4 10h9a2.2 2.2 0 1 0-2.1-2.8", "M4 14h13a2.4 2.4 0 1 1-2.3 3.1", "M4 12h6"].map((d) => P(d)).join(""),
};
export function weatherIcon(iconKey, size = 22) {
  return `<svg class="wx-svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[iconKey] || ICONS.sun}</svg>`;
}

// ── 시간대별 스트립 렌더 ──
// data: fetchWeather 결과, opts.offline: 스냅샷(오프라인) 표시 여부
export function renderStrip(el, data, opts = {}) {
  if (!el) return;
  if (!data || !data.hours || !data.hours.length) {
    el.innerHTML = `<div class="wx-empty">날씨 정보를 불러올 수 없습니다.</div>`;
    return;
  }
  const now = new Date(Date.now() + 9 * 3600000);
  const nowHH = new Date(now.getTime() + now.getTimezoneOffset() * 60000).getHours();
  const chips = data.hours.map((h, i) => {
    const s = weatherState(h);
    const timeLabel = i === 0 ? "지금" : `${h.hh}시`;
    const precip = h.pty ? `<div class="wx-pop">${h.pop != null ? h.pop + "%" : ""}${h.pcp ? " · " + h.pcp : (h.sno ? " · " + h.sno : "")}</div>` : "";
    return `<div class="wx-chip${i === 0 ? " now" : ""}">
      <div class="wx-time">${timeLabel}</div>
      <div class="wx-ic" title="${s.label}">${weatherIcon(s.icon)}</div>
      <div class="wx-tmp">${h.tmp != null ? Math.round(h.tmp) + "°" : "–"}</div>
      ${precip}
    </div>`;
  }).join("");
  const note = opts.offline
    ? `<span class="wx-note">오프라인 · ${data.savedAt ? new Date(data.savedAt).getHours() + "시 저장" : "저장된 예보"}</span>`
    : `<span class="wx-note">${data.baseLabel || ""} · 가장 가까운 관측지 기준</span>`;
  el.innerHTML = `<div class="wx-strip">${chips}</div><div class="wx-foot">${note}</div>`;
}
