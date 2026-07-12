// 하이하잇 관리자 콘솔 — 코스 큐레이션·스팟 보정·팩 배포 (로컬 전용 도구)
import maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/+esm";
import { Protocol } from "https://cdn.jsdelivr.net/npm/pmtiles@3.2.1/+esm";
import { buildStyle, normPoiDisplay } from "../basemap-style.js";

const $ = (id) => document.getElementById(id);
const EMPTY = { type: "FeatureCollection", features: [] };

// 관리자 토큰 (원격 접속 시 /api 인증 — 서버 시작 로그의 ADMIN_TOKEN).
// /admin/?token=xxx 로 최초 진입하면 localStorage 에 저장 후 URL 에서 제거.
const TOKEN_KEY = "hiheight-admin-token";
let adminToken = localStorage.getItem(TOKEN_KEY) || "";
{
  const t = new URLSearchParams(location.search).get("token");
  if (t) {
    adminToken = t;
    localStorage.setItem(TOKEN_KEY, t);
    history.replaceState(null, "", location.pathname);
  }
}

const api = async (path, opts = {}) => {
  const headers = { ...(opts.headers || {}) };
  if (adminToken) headers["X-Admin-Token"] = adminToken;
  const r = await fetch("/api" + path, { ...opts, headers });
  const ct = r.headers.get("Content-Type") || "";
  const body = ct.includes("json") ? await r.json() : await r.text();
  if (r.status === 401) showLogin(); // 인증 만료/부재 → 로그인 게이트
  if (!r.ok) throw new Error(body.error || r.status);
  return body;
};

// ── 로그인 게이트 (비밀번호 → 토큰, 5회 실패 시 서버가 10분 잠금) ──
function showLogin() {
  $("login-overlay").hidden = false;
  $("login-pw").focus();
}
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("login-msg");
  msg.textContent = "";
  try {
    const r = await fetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("login-pw").value }),
    });
    const body = await r.json();
    if (!r.ok) { msg.textContent = body.error || r.status; $("login-pw").value = ""; return; }
    adminToken = body.token;
    localStorage.setItem(TOKEN_KEY, adminToken);
    location.reload(); // 토큰 확보 후 재부팅 (초기 로드 재실행)
  } catch (err) {
    msg.textContent = "로그인 실패: " + err.message;
  }
});

// ── 상태 ──
const S = {
  list: [],           // 초안 요약 목록
  code: null,         // 선택 산코드
  draft: null,        // 선택 산 draft
  selCourse: null,    // 선택 코스 id
  gpx: null,          // { text, candidate, raw } 업로드/매칭 미리보기
  addingPeak: false,  // ＋정상 추가 모드 (지도 클릭 대기)
  dirty: false,
  region: "전체",     // 선택된 지역 필터
};

// ── 지역 분류 (region 자유문자열 → 6권역) ──
// 우선순위 순서대로 첫 매칭 채택. 수도권(경기)을 전라(광주)보다 먼저 검사해
// "경기도 광주시" 같은 문자열이 전라로 잘못 분류되지 않게 한다.
const REGIONS = ["수도권", "강원", "충청", "전라", "경상", "제주"];
const REGION_KEYS = {
  수도권: ["서울", "인천", "경기"],
  강원: ["강원"],
  충청: ["충청", "충북", "충남", "대전", "세종"],
  전라: ["전라", "전북", "전남", "광주"],
  경상: ["경상", "경북", "경남", "부산", "울산", "대구"],
  제주: ["제주"],
};
const ALL = "전체";
function regionGroup(region) {
  const t = region || "";
  for (const g of REGIONS) if (REGION_KEYS[g].some((k) => t.includes(k))) return g;
  return "기타";
}

// ── 지도 ──
maplibregl.addProtocol("pmtiles", new Protocol().tile);
const map = new maplibregl.Map({
  container: "map",
  style: buildStyle(`${location.origin}/pmtiles/v4.pmtiles`, "light", `${location.origin}/pmtiles/kr-terrain.pmtiles`),
  center: [127.5, 36.5], zoom: 6.5,
  maxBounds: [[121.0, 31.0], [135.0, 40.5]], minZoom: 5,
  localIdeographFontFamily: "'Nanum Gothic Coding', 'Apple SD Gothic Neo', 'Malgun Gothic', monospace",
});
map.addControl(new maplibregl.NavigationControl({ showZoom: true }), "bottom-right");
window.__adminMap = map; // 디버그·헤드리스 테스트 훅 (앱 window.__map 과 동일 관례)

// 표시 설정 라이브 미리보기 상태 — bindDisplayCfg(아래 설정 편집기)가 값 변경 때마다 갱신.
// 편집 지도가 앱과 같은 모양(크기·볼드·기호·기저지도 POI)을 즉시 보여준다.
let spotCfgLive = null; // /config/spots categories (v2 객체)
let poiCfgLive = null;  // /config/poi categories

// 스팟 편집 레이어에 표시 설정 적용 (정상·장소 — 줌 게이트는 제외: 편집 중엔 항상 보여야 함).
// 우선순위: 스팟별 오버라이드(disp_*) > 분류 전역 설정 — 앱과 동일한 coalesce 규칙.
function applySpotEditorStyle() {
  if (!map.getLayer("spot-peak")) return;
  const cfg = spotCfgLive || {
    정상: { icon: true, size: 14.4, bold: true }, 장소: { icon: true, size: 8.9, bold: false },
  };
  const pk = cfg["정상"], pl = cfg["장소"];
  const font = (b) => [b ? "Nanum Gothic Coding Bold" : "Nanum Gothic Coding Regular"];
  // disp_bold 3상(true/false/없음→분류) — to-string: 없음(null)은 "" 로 떨어져 분류 폰트
  const fontExpr = (catBold) => ["match", ["to-string", ["get", "disp_bold"]],
    "true", ["literal", font(true)], "false", ["literal", font(false)], ["literal", font(catBold)]];
  map.setLayoutProperty("spot-peak", "text-field",
    ["concat", ["case", ["to-boolean", ["coalesce", ["get", "disp_icon"], pk.icon]], "▲", ""],
      ["coalesce", ["get", "name"], ""]]);
  map.setLayoutProperty("spot-peak", "text-font", fontExpr(pk.bold));
  map.setLayoutProperty("spot-peak", "text-size", // 앱과 동일: 부봉(main=false)은 비율 축소
    ["coalesce", ["get", "disp_size"],
      ["case", ["==", ["get", "main"], false], Math.round(pk.size * (11 / 14.4) * 10) / 10, pk.size]]);
  map.setFilter("spot-place-dot", ["all", ["==", ["get", "category"], "장소"],
    ["to-boolean", ["coalesce", ["get", "disp_icon"], pl.icon]]]);
  map.setLayoutProperty("spot-place-label", "text-font", fontExpr(pl.bold));
  map.setLayoutProperty("spot-place-label", "text-size", ["coalesce", ["get", "disp_size"], pl.size]);
}

// 기저지도 POI 설정 적용 — 스타일 재생성(앱과 동일 경로). styledata 가 편집 레이어 재부착.
// map "load" 를 기다리지 않는다: 이 지도는 전국 뷰 타일 로딩이 길어 load 가 매우 늦거나
// 안 올 수 있고, 인라인 스타일 객체 교체는 로드 중에도 안전함(실측 확인).
function applyPoiEditorStyle() {
  map.setStyle(buildStyle(`${location.origin}/pmtiles/v4.pmtiles`, "light",
    `${location.origin}/pmtiles/kr-terrain.pmtiles`, poiCfgLive));
}

// 편집 소스/레이어 부착 — 최초 styledata(초기 스타일)와 setStyle(설정 변경) 후 공용.
// map "load" 에 의존하지 않는다 (위 주석 참고).
let eventsWired = false;
map.on("styledata", () => {
  if (map.getSource("spots")) return;
  ensureEditorLayers();
  if (!eventsWired) { // 지도(map) 수준 바인딩 — 레이어 id 기준이라 setStyle 후에도 유효
    eventsWired = true;
    wireMapEvents();
  }
});

function ensureEditorLayers() {
  if (map.getSource("spots")) return;
  for (const id of ["contours", "network", "courses", "spots", "gpx-raw", "gpx-matched"])
    map.addSource(id, { type: "geojson", data: EMPTY });

  // 등고선 (앱과 동일 스키마: idx 0=50m 보조 / 1=100m 주곡선) — 편집 레이어 아래 배경
  map.addLayer({ id: "contour-line", type: "line", source: "contours", minzoom: 12.5,
    filter: ["==", ["get", "idx"], 0],
    paint: { "line-color": "#c4bfb5", "line-width": 0.5, "line-opacity": 0.5 } });
  map.addLayer({ id: "contour-index", type: "line", source: "contours", minzoom: 10.5,
    filter: ["==", ["get", "idx"], 1],
    paint: { "line-color": "#c4bfb5", "line-width": 1.1, "line-opacity": 0.7 } });
  map.addLayer({ id: "contour-label", type: "symbol", source: "contours", minzoom: 13.5,
    filter: ["==", ["get", "idx"], 1],
    layout: {
      "symbol-placement": "line", "text-field": ["concat", ["to-string", ["get", "elev"]], "m"],
      "text-font": ["Nanum Gothic Coding Regular"], "text-size": 8.4, "symbol-spacing": 300,
    },
    paint: { "text-color": "#8a857c", "text-halo-color": "#ffffff", "text-halo-width": 1.4 } });

  // 산림청 구간망 원본 — 회색 참조선 (GPX 매칭 결과 검토용 배경)
  map.addLayer({ id: "network-line", type: "line", source: "network",
    paint: { "line-color": "#c9c9c9", "line-width": 1.2 } });

  map.addLayer({ id: "courses-line", type: "line", source: "courses",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["case", ["==", ["get", "status"], "ready"], "#111111", "#9a9a9a"],
      "line-width": ["case", ["get", "sel"], 4.5, 2.2],
    } });
  map.addLayer({ id: "courses-hit", type: "line", source: "courses",
    paint: { "line-color": "#000", "line-opacity": 0.001, "line-width": 14 } });

  // GPX 미리보기: 원본(점선) / 매칭 결과(그래프=실선, gpx-fallback=대시)
  map.addLayer({ id: "gpx-raw-line", type: "line", source: "gpx-raw",
    paint: { "line-color": "#888", "line-width": 1.6, "line-dasharray": [1.5, 2] } });
  map.addLayer({ id: "gpx-match-graph", type: "line", source: "gpx-matched",
    filter: ["==", ["get", "src"], "graph"],
    layout: { "line-cap": "round" },
    paint: { "line-color": "#111", "line-width": 4 } });
  map.addLayer({ id: "gpx-match-gpx", type: "line", source: "gpx-matched",
    filter: ["==", ["get", "src"], "gpx"],
    paint: { "line-color": "#111", "line-width": 4, "line-dasharray": [1.2, 1.2] } });

  // 정상(▲)·장소(점+라벨) — 자동 시드(100대 API) + 수동 큐레이션 (스팟 섹션에서 편집)
  map.addLayer({ id: "spot-peak", type: "symbol", source: "spots",
    filter: ["==", ["get", "category"], "정상"],
    layout: {
      "text-field": ["concat", "▲", ["coalesce", ["get", "name"], ""]],
      "text-font": ["Nanum Gothic Coding Regular"],
      "text-size": 13, "text-offset": [0, -0.5], "text-anchor": "bottom",
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#111", "text-halo-color": "#fff", "text-halo-width": 1.6 } });
  map.addLayer({ id: "spot-place-dot", type: "circle", source: "spots",
    filter: ["==", ["get", "category"], "장소"],
    paint: { "circle-radius": 5, "circle-color": "#111",
             "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
  map.addLayer({ id: "spot-place-label", type: "symbol", source: "spots",
    filter: ["==", ["get", "category"], "장소"],
    layout: {
      "text-field": ["get", "name"], "text-font": ["Nanum Gothic Coding Regular"],
      "text-size": 11, "text-offset": [0, 0.8], "text-anchor": "top",
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#111", "text-halo-color": "#fff", "text-halo-width": 1.5 } });

  applySpotEditorStyle(); // 표시 설정(크기·볼드·기호)이 이미 로드됐으면 즉시 반영
  if (S.draft) { // 지도 로드 전에 산을 선택했거나 setStyle 재부착이면 데이터 재주입
    renderCourses();
    renderPeaks();
    loadNetwork(S.code);
    loadContours(S.code);
  }
}

// ── draft 저장 (디바운스 자동저장) ──
let saveTimer = null;
function markDirty() {
  S.dirty = true;
  $("save-state").textContent = "저장 대기…";
  $("save-state").className = "dirty";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 800);
}
async function saveDraft() {
  if (!S.dirty || !S.code) return;
  try {
    await api(`/mountains/${S.code}/draft`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(S.draft),
    });
    S.dirty = false;
    $("save-state").textContent = "저장됨 ✓";
    $("save-state").className = "";
  } catch (e) {
    $("save-state").textContent = "저장 실패: " + e.message;
  }
}

// ── 산 검색/추가 ──
let qTimer = null;
$("mnt-q").addEventListener("input", () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(async () => {
    const q = $("mnt-q").value.trim();
    const box = $("mnt-results");
    if (!q) { box.hidden = true; return; }
    const rows = await api(`/mnt-codes?q=${encodeURIComponent(q)}`);
    box.innerHTML = "";
    for (const m of rows) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="nm ${m.has_src ? "" : "no-src"}">${m.name}${m.top100 ? ' <span class="badge b100">100대</span>' : ""}</span>
        <span class="dim">${m.region || ""} ${m.elev ? m.elev + "m" : ""} · ${m.code}</span>`;
      const btn = document.createElement("button");
      if (m.has_draft) { btn.textContent = "관리 중"; btn.disabled = true; }
      else if (!m.has_src) { btn.textContent = "원본 없음"; btn.disabled = true; btn.title = "mountain/<산코드>/ 에 산림청 원본이 없음"; }
      else { btn.textContent = "추가"; btn.onclick = () => addMountain(m.code); }
      li.appendChild(btn);
      box.appendChild(li);
    }
    if (!rows.length) box.innerHTML = `<li><span class="dim">검색 결과 없음</span></li>`;
    box.hidden = false;
  }, 250);
});

async function addMountain(code) {
  const r = await api("/mountains", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  $("mnt-results").hidden = true;
  $("mnt-q").value = "";
  await refreshList();
  await selectMountain(code);
  if (r.job_id) pollJob(r.job_id, async () => {
    if (S.code === code) await selectMountain(code); // 자동 시드 반영
  });
}

// ── 초안 목록 (지역 필터 + 권역별 그룹) ──
async function refreshList() {
  S.list = await api("/mountains");
  renderRegionTabs();
  renderDraftList();
}

// 지역 필터 탭 — 전체 + 6권역(+데이터에 있으면 기타). 각 버튼에 개수 표시.
function renderRegionTabs() {
  const counts = { [ALL]: S.list.length };
  for (const m of S.list) {
    const g = regionGroup(m.region);
    counts[g] = (counts[g] || 0) + 1;
  }
  const groups = [ALL, ...REGIONS, ...(counts["기타"] ? ["기타"] : [])];
  if (!groups.includes(S.region)) S.region = ALL; // 기타가 사라진 경우 등 폴백
  const tabs = $("region-tabs");
  tabs.innerHTML = "";
  for (const g of groups) {
    const n = counts[g] || 0;
    const b = document.createElement("button");
    b.className = (g === S.region ? "active " : "") + (n === 0 && g !== ALL ? "empty" : "");
    b.innerHTML = `${g}<span class="cnt">${n}</span>`;
    b.onclick = () => { S.region = g; renderRegionTabs(); renderDraftList(); };
    tabs.appendChild(b);
  }
}

function renderDraftList() {
  const ul = $("draft-list");
  ul.innerHTML = "";
  let items = S.list.map((m) => ({ ...m, group: regionGroup(m.region) }));
  if (S.region !== ALL) items = items.filter((m) => m.group === S.region);
  const gi = (g) => { const i = REGIONS.indexOf(g); return i < 0 ? 99 : i; }; // 기타는 맨 뒤
  items.sort((a, b) => gi(a.group) - gi(b.group)
    || (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, "ko"));
  if (!items.length) {
    ul.innerHTML = `<li class="empty-note dim">이 지역에 관리 중인 산이 없습니다.</li>`;
    return;
  }
  const showHeads = S.region === ALL; // 전체 볼 때만 권역 소제목 삽입
  let curGroup = null;
  for (const m of items) {
    if (showHeads && m.group !== curGroup) {
      curGroup = m.group;
      const h = document.createElement("li");
      h.className = "region-head";
      h.textContent = curGroup;
      ul.appendChild(h);
    }
    const li = document.createElement("li");
    li.className = m.code === S.code ? "sel" : "";
    const pub = m.publish?.pack_version ? `v${m.publish.pack_version}` : "미배포";
    li.innerHTML = `<div><div class="nm">${m.name}</div>
      <div class="meta">코스 공개 ${m.ready}/${m.courses} · ${pub}
      ${m.published ? "" : '<span class="unpub">비공개</span>'}</div></div>
      <span class="dim">${m.code}</span>`;
    li.onclick = () => selectMountain(m.code);
    ul.appendChild(li);
  }
}

// ── 산 선택 ──
async function selectMountain(code) {
  await saveDraft();
  S.code = code;
  S.selCourse = null; S.gpx = null;
  S.draft = await api(`/mountains/${code}/draft`);
  if (renumberCourses()) markDirty(); // 레거시 초안(번호 없음·구멍)도 순서 기준으로 정규화
  $("sec-mnt").hidden = false;
  $("sec-mnt-empty").hidden = true;
  clearGpxPreview();
  renderMountain();
  refreshList();
  const b = S.draft.mountain.bbox;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 30, duration: 600 });
  loadNetwork(code);
  loadContours(code); // 비동기 — 미배포 산은 첫 요청에 생성되어 늦게 뜰 수 있음
}

async function loadNetwork(code) {
  const src = map.getSource("network"); // 지도 로드 전이면 map load 핸들러가 재시도
  if (!src) return;
  try {
    src.setData(await api(`/mountains/${code}/network`));
  } catch (_) { src.setData(EMPTY); } // 원본 없는 legacy 산
}

async function loadContours(code) {
  const src = map.getSource("contours");
  if (!src) return;
  src.setData(EMPTY); // 산 전환 시 이전 등고선 즉시 제거 (생성 대기 중 오표시 방지)
  try {
    const fc = await api(`/mountains/${code}/contours`); // 미배포 산은 첫 요청에 즉석 생성(수 초)
    if (S.code === code) src.setData(fc); // 응답 사이 산이 바뀌었으면 버림
  } catch (_) { /* 등고선은 배경 참조용 — 실패해도 무시 */ }
}

function renderMountain() {
  const m = S.draft.mountain;
  $("mnt-title").textContent = `${m.name} (${m.code})`;
  $("m-name").value = m.name || "";
  $("m-region").value = m.region || "";
  $("m-elev").value = m.elev ?? "";
  $("m-sort").value = m.sort_order ?? 100;
  $("m-famous").checked = !!m.famous;
  $("m-bac100").checked = (m.lists || []).includes("bac100");
  $("m-knps").checked = (m.lists || []).includes("knps");
  $("m-published").checked = !!m.published;
  const p = S.draft.publish;
  $("pub-info").textContent = p?.pack_version
    ? `현재 v${p.pack_version}${p.published_at ? " · " + p.published_at.slice(0, 16) : ""}${p.pack_size_kb ? " · " + Math.round(p.pack_size_kb / 1024) + "MB" : ""}`
    : "아직 배포되지 않음";
  renderCourses();
  renderPeaks();
}

for (const [id, key, cast] of [["m-region", "region", String], ["m-elev", "elev", Number],
  ["m-sort", "sort_order", Number], ["m-famous", "famous", Boolean], ["m-published", "published", Boolean]]) {
  $(id).addEventListener("change", (e) => {
    const v = cast === Boolean ? e.target.checked : cast(e.target.value);
    S.draft.mountain[key] = (cast === Number && Number.isNaN(v)) ? null : v;
    markDirty(); refreshList();
  });
}

// 공식 추천 카테고리 체크박스 → mountain.lists 배열 (famous=100대 명산은 별도 컬럼 유지)
for (const [id, key] of [["m-bac100", "bac100"], ["m-knps", "knps"]]) {
  $(id).addEventListener("change", (e) => {
    const l = new Set(S.draft.mountain.lists || []);
    if (e.target.checked) l.add(key); else l.delete(key);
    S.draft.mountain.lists = [...l];
    markDirty();
  });
}

// 이름 편집 (등록 후에도 변경 가능) — 빈 이름 방지 + 제목·목록 즉시 반영
$("m-name").addEventListener("change", (e) => {
  const m = S.draft.mountain;
  const v = e.target.value.trim();
  if (!v) { e.target.value = m.name || ""; return; } // 빈 이름은 무시하고 원복
  m.name = v;
  $("mnt-title").textContent = `${v} (${m.code})`;
  const row = S.list.find((x) => x.code === m.code); // 재조회 없이 목록 즉시 갱신
  if (row) { row.name = v; renderRegionTabs(); renderDraftList(); }
  markDirty();
});

// ── 코스 ──
// 코스 번호 = "공개 코스" 기준 목록 순서 (위에서부터 1). 비공개는 null(표시 '–') —
// 배포 팩에는 공개만 실리므로 앱 번호가 1..N 연속이 되게 한다.
// 추가·삭제·드래그 정렬·공개/비공개 전환 때마다 재부여.
function renumberCourses() {
  let changed = false, n = 1;
  (S.draft?.courses || []).forEach((c) => {
    const want = c.status === "ready" ? n++ : null;
    if (c.no !== want) { c.no = want; changed = true; }
  });
  return changed;
}

function courseFC() {
  return { type: "FeatureCollection", features: (S.draft?.courses || []).map((c) => ({
    type: "Feature",
    geometry: { type: "MultiLineString", coordinates: c.lines },
    properties: { id: c.id, status: c.status, sel: c.id === S.selCourse },
  })) };
}

function renderCourses() {
  if (map.getSource("courses")) map.getSource("courses").setData(courseFC());
  const cs = S.draft.courses;
  $("course-count").textContent = `(${cs.filter((c) => c.status === "ready").length}/${cs.length} 공개)`;
  const ul = $("course-list");
  ul.innerHTML = "";
  for (const c of cs) {
    const li = document.createElement("li");
    li.className = (c.id === S.selCourse ? "sel " : "") + (c.status === "ready" ? "" : "off");
    li.dataset.id = c.id;
    // 출처 배지는 GPX 일치율만 (품질 신호) — 기존/수작업/자동 표기는 정보 가치가 없어 생략
    const src = c.source?.type === "gpx" ? `매칭 ${Math.round((c.source.matched_ratio ?? 0) * 100)}%` : null;
    const k = c.computed || {};
    li.innerHTML = `
      <div class="c-head">
        <span class="c-grip" title="드래그해서 순서 변경 (번호가 순서를 따라감)">⠿</span>
        <span class="c-no${c.no == null ? " off" : ""}" title="${c.no == null ? "비공개 — 배포에서 제외" : "앱 표시 번호"}">${c.no ?? "–"}</span>
        <input class="c-name" title="클릭해서 코스명 수정" value="${(c.name || "").replace(/"/g, "&quot;")}" />
        ${src ? `<span class="badge gpx">${src}</span>` : ""}
        <span class="badge ${c.status === "ready" ? "ready" : ""}">${c.status === "ready" ? "공개" : "비공개"}</span>
      </div>
      <div class="c-meta">${c.difficulty} · ${k.distance_km ?? "?"}km · ↑${k.ascent ?? "?"}m · ${k.min_elev ?? "?"}~${k.max_elev ?? "?"}m</div>
      <div class="c-tools row">
        <select class="c-diff">${["초급", "중급", "고급"].map((d) =>
          `<option ${d === c.difficulty ? "selected" : ""}>${d}</option>`).join("")}</select>
        <button class="c-status" title="배포 시 앱 노출 여부 (데이터는 보존)">${c.status === "ready" ? "비공개로" : "공개로"}</button>
        <button class="c-flip" title="시점과 종점을 서로 바꿉니다 (통계 재계산)">시점↔종점</button>
        <button class="c-recompute" title="거리·프로파일·난이도 재계산">재계산</button>
        <button class="c-del danger">삭제</button>
        <input class="c-desc" placeholder="설명" value="${(c.desc || "").replace(/"/g, "&quot;")}" />
      </div>`;
    li.onclick = (e) => { if (e.target.tagName !== "INPUT" && e.target.tagName !== "SELECT" && e.target.tagName !== "BUTTON" && !e.target.closest(".c-grip")) selectCourse(c.id, true); };
    li.querySelector(".c-name").addEventListener("change", (e) => { c.name = e.target.value.trim(); markDirty(); });
    li.querySelector(".c-name").addEventListener("focus", () => selectCourse(c.id, false)); // DOM 재생성 없음 — 편집 유지
    li.querySelector(".c-diff").addEventListener("change", (e) => { c.difficulty = e.target.value; markDirty(); renderCourses(); });
    li.querySelector(".c-desc").addEventListener("change", (e) => { c.desc = e.target.value.trim() || null; markDirty(); });
    li.querySelector(".c-status").onclick = () => {
      c.status = c.status === "ready" ? "draft" : "ready";
      renumberCourses(); // 번호는 공개 코스 기준 연번 — 전환 즉시 재부여
      markDirty(); renderCourses(); refreshList();
    };
    li.querySelector(".c-flip").onclick = async () => {
      // 등록 후 시점↔종점 수동 변경 — 방향 뒤집고 통계 재계산(오르막/프로파일이 방향 의존)
      c.lines = c.lines.map((ln) => ln.slice().reverse()).reverse();
      markDirty();
      await saveDraft();
      const upd = await api(`/mountains/${S.code}/courses/${c.id}/recompute`, { method: "POST" });
      Object.assign(c, upd);
      renderCourses();
    };
    li.querySelector(".c-recompute").onclick = async () => {
      await saveDraft();
      const upd = await api(`/mountains/${S.code}/courses/${c.id}/recompute`, { method: "POST" });
      Object.assign(c, upd);
      renderCourses();
    };
    li.querySelector(".c-del").onclick = () => {
      if (!confirm(`코스 "${c.name}" 삭제?`)) return;
      S.draft.courses = S.draft.courses.filter((x) => x.id !== c.id);
      if (S.selCourse === c.id) S.selCourse = null;
      renumberCourses(); // 남은 코스 번호 당김 (위에서부터 1)
      markDirty(); renderCourses(); refreshList();
    };
    // 드래그 정렬 — 그립을 잡았을 때만 draggable (이름 입력 등 텍스트 선택과 충돌 방지)
    const grip = li.querySelector(".c-grip");
    grip.addEventListener("mousedown", () => { li.draggable = true; });
    grip.addEventListener("mouseup", () => { li.draggable = false; });
    li.addEventListener("dragstart", (e) => {
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", c.id); // Firefox 는 데이터 없으면 드래그 미시작
    });
    li.addEventListener("dragend", () => {
      li.draggable = false;
      li.classList.remove("dragging");
      commitCourseOrder();
    });
    ul.appendChild(li);
  }
}

// 드래그 중 마우스 위치에 따라 li 를 목록에서 이동 (ul 은 고정 요소 — 1회만 연결)
$("course-list").addEventListener("dragover", (e) => {
  e.preventDefault();
  const ul = $("course-list");
  const dragging = ul.querySelector("li.dragging");
  if (!dragging) return;
  const next = [...ul.querySelectorAll("li:not(.dragging)")].find((li) => {
    const r = li.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2;
  });
  if (next) ul.insertBefore(dragging, next);
  else ul.appendChild(dragging);
});

// 드롭 결과(DOM 순서)를 draft 배열에 반영 + 번호 재부여
function commitCourseOrder() {
  const order = [...$("course-list").querySelectorAll("li")].map((li) => li.dataset.id);
  S.draft.courses.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  if (renumberCourses()) markDirty();
  renderCourses();
}

// 선택 표시만 갱신 (목록 DOM 은 재생성하지 않음 — 이름 입력 포커스가 죽지 않도록)
function updateCourseSelection() {
  if (map.getSource("courses")) map.getSource("courses").setData(courseFC());
  document.querySelectorAll("#course-list li").forEach((li) =>
    li.classList.toggle("sel", li.dataset.id === S.selCourse));
}

function selectCourse(id, fit) {
  S.selCourse = id;
  updateCourseSelection();
  const c = S.draft.courses.find((x) => x.id === id);
  if (c && fit) {
    const pts = c.lines.flat();
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]],
      { padding: 60, duration: 500 });
  }
  document.querySelector(`#course-list li[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
}

// ── GPX 업로드/매칭 ──
// 1개 = 기존 미리보기 흐름 / 여러 개·폴더 = 일괄 등록 (비공개로 추가, 파일별 결과 리포트)
async function handleTrackFiles(fileList) {
  const EXTS = [".gpx", ".geojson", ".json", ".zip", ".shp"];
  const files = [...fileList]
    .filter((f) => EXTS.some((e) => f.name.toLowerCase().endsWith(e)))
    .filter((f) => !f.name.startsWith("PMNTN_SPOT_")) // 산림청 스팟 원본은 코스 아님 — 제외
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  if (!files.length) { alert("가져올 수 있는 파일(GPX·GeoJSON·SHP/ZIP)이 없습니다."); return; }

  if (files.length === 1) {
    // SHP/ZIP 은 바이너리 — 텍스트가 아닌 ArrayBuffer 로 전송 (GPX/GeoJSON 도 동일 경로)
    S.gpx = { data: await files[0].arrayBuffer(), name: files[0].name };
    await runMatch();
    return;
  }

  const rep = $("gpx-report");
  rep.hidden = false;
  $("gpx-actions").hidden = true;
  const results = [];
  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    rep.textContent = `일괄 등록 중… ${i + 1}/${files.length} — ${f.name}`;
    try {
      const r = await api(`/mountains/${S.code}/gpx?name=${encodeURIComponent(f.name)}`, {
        method: "POST", headers: { "Content-Type": "application/octet-stream" },
        body: await f.arrayBuffer(),
      });
      S.draft.courses.push(r.course);
      ok++;
      results.push(`✓ ${f.name} → ${r.course.name} · 매칭 ${Math.round((r.report.matched_ratio ?? 0) * 100)}% · ${r.report.distance_km}km`);
    } catch (err) {
      results.push(`<span class="warn">✗ ${f.name} — ${err.message}</span>`);
    }
  }
  renumberCourses();
  markDirty(); renderCourses(); refreshList();
  rep.innerHTML = `<b>일괄 등록 ${ok}/${files.length}</b> — 비공개로 추가됨. 목록에서 확인 후 공개하세요.<br>` +
    results.join("<br>");
}

$("gpx-file").addEventListener("change", async (e) => {
  if (e.target.files.length) await handleTrackFiles(e.target.files);
  e.target.value = ""; // 같은 파일/폴더 재선택 허용
});
$("gpx-dir-btn").onclick = () => $("gpx-dir").click();
$("gpx-dir").addEventListener("change", async (e) => {
  if (e.target.files.length) await handleTrackFiles(e.target.files);
  e.target.value = "";
});
$("gpx-cancel").onclick = () => { S.gpx = null; clearGpxPreview(); };
$("gpx-accept").onclick = () => {
  if (!S.gpx?.candidate) return;
  S.draft.courses.push(S.gpx.candidate);
  renumberCourses(); // 새 코스는 비공개 시작 → 번호 '–', 공개 전환 시 연번 부여
  S.selCourse = S.gpx.candidate.id;
  S.gpx = null;
  clearGpxPreview();
  markDirty(); renderCourses(); refreshList();
};

async function runMatch() {
  if (!S.gpx) return;
  $("gpx-report").hidden = false;
  $("gpx-report").textContent = "매칭 중…";
  try {
    const r = await api(`/mountains/${S.code}/gpx?name=${encodeURIComponent(S.gpx.name || "")}`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: S.gpx.data,
    });
    S.gpx.candidate = r.course;
    map.getSource("gpx-raw").setData(r.preview.raw);
    map.getSource("gpx-matched").setData(r.preview.matched);
    const rep = r.report;
    const fb = rep.fallbacks.length
      ? `<div class="warn">구간망 밖 ${rep.fallbacks.length}곳 (GPX 원 좌표 유지): ${rep.fallbacks.map((f) => f.km + "km").join(", ")}</div>`
      : "<div>전 구간 구간망 매칭 ✓</div>";
    $("gpx-report").innerHTML =
      `매칭률 <b>${Math.round(rep.matched_ratio * 100)}%</b> · ${rep.distance_km}km · ↑${rep.ascent}m · 최대이탈 ${Math.round(rep.max_dev_m)}m ${fb}`;
    $("gpx-actions").hidden = false;
    const pts = r.preview.raw.features[0].geometry.coordinates;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]],
      { padding: 60, duration: 500 });
  } catch (err) {
    $("gpx-report").innerHTML = `<span class="warn">매칭 실패: ${err.message}</span>`;
    $("gpx-actions").hidden = true;
  }
}

function clearGpxPreview() {
  for (const s of ["gpx-raw", "gpx-matched"]) map.getSource(s)?.setData(EMPTY);
  $("gpx-report").hidden = true;
  $("gpx-actions").hidden = true;
  $("gpx-file").value = "";
}

// ── 스팟 (정상·장소 — 자동 시드 + 수동 큐레이션: 추가·이름·분류·주봉·좌표·이동·삭제) ──
const EDIT_CATS = ["정상", "장소"];
const editSpots = () => (S.draft?.spots || []).filter((s) => EDIT_CATS.includes(s.category) && !s.deleted);
const peakSpots = () => editSpots().filter((s) => s.category === "정상");

function renderPeakMap() {
  if (!map.getSource("spots")) return;
  map.getSource("spots").setData({ type: "FeatureCollection",
    features: editSpots().map((s) => ({ type: "Feature",
      geometry: { type: "Point", coordinates: s.coord },
      properties: {
        id: s.id, category: s.category, name: s.name || "", main: s.main,
        // 스팟별 표시 오버라이드 — 편집 지도 미리보기 표현식(coalesce)이 소비
        ...(s.disp_icon != null && { disp_icon: s.disp_icon }),
        ...(s.disp_size != null && { disp_size: s.disp_size }),
        ...(s.disp_bold != null && { disp_bold: s.disp_bold }),
      } })) });
}

// 정상→장소 전환·주봉 삭제 후에도 정상이 남아 있으면 주봉 1점을 보장
function ensureMain() {
  const pk = peakSpots();
  if (pk.length && !pk.some((x) => x.main)) pk[0].main = true;
}

function renderPeaks() {
  renderPeakMap();
  const ul = $("peak-list");
  ul.innerHTML = "";
  $("peak-count").textContent = `(정상 ${peakSpots().length} · 장소 ${editSpots().length - peakSpots().length})`;
  for (const s of editSpots()) {
    const isPeak = s.category === "정상";
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="p-main ${isPeak ? (s.main ? "on" : "") : "na"}"
        title="${isPeak ? "주봉 지정 — 앱에서 크게 표시" : ""}">${isPeak ? "▲" : "•"}</span>
      <select class="p-cat" title="분류">${EDIT_CATS.map((c) =>
        `<option ${c === s.category ? "selected" : ""}>${c}</option>`).join("")}</select>
      <input class="p-name" placeholder="이름${isPeak ? " (비우면 ▲만 표시)" : ""}" value="${(s.name || "").replace(/"/g, "&quot;")}" />
      <input class="p-lat" type="number" step="any" title="위도" value="${s.coord[1]}" />
      <input class="p-lon" type="number" step="any" title="경도" value="${s.coord[0]}" />
      <button class="p-del danger">삭제</button>
      <span class="p-disp" title="이 스팟만의 표시 설정 — 비우면 분류 전역 설정을 따름">
        <small>표시</small>
        <select class="p-zoom" title="노출 시작 줌">${[["", "줌 따름"], ["99", "끔"], ["0", "항상"],
          ["10", "z10"], ["12", "z12"], ["14", "z14"], ["16", "z16"], ["18", "z18"]].map(([v, t]) =>
          `<option value="${v}" ${String(s.disp_zoom ?? "") === v ? "selected" : ""}>${t}</option>`).join("")}</select>
        <select class="p-icon" title="기호(▲·점)">${[["", "기호 따름"], ["1", "기호 켬"], ["0", "기호 끔"]].map(([v, t]) =>
          `<option value="${v}" ${(s.disp_icon == null ? "" : s.disp_icon ? "1" : "0") === v ? "selected" : ""}>${t}</option>`).join("")}</select>
        <input class="p-size" type="number" min="6" max="24" step="0.1" placeholder="크기"
          title="글자 px — 비우면 분류 설정" value="${s.disp_size ?? ""}" />
        <select class="p-bold" title="볼드">${[["", "볼드 따름"], ["1", "볼드 켬"], ["0", "볼드 끔"]].map(([v, t]) =>
          `<option value="${v}" ${(s.disp_bold == null ? "" : s.disp_bold ? "1" : "0") === v ? "selected" : ""}>${t}</option>`).join("")}</select>
      </span>`;
    li.querySelector(".p-name").addEventListener("change", (e) => {
      s.name = e.target.value.trim() || null;
      markDirty(); renderPeakMap();
    });
    li.querySelector(".p-cat").addEventListener("change", (e) => {
      s.category = e.target.value;
      if (s.category !== "정상") s.main = false;
      ensureMain();
      markDirty(); renderPeaks();
    });
    // 좌표 직접 입력 — 정확한 위치 특정 (지도 드래그의 대안)
    for (const [cls, idx, lo, hi] of [["p-lat", 1, 32, 44], ["p-lon", 0, 123, 133]]) {
      li.querySelector("." + cls).addEventListener("change", (e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isFinite(v) || v < lo || v > hi) { e.target.value = s.coord[idx]; return; } // 한국 범위 밖 무시
        s.coord[idx] = +v.toFixed(6);
        s.moved = true;
        markDirty(); renderPeakMap();
        map.flyTo({ center: s.coord, zoom: Math.max(map.getZoom(), 13) });
      });
    }
    // 스팟별 표시 오버라이드 — 값 변경 즉시 draft 저장 + 편집 지도 미리보기 갱신
    li.querySelector(".p-zoom").addEventListener("change", (e) => {
      if (e.target.value === "") delete s.disp_zoom;
      else s.disp_zoom = +e.target.value;
      markDirty(); renderPeakMap();
    });
    for (const [cls, key] of [["p-icon", "disp_icon"], ["p-bold", "disp_bold"]]) {
      li.querySelector("." + cls).addEventListener("change", (e) => {
        if (e.target.value === "") delete s[key];
        else s[key] = e.target.value === "1";
        markDirty(); renderPeakMap();
      });
    }
    li.querySelector(".p-size").addEventListener("change", (e) => {
      const v = e.target.value.trim();
      if (v === "") { delete s.disp_size; markDirty(); renderPeakMap(); return; }
      const n = parseFloat(v);
      if (!Number.isFinite(n) || n < 6 || n > 24) { e.target.value = s.disp_size ?? ""; return; }
      s.disp_size = n;
      markDirty(); renderPeakMap();
    });
    li.querySelector(".p-main").onclick = () => {
      if (!isPeak) return;
      peakSpots().forEach((x) => { x.main = x === s; }); // 주봉은 1점만
      markDirty(); renderPeaks();
    };
    li.querySelector(".p-del").onclick = () => {
      if (!confirm(`${s.category} "${s.name || "(이름 없음)"}" 삭제?`)) return;
      S.draft.spots = S.draft.spots.filter((x) => x !== s);
      ensureMain(); // 주봉 승계
      markDirty(); renderPeaks();
    };
    ul.appendChild(li);
  }
}

// 새 스팟 (지도 클릭·좌표 입력 공용) — 분류는 상단 select, 정상이면 주봉 자동 배정
function addSpotAt(lon, lat) {
  const cat = $("pk-cat").value;
  S.draft.spots.push({
    id: "sp-man-" + Math.random().toString(36).slice(2, 8), category: cat,
    name: null, coord: [+lon.toFixed(6), +lat.toFixed(6)],
    detail: null, etc: null, origin: "manual", moved: false, deleted: false,
    main: cat === "정상" && !peakSpots().some((x) => x.main),
  });
  markDirty(); renderPeaks();
  $("peak-list").querySelector("li:last-child .p-name")?.focus();
}

$("peak-add").onclick = () => {
  S.addingPeak = !S.addingPeak;
  $("peak-add").classList.toggle("active", S.addingPeak);
  map.getCanvas().style.cursor = S.addingPeak ? "crosshair" : "";
};

$("pk-add-coord").onclick = () => {
  if (!S.draft) return;
  const lat = parseFloat($("pk-lat").value), lon = parseFloat($("pk-lon").value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 32 || lat > 44 || lon < 123 || lon > 133) {
    alert("위도 32~44, 경도 123~133 범위의 숫자를 입력하세요. (예: 37.445044 / 126.964223)");
    return;
  }
  addSpotAt(lon, lat);
  $("pk-lat").value = ""; $("pk-lon").value = "";
  map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 13) });
};

// ── 지도 이벤트 (코스 클릭·정상 추가/드래그) ──
function wireMapEvents() {
  // 코스 선택 — 정상 추가 모드 중엔 무시 (등록 순서상 이 가드가 먼저 실행됨)
  map.on("click", "courses-hit", (e) => {
    if (S.addingPeak) return;
    selectCourse(e.features[0].properties.id, false);
    e.preventDefault?.();
  });
  map.on("mouseenter", "courses-hit", () => { if (!S.addingPeak) map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "courses-hit", () => { if (!S.addingPeak) map.getCanvas().style.cursor = ""; });

  // ＋지도 클릭 추가: 클릭 위치에 생성 (분류는 상단 select)
  map.on("click", (e) => {
    if (!S.addingPeak || !S.draft) return;
    S.addingPeak = false;
    $("peak-add").classList.remove("active");
    map.getCanvas().style.cursor = "";
    addSpotAt(e.lngLat.lng, e.lngLat.lat);
  });

  // 스팟 드래그 이동 (정상 ▲ · 장소 점)
  for (const layer of ["spot-peak", "spot-place-dot"]) {
    map.on("mousedown", layer, (e) => {
      if (S.addingPeak) return;
      e.preventDefault();
      const s = S.draft.spots.find((x) => x.id === e.features[0].properties.id);
      if (!s) return;
      map.getCanvas().style.cursor = "grabbing";
      const onMove = (ev) => {
        s.coord = [+ev.lngLat.lng.toFixed(6), +ev.lngLat.lat.toFixed(6)];
        renderPeakMap(); // 드래그 중엔 지도만 갱신 (목록 재생성 없음)
      };
      map.on("mousemove", onMove);
      map.once("mouseup", () => {
        map.off("mousemove", onMove);
        map.getCanvas().style.cursor = "";
        s.moved = true;
        markDirty(); renderPeaks(); // 목록 좌표 칸 갱신
      });
    });
    map.on("mouseenter", layer, () => { if (!S.addingPeak) map.getCanvas().style.cursor = "grab"; });
    map.on("mouseleave", layer, () => { if (!S.addingPeak) map.getCanvas().style.cursor = ""; });
  }
}

// ── 배포 ──
$("publish").onclick = async () => {
  if (!S.code) return;
  const ready = S.draft.courses.filter((c) => c.status === "ready").length;
  const msg = ready
    ? `${S.draft.mountain.name} 배포 — ready 코스 ${ready}개가 앱에 반영됩니다. 진행?`
    : `${S.draft.mountain.name} 빈 배포 — 코스가 0개입니다. 앱에서 이 산의 등산로가 모두 제거됩니다(산·스팟·등고선은 유지). 진행?`;
  if (!confirm(msg)) return;
  await saveDraft();
  const { job_id } = await api(`/mountains/${S.code}/publish`, { method: "POST" });
  $("publish").disabled = true;
  pollJob(job_id, async () => {
    $("publish").disabled = false;
    S.draft = await api(`/mountains/${S.code}/draft`);
    renderMountain(); refreshList();
  });
};

$("prod-del").onclick = async () => {
  if (!S.code) return;
  const nm = S.draft.mountain.name, code = S.code;
  if (!confirm(`"${nm}"(${code})을 앱에서 완전히 삭제합니다.\n\n· Supabase 카탈로그 행 삭제\n· R2 팩 파일(packs/${code}/) 삭제\n· 로컬 초안 삭제\n\n되돌릴 수 없습니다. 진행할까요?`)) return;
  S.dirty = false; // 삭제할 초안을 다시 저장하지 않도록
  clearTimeout(saveTimer); // 예약된 자동저장도 취소
  const r = await api(`/mountains/${code}`, { method: "DELETE" });
  S.code = null; S.draft = null;
  $("sec-mnt").hidden = true;
  $("sec-mnt-empty").hidden = false;
  for (const s of ["contours", "network", "courses", "spots"]) map.getSource(s)?.setData(EMPTY);
  refreshList();
  alert(`"${nm}" 삭제 완료 — 카탈로그 ${r.catalog_deleted ? "1행" : "없음"}, R2 파일 ${r.r2_deleted ?? 0}개, 초안 ${r.draft_removed ? "제거" : "없음"}`
    + (r.unpublish_error ? `\n⚠ 배포본 삭제 오류: ${r.unpublish_error}` : "")
    + `\n\n앱은 새로고침하면 반영됩니다.`);
};

function pollJob(id, onDone) {
  $("job-panel").hidden = false;
  const t = setInterval(async () => {
    try {
      const j = await api(`/jobs/${id}`);
      $("job-step").textContent = `${j.title} — ${j.step}` + (j.state === "error" ? " (실패)" : "");
      $("job-fill").style.width = Math.round(j.progress * 100) + "%";
      $("job-log").textContent = j.log.slice(-8).join("\n") + (j.error ? "\n⚠ " + j.error : "");
      $("job-log").scrollTop = $("job-log").scrollHeight;
      if (j.state === "done" || j.state === "error") {
        clearInterval(t);
        if (j.state === "done") onDone?.(j);
        else $("publish").disabled = false;
      }
    } catch { clearInterval(t); }
  }, 1000);
}

// ── 로그아웃: 저장된 토큰 제거 → 로그인 게이트로 ──
$("logout").onclick = () => {
  localStorage.removeItem(TOKEN_KEY);
  adminToken = "";
  location.reload();
};

// ── 단 배치·크기 (드래그) ── 웹 전용 관리자 도구 (iOS 이식 무관)
// 상하 2단(v) ↔ 좌우 2단(h) 전환은 #side 의 flex-direction 을 뒤집는 것.
const SPLIT_KEY = "hiheight-admin-split";     // v 모드: 상단(목록) 높이 px
const SPLITW_KEY = "hiheight-admin-splitw";   // h 모드: 좌측(목록) 폭 px
const SIDEW_KEY = "hiheight-admin-sidew";     // h 모드: 사이드 전체 폭 px
const SIDEVW_KEY = "hiheight-admin-sidevw";   // v 모드: 사이드 전체 폭 px
const LAYOUT_KEY = "hiheight-admin-layout";   // "v"(상하) | "h"(좌우)
{
  const side = $("side"), top = $("side-top"), divider = $("side-divider");
  const bar = $("bottom-bar"), toggle = $("dock-toggle"), edge = $("side-resize");
  const ls = (k) => +localStorage.getItem(k) || 0;
  let layout = localStorage.getItem(LAYOUT_KEY) === "h" ? "h" : "v";

  const clampH = (h) => Math.max(80, Math.min(side.getBoundingClientRect().height - 160, h));
  const clampCol = (w) => Math.max(200, Math.min(side.getBoundingClientRect().width - 240, w));
  const clampSide = (w) => Math.max(560, Math.min(window.innerWidth - 260, w));
  const clampVSide = (w) => Math.max(280, Math.min(window.innerWidth - 260, w));
  let raf = false;
  const resizeMap = () => { if (!raf) { raf = true; requestAnimationFrame(() => { raf = false; map.resize(); }); } };

  function applyLayout(mode) {
    layout = mode;
    side.classList.toggle("mode-h", mode === "h");
    if (mode === "h") {                     // 좌우 2단: 폭을 인라인으로 지정
      top.style.height = "";
      side.style.width = clampSide(ls(SIDEW_KEY) || 700) + "px";
      top.style.width = clampCol(ls(SPLITW_KEY) || 320) + "px";
    } else {                                // 상하 2단: 높이 + 사이드 폭(기본 CSS 360)
      top.style.width = "";
      const w = ls(SIDEVW_KEY);
      side.style.width = w ? clampVSide(w) + "px" : "";
      const h = ls(SPLIT_KEY);
      top.style.height = h ? clampH(h) + "px" : ""; // 없으면 CSS 42%
    }
    localStorage.setItem(LAYOUT_KEY, mode);
    resizeMap();
  }

  // 구분선 드래그 = 크기 조절 (모드에 따라 높이/폭)
  divider.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY;
    const r0 = top.getBoundingClientRect(), sh = r0.height, sw = r0.width;
    document.body.style.userSelect = "none";
    const onMove = (ev) => {
      if (layout === "h") { top.style.width = clampCol(sw + ev.clientX - sx) + "px"; resizeMap(); }
      else top.style.height = clampH(sh + ev.clientY - sy) + "px";
    };
    const onUp = () => {
      divider.removeEventListener("pointermove", onMove);
      divider.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      const r = top.getBoundingClientRect();
      localStorage.setItem(layout === "h" ? SPLITW_KEY : SPLIT_KEY,
        Math.round(layout === "h" ? r.width : r.height));
    };
    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", onUp);
  });

  // 지도 경계 드래그 = 사이드 전체 폭 조절 (상하/좌우 모드 공통, 모드별로 따로 기억)
  edge.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    edge.setPointerCapture(e.pointerId);
    edge.classList.add("dragging");
    const sx = e.clientX, sw = side.getBoundingClientRect().width;
    const clamp = layout === "h" ? clampSide : clampVSide;
    document.body.style.userSelect = "none";
    const onMove = (ev) => {
      side.style.width = clamp(sw + ev.clientX - sx) + "px";
      // 좌우 모드: 패널이 좁아지면 목록 열도 한도(패널-240) 안으로 당김
      if (layout === "h") top.style.width = clampCol(top.getBoundingClientRect().width) + "px";
      resizeMap();
    };
    const onUp = () => {
      edge.removeEventListener("pointermove", onMove);
      edge.removeEventListener("pointerup", onUp);
      edge.classList.remove("dragging");
      document.body.style.userSelect = "";
      localStorage.setItem(layout === "h" ? SIDEW_KEY : SIDEVW_KEY,
        Math.round(side.getBoundingClientRect().width));
      if (layout === "h")
        localStorage.setItem(SPLITW_KEY, Math.round(top.getBoundingClientRect().width));
    };
    edge.addEventListener("pointermove", onMove);
    edge.addEventListener("pointerup", onUp);
  });

  // 편집 패널 바 드래그 → 목록 오른쪽=좌우(h) / 목록 왼쪽·아래=상하(v)
  const hint = document.createElement("div");
  hint.id = "dock-hint"; hint.hidden = true; document.body.appendChild(hint);
  const zoneOf = (x) => (x > top.getBoundingClientRect().right ? "h" : "v");
  const showHint = (zone) => {
    if (!zone) { hint.hidden = true; return; }
    hint.hidden = false;
    if (zone === "h") {
      const r = top.getBoundingClientRect();
      hint.style.left = (r.right + 10) + "px"; hint.style.top = "88px";
      hint.style.width = Math.min(340, window.innerWidth - r.right - 28) + "px";
      hint.style.height = Math.round(window.innerHeight * 0.6) + "px";
      hint.textContent = "좌우 2단";
    } else {
      hint.style.left = "8px"; hint.style.top = Math.round(window.innerHeight * 0.46) + "px";
      hint.style.width = "344px"; hint.style.height = Math.round(window.innerHeight * 0.46) + "px";
      hint.textContent = "상하 2단";
    }
  };
  bar.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#dock-toggle")) return; // 토글 버튼 클릭은 드래그 아님
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    bar.classList.add("dragging");
    document.body.style.userSelect = "none";
    const onMove = (ev) => { const z = zoneOf(ev.clientX); showHint(z !== layout ? z : null); };
    const onUp = (ev) => {
      bar.removeEventListener("pointermove", onMove);
      bar.removeEventListener("pointerup", onUp);
      bar.classList.remove("dragging");
      document.body.style.userSelect = "";
      hint.hidden = true;
      const z = zoneOf(ev.clientX);
      if (z !== layout) applyLayout(z);
    };
    bar.addEventListener("pointermove", onMove);
    bar.addEventListener("pointerup", onUp);
  });
  toggle.onclick = () => applyLayout(layout === "h" ? "v" : "h"); // 한 번에 전환(폴백)

  let rz;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => applyLayout(layout), 120); });
  applyLayout(layout); // 저장된 배치 복원
}

// ── 표시 설정 (앱 전역 — 분류별 {줌, 기호, 크기, 볼드}) ──
// 스팟(R2 config/spot-display.json)과 기저지도 POI(config/poi-display.json)가 같은 편집기 공유.
const SPOT_ZOOM_OPTS = [
  [null, "끔"], [0, "항상"], [10, "z10 (광역)"], [12, "z12 (산 전체)"],
  [14, "z14"], [16, "z16"], [18, "z18 (축척 30m)"],
];
const POI_ZOOM_OPTS = [
  [null, "끔"], [12, "z12 (산 전체)"], [12.5, "z12.5"], [13, "z13"], [13.5, "z13.5"],
  [14, "z14 (동네)"], [14.5, "z14.5"], [15, "z15"], [16, "z16 (근접)"],
];
// 아이콘 자체가 없는 분류 (기저지도 도시 POI — 텍스트 전용 레이어)
const POI_NO_ICON = ["학교", "관공서", "병원", "아파트단지", "공원", "마트·쇼핑", "문화·체육"];

// 컨트롤 + 캡션 묶음
function ctl(caption, el) {
  const w = document.createElement("span");
  w.className = "cfg-ctl";
  w.append(Object.assign(document.createElement("small"), { textContent: caption }), el);
  return w;
}

// 설정 섹션 바인딩 — load 함수를 돌려준다.
// onChange(categories): 값이 바뀔 때마다(저장 전에도) 호출 — 편집 지도 라이브 미리보기용.
function bindDisplayCfg(apiPath, prefix, zoomOpts, noIconCats = [], onChange = null) {
  let cfg = null;
  const state = (t) => { $(`${prefix}-state`).textContent = t; };
  async function load() {
    try {
      cfg = await api(apiPath);
    } catch (_) { return; }
    onChange?.(cfg.categories); // 저장된 설정을 편집 지도에도 반영
    const dirty = () => { state("저장 안 됨 (지도는 미리보기)"); onChange?.(cfg.categories); };
    const box = $(`${prefix}-rows`);
    box.innerHTML = "";
    for (const [cat, val] of Object.entries(cfg.categories)) {
      const row = document.createElement("div");
      row.className = "spotcfg-row";
      // 노출 줌
      const sel = document.createElement("select");
      const opts = zoomOpts.some(([v]) => v === val.zoom) ? zoomOpts
        : [...zoomOpts, [val.zoom, `z${val.zoom}`]]; // 목록 밖 저장값도 보이게
      for (const [v, label] of opts) {
        const o = document.createElement("option");
        o.value = v === null ? "" : v;
        o.textContent = label;
        o.selected = v === val.zoom;
        sel.appendChild(o);
      }
      sel.onchange = () => { val.zoom = sel.value === "" ? null : +sel.value; dirty(); };
      // 기호 (점·아이콘·▲)
      const icon = document.createElement("input");
      icon.type = "checkbox";
      icon.checked = val.icon && !noIconCats.includes(cat);
      icon.disabled = noIconCats.includes(cat);
      if (icon.disabled) icon.title = "이 분류는 텍스트 전용";
      icon.onchange = () => { val.icon = icon.checked; dirty(); };
      // 글자 크기
      const size = document.createElement("input");
      size.type = "number";
      size.min = 6; size.max = 24; size.step = 0.1; size.value = val.size;
      size.onchange = () => {
        const n = parseFloat(size.value);
        if (Number.isFinite(n) && n >= 6 && n <= 24) { val.size = n; dirty(); }
        else size.value = val.size; // 범위 밖 입력 원복
      };
      // 볼드
      const bold = document.createElement("input");
      bold.type = "checkbox";
      bold.checked = val.bold;
      bold.onchange = () => { val.bold = bold.checked; dirty(); };

      row.append(
        Object.assign(document.createElement("span"), { textContent: cat, className: "cfg-cat" }),
        ctl("줌", sel), ctl("기호", icon), ctl("크기", size), ctl("볼드", bold));
      box.appendChild(row);
    }
  }
  $(`${prefix}-save`).onclick = async () => {
    if (!cfg) return;
    state("저장 중…");
    try {
      await api(apiPath, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: cfg.categories }),
      });
      state("저장됨 ✓ (앱 새로고침 시 반영)");
    } catch (e) {
      state("저장 실패: " + e.message);
    }
  };
  return load;
}
// 라이브 미리보기: 스팟 설정 → 편집 레이어 즉시 반영, POI 설정 → 기저지도 재생성.
// (POI 는 값이 실제로 달라졌을 때만 setStyle — 불필요한 지도 리로드 방지)
let lastPoiJson = JSON.stringify(normPoiDisplay(null));
const loadSpotCfg = bindDisplayCfg("/config/spots", "spotcfg", SPOT_ZOOM_OPTS, [], (cats) => {
  spotCfgLive = cats;
  applySpotEditorStyle();
});
const loadPoiCfg = bindDisplayCfg("/config/poi", "poicfg", POI_ZOOM_OPTS, POI_NO_ICON, (cats) => {
  poiCfgLive = cats;
  const j = JSON.stringify(normPoiDisplay(cats));
  if (j === lastPoiJson) return;
  lastPoiJson = j;
  applyPoiEditorStyle();
});

// ── 큐레이션 (추천 모음 — 산·코스, R2 config/curations.json → 앱 추천 탭) ──
let curDoc = null; // {version, curations: [{id, title, items: [{type, code, name, mountain?}]}]}
const cuState = (t) => { $("cu-state").textContent = t; };
const cuDirty = () => cuState("저장 안 됨");

async function loadCurations() {
  try {
    curDoc = await api("/config/curations");
  } catch (_) { return; }
  renderCurations();
}

function renderCurations() {
  const box = $("cu-list");
  box.innerHTML = "";
  if (!curDoc.curations.length) {
    box.innerHTML = '<p class="dim" style="margin:6px 0">등록된 큐레이션이 없습니다. ＋ 새 큐레이션으로 시작하세요.</p>';
    return;
  }
  for (const cu of curDoc.curations) box.appendChild(curationBlock(cu));
}

function curationBlock(cu) {
  const div = document.createElement("div");
  div.className = "cu-block";

  // 제목 + 큐레이션 삭제
  const head = document.createElement("div");
  head.className = "cu-head";
  const title = Object.assign(document.createElement("input"), {
    className: "cu-title", placeholder: "큐레이션 이름 (예: 가을 단풍 추천)", value: cu.title || "",
  });
  title.onchange = () => { cu.title = title.value.trim(); cuDirty(); };
  const del = Object.assign(document.createElement("button"), { className: "danger", textContent: "삭제" });
  del.onclick = () => {
    if (!confirm(`큐레이션 "${cu.title || "(이름 없음)"}" 삭제?`)) return;
    curDoc.curations = curDoc.curations.filter((x) => x !== cu);
    renderCurations(); cuDirty();
  };
  head.append(title, del);

  // 항목 목록 (산·코스) — 2행: [분류·이름·제거] + [추천 설명·커버 이미지]
  const ul = document.createElement("ul");
  ul.className = "cu-items";
  for (const it of cu.items) {
    const li = document.createElement("li");
    const row1 = document.createElement("div");
    row1.className = "cu-row1";
    row1.innerHTML = `<span class="cu-kind">${it.type === "mountain" ? "산" : "코스"}</span>
      <span class="cu-name">${it.type === "course" ? `${it.mountain} · ` : ""}${it.name}</span>`;
    const rm = Object.assign(document.createElement("button"), { textContent: "×", title: "항목 제거" });
    rm.onclick = () => {
      cu.items = cu.items.filter((x) => x !== it);
      div.replaceWith(curationBlock(cu)); cuDirty();
    };
    row1.appendChild(rm);

    // 슬라이드 요소 입력 — 전부 선택(비면 앱에서 미표시)
    const field = (key, ph, cls = "cu-desc") => {
      const el = Object.assign(document.createElement("input"), {
        className: cls, placeholder: ph, value: it[key] || "",
      });
      el.onchange = () => { it[key] = el.value.trim(); cuDirty(); };
      return el;
    };
    const row2 = document.createElement("div");
    row2.className = "cu-row2";
    row2.append(
      field("sub", "부가설명 (좌상단 반투명 배지)"),
      field("title", "제목 (큰 글자)"));
    const row3 = document.createElement("div");
    row3.className = "cu-row2";
    row3.append(field("desc", "설명 (중앙 하단 · 가운데 정렬)"));
    const row4 = document.createElement("div");
    row4.className = "cu-row2";
    row4.append(
      field("logo", "로고 (좌하단 · 예: © 하이하잇)", "cu-desc cu-logo"),
      field("credit", "출처 (우하단 · 사진 저작자)", "cu-desc cu-logo"));
    // 산 커버 이미지 업로드 → R2 images/mountains/<산코드> (같은 산 항목끼리 재사용)
    const file = Object.assign(document.createElement("input"), { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true });
    const imgBtn = Object.assign(document.createElement("button"), {
      className: "cu-img-btn", textContent: it.img ? "이미지 ✓" : "이미지",
      title: it.img ? `교체: ${it.img}` : "커버 이미지 업로드 (배경)",
    });
    imgBtn.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files[0];
      if (!f) return;
      imgBtn.textContent = "올리는 중…"; imgBtn.disabled = true;
      try {
        const r = await api(`/mountain-image?code=${it.code}`, {
          method: "POST", headers: { "Content-Type": f.type }, body: f,
        });
        it.img = r.url;
        // 같은 산의 다른 항목에도 커버 공유 (같은 R2 객체)
        for (const c2 of curDoc.curations) for (const x of c2.items)
          if (x.code === it.code && !x.img) x.img = r.url;
        cuDirty();
        div.replaceWith(curationBlock(cu));
      } catch (e) {
        imgBtn.textContent = "실패: " + e.message; imgBtn.disabled = false;
      }
    };
    row4.append(imgBtn, file);
    li.append(row1, row2, row3, row4);
    ul.appendChild(li);
  }

  // 항목 추가 — 산·코스 통합 검색 (관리 중인 산 이름 + 초안 코스명)
  const addWrap = document.createElement("div");
  addWrap.className = "cu-add";
  const q = Object.assign(document.createElement("input"), {
    type: "search", placeholder: "산 이름·코스명 검색해 추가", autocomplete: "off",
  });
  const res = document.createElement("ul");
  res.className = "cu-results";
  res.hidden = true;
  let seq = 0;
  q.oninput = async () => {
    const kw = q.value.trim();
    const my = ++seq;
    if (!kw) { res.hidden = true; return; }
    // 산: 관리 중인 초안 목록에서 이름 매칭 / 코스: 서버 검색
    const [mts, courses] = await Promise.all([
      api("/mountains").then((l) => l.filter((m) => m.name.includes(kw)).slice(0, 5)).catch(() => []),
      api(`/course-search?q=${encodeURIComponent(kw)}`).catch(() => []),
    ]);
    if (my !== seq) return; // 최신 입력만 반영
    res.innerHTML = "";
    const already = new Set(cu.items.map((x) => `${x.type}|${x.code}|${x.name || ""}`));
    const row = (label, item) => {
      const li = document.createElement("li");
      li.textContent = label;
      if (already.has(`${item.type}|${item.code}|${item.name || ""}`)) {
        li.classList.add("dup"); li.title = "이미 추가됨";
      } else {
        li.onclick = () => {
          // 로고 기본값 프리필 (비우면 미표시), 같은 산의 기존 커버 이미지 재사용
          const img = curDoc.curations.flatMap((c2) => c2.items)
            .find((x) => x.code === item.code && x.img)?.img;
          cu.items.push({ ...item, logo: "© 하이하잇", ...(img ? { img } : {}) });
          div.replaceWith(curationBlock(cu)); cuDirty();
        };
      }
      res.appendChild(li);
    };
    for (const m of mts)
      row(`산 · ${m.name} (${m.code})${m.published ? "" : " — 비공개"}`,
        { type: "mountain", code: m.code, name: m.name });
    for (const c of courses.slice(0, 10))
      row(`코스 · ${c.mountain} — ${c.name}${c.status !== "ready" ? " (비공개 코스)" : ""}`,
        { type: "course", code: c.code, name: c.name, mountain: c.mountain });
    if (!res.children.length) res.innerHTML = '<li class="dup">검색 결과 없음</li>';
    res.hidden = false;
  };
  addWrap.append(q, res);

  div.append(head, ul, addWrap);
  return div;
}

$("cu-new").onclick = () => {
  if (!curDoc) curDoc = { version: 1, curations: [] };
  curDoc.curations.push({ id: "cu-" + Math.random().toString(36).slice(2, 10), title: "", items: [] });
  renderCurations(); cuDirty();
};
$("cu-save").onclick = async () => {
  if (!curDoc) return;
  cuState("저장 중…");
  try {
    curDoc = await api("/config/curations", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ curations: curDoc.curations }),
    });
    renderCurations();
    cuState("저장됨 ✓ (앱 새로고침 시 반영)");
  } catch (e) {
    cuState("저장 실패: " + e.message);
  }
};

// ── 부팅 ── (401 이면 api() 가 로그인 게이트를 띄움)
refreshList().catch(() => {});
loadSpotCfg().catch(() => {});
loadPoiCfg().catch(() => {});
loadCurations().catch(() => {});
