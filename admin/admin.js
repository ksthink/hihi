// 하이하잇 관리자 콘솔 — 코스 큐레이션·스팟 보정·팩 배포 (로컬 전용 도구)
import maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/+esm";
import { Protocol } from "https://cdn.jsdelivr.net/npm/pmtiles@3.2.1/+esm";
import { buildStyle, normPoiDisplay, symChar } from "../basemap-style.js";
import { attachPoiIcons } from "../poi-icons.js";
import { SYMBOL_GROUPS } from "./symbols.js";

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
// ⚠️ baseMode 를 반드시 "city" 로 넘긴다. 기본값 "terrain" 은 TERRAIN_DROP 으로
// stations·bus-stops·poi-urban·admin-labels 레이어를 통째로 걷어내기 때문에,
// 표시 설정에서 전철역을 "항상"으로 바꿔도 관리자 지도에는 나타날 수가 없었다
// (11개 분류 중 9개가 미리보기 불가였다 — 2026-07-23).
const ADMIN_BASE_MODE = "city";
maplibregl.addProtocol("pmtiles", new Protocol().tile);
const map = new maplibregl.Map({
  container: "map",
  style: buildStyle(`${location.origin}/pmtiles/kr-base.pmtiles`, "light",
    `${location.origin}/pmtiles/kr-terrain.pmtiles`, null, ADMIN_BASE_MODE),
  center: [127.5, 36.5], zoom: 6.5,
  maxBounds: [[121.0, 31.0], [135.0, 40.5]], minZoom: 5,
  localIdeographFontFamily: "'MonaS12', 'Apple SD Gothic Neo', 'Malgun Gothic', monospace",
});
map.addControl(new maplibregl.NavigationControl({ showZoom: true }), "bottom-right");
attachPoiIcons(map); // 기저지도 POI 아이콘 생성 — 앱과 같은 모듈 (관리자는 라이트 고정)
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
    정상: { icon: true, size: 14, bold: true }, 장소: { icon: true, size: 8, bold: false },
  };
  const pk = cfg["정상"], pl = cfg["장소"];
  const font = (b) => [b ? "MonaS12 Bold" : "MonaS12 Regular"];
  // disp_bold 3상(true/false/없음→분류) — to-string: 없음(null)은 "" 로 떨어져 분류 폰트
  const fontExpr = (catBold) => ["match", ["to-string", ["get", "disp_bold"]],
    "true", ["literal", font(true)], "false", ["literal", font(false)], ["literal", font(catBold)]];
  map.setLayoutProperty("spot-peak", "text-field",
    ["concat", ["case", ["to-boolean", ["coalesce", ["get", "disp_icon"], pk.icon]],
      symChar(pk.icon) ?? "▲", ""],
      ["coalesce", ["get", "name"], ""]]);
  map.setLayoutProperty("spot-peak", "text-font", fontExpr(pk.bold));
  map.setLayoutProperty("spot-peak", "text-size", // 앱과 동일: 부봉(main=false)은 비율 축소
    ["coalesce", ["get", "disp_size"],
      ["case", ["==", ["get", "main"], false], Math.round(pk.size * (11 / 14) * 10) / 10, pk.size]]);
  map.setFilter("spot-place-dot", ["all", ["==", ["get", "category"], "장소"],
    ["to-boolean", ["coalesce", ["get", "disp_icon"], pl.icon]]]);
  map.setLayoutProperty("spot-place-label", "text-font", fontExpr(pl.bold));
  map.setLayoutProperty("spot-place-label", "text-size", ["coalesce", ["get", "disp_size"], pl.size]);
}

// 기저지도 POI 설정 적용 — 스타일 재생성(앱과 동일 경로). styledata 가 편집 레이어 재부착.
// map "load" 를 기다리지 않는다: 이 지도는 전국 뷰 타일 로딩이 길어 load 가 매우 늦거나
// 안 올 수 있고, 인라인 스타일 객체 교체는 로드 중에도 안전함(실측 확인).
function applyPoiEditorStyle() {
  map.setStyle(buildStyle(`${location.origin}/pmtiles/kr-base.pmtiles`, "light",
    `${location.origin}/pmtiles/kr-terrain.pmtiles`, poiCfgLive, ADMIN_BASE_MODE));
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
      "text-font": ["MonaS12 Regular"], "text-size": 8.4, "symbol-spacing": 300,
    },
    paint: { "text-color": "#8a857c", "text-halo-color": "#ffffff", "text-halo-width": 1.4 } });

  // 산림청 구간망 원본 — 회색 참조선 (GPX 매칭 검토·클릭 컴포저 대상 배경)
  // 두께 1.2 → 2.4: 클릭 대상인데 너무 가늘어 잘 안 보인다는 피드백(2026-08-02).
  // 코스 선(2.2/4.5, 더 진한 색)이 위에 얹히므로 두꺼워도 위계는 유지된다.
  map.addLayer({ id: "network-line", type: "line", source: "network",
    paint: { "line-color": "#c9c9c9", "line-width": 2.4 } });

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
      "text-font": ["MonaS12 Regular"],
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
      "text-field": ["get", "name"], "text-font": ["MonaS12 Regular"],
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

// ── 산 직접 추가 (산림청 원본 없는 산: 이름·중심·높이만 입력) ──
let manualMarker = null;
function setManualCenter(lon, lat) {
  S.manualCenter = [lon, lat];
  if (!manualMarker) manualMarker = new maplibregl.Marker({ color: "#e11" });
  manualMarker.setLngLat([lon, lat]).addTo(map);
  $("man-coord").textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  $("man-create").disabled = false;
}
function closeManualForm() {
  S.pickingCenter = false; S.manualCenter = null;
  map.getCanvas().style.cursor = "";
  manualMarker?.remove();
  $("manual-form").hidden = true;
  $("man-pick").classList.remove("active");
  $("man-name").value = ""; $("man-elev").value = ""; $("man-region").value = "";
  $("man-coord").textContent = "위치 미지정";
  $("man-create").disabled = true;
}
$("manual-toggle").onclick = () => {
  if ($("manual-form").hidden) $("manual-form").hidden = false;  // 열기
  else closeManualForm();                                       // 닫기(입력 초기화)
};
$("man-pick").onclick = () => {
  S.pickingCenter = !S.pickingCenter;
  $("man-pick").classList.toggle("active", S.pickingCenter);
  map.getCanvas().style.cursor = S.pickingCenter ? "crosshair" : "";
};
$("man-cancel").onclick = closeManualForm;
$("man-create").onclick = async () => {
  const name = $("man-name").value.trim();
  if (!name) { alert("산 이름을 입력하세요."); return; }
  if (!S.manualCenter) { alert("지도에서 중심 위치를 클릭하세요."); return; }
  const [lon, lat] = S.manualCenter;
  const elev = $("man-elev").value.trim(), region = $("man-region").value.trim();
  $("man-create").disabled = true;
  try {
    const r = await api("/mountains/manual", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, lat, lon, elev: elev || null, region }),
    });
    closeManualForm();
    await refreshList();
    await selectMountain(r.code);  // 바로 편집(등산로 서브탭)으로 이동
  } catch (e) {
    alert("추가 실패: " + e.message);
    $("man-create").disabled = false;
  }
};

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
  setMountainVisible(true);
  showSub("course");            // 산을 고르면 바로 편집으로 — 목록에 머물 이유가 없다
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
  $("cur-mnt").textContent = `${m.name} · ${m.code}`;   // 패널 헤드(서브탭 위) 현재 산
  $("cur-mnt").classList.add("on");
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
      const q = r.report.raw_passthrough ? "원본 그대로" : `매칭 ${Math.round((r.report.matched_ratio ?? 0) * 100)}%`;
      results.push(`✓ ${f.name} → ${r.course.name} · ${q} · ${r.report.distance_km}km`);
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
    // 고도 출처 — 실측 녹화(GPS)·GPX 자체값(네이버 등 export)·지형(DEM) 샘플링.
    const esLabel = { gps: "고도 실측GPS", gpx: "고도 GPX값", dem: "고도 지형DEM" }[rep.elev_src] || "고도 지형DEM";
    const es = ` · <span class="dim">${esLabel}</span>`;
    if (rep.raw_passthrough) {
      // 산림청 구간망 없는 산(수동 등록) — GPX 원본을 그대로 코스로 사용
      const parts = (rep.parts ?? 1) > 1
        ? `<div class="dim">끊긴 ${rep.parts}개 구간을 분리(직선 연결 없음)</div>` : "";
      $("gpx-report").innerHTML =
        `<div>GPX 원본 그대로 사용 <span class="dim">(구간망 없는 산 — 스냅 없음)</span></div>${rep.distance_km}km · ↑${rep.ascent}m${es}${parts}`;
    } else {
      const fb = rep.fallbacks.length
        ? `<div class="warn">구간망 밖 ${rep.fallbacks.length}곳 (GPX 원 좌표 유지): ${rep.fallbacks.map((f) => f.km + "km").join(", ")}</div>`
        : "<div>전 구간 구간망 매칭 ✓</div>";
      $("gpx-report").innerHTML =
        `매칭률 <b>${Math.round(rep.matched_ratio * 100)}%</b> · ${rep.distance_km}km · ↑${rep.ascent}m${es} · 최대이탈 ${Math.round(rep.max_dev_m)}m ${fb}`;
    }
    $("gpx-actions").hidden = false;
    // 모든 파트(LineString·MultiLineString)를 감싸도록 화면 맞춤
    const all = [];
    for (const f of r.preview.matched.features) {
      const g = f.geometry;
      all.push(...(g.type === "MultiLineString" ? g.coordinates.flat() : g.coordinates));
    }
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
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
  // 산 직접 추가 — 중심 위치 클릭 (draft 없이도 동작하는 일회성 픽)
  map.on("click", (e) => {
    if (!S.pickingCenter) return;
    S.pickingCenter = false;
    $("man-pick").classList.remove("active");
    map.getCanvas().style.cursor = "";
    setManualCenter(e.lngLat.lng, e.lngLat.lat);
  });

  // 코스 선택 — 정상 추가·중심 픽 모드 중엔 무시 (등록 순서상 이 가드가 먼저 실행됨)
  map.on("click", "courses-hit", (e) => {
    if (S.addingPeak || S.pickingCenter) return;
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
  setMountainVisible(false);
  $("cur-mnt").textContent = "산을 선택하세요";
  $("cur-mnt").classList.remove("on");
  showSub("list");
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

// ── 화면 전환 (상단 탭 / 서브탭 / 지도 설정 오버레이) ──
// 예전의 상하↔좌우 2단 드래그 배치(130줄)는 폐기했다 — 탭으로 나뉘어 한 번에 보이는 것이
// 줄면서 필요 없어졌다. 남긴 조작은 편집 패널 폭 조절 하나뿐.
const TAB_KEY = "hiheight-admin-tab";
const PANELW_KEY = "hiheight-admin-panelw";

// 지도 컨테이너 크기가 바뀌면 반드시 호출 — 빠뜨리면 지도가 잘린 채로 남는다.
let _rz = false;
const resizeMap = () => {
  if (_rz) return;
  _rz = true;
  requestAnimationFrame(() => { _rz = false; map.resize(); });
};

// 상단 탭: 산 편집 ↔ 큐레이션 ↔ 등반 기록 ↔ 시트 (뒤 셋은 지도 숨기고 전체 폭)
function showTab(name) {
  const cu = name === "cu";
  const rec = name === "rec";
  const sheet = name === "sheet";
  const full = cu || rec || sheet;
  $("editor-panel").hidden = full;
  $("map").hidden = full;
  $("mapcfg").hidden = full;
  $("curation-view").hidden = !cu;
  $("records-view").hidden = !rec;
  $("sheet-view").hidden = !sheet;
  for (const b of document.querySelectorAll("#tabs .tab"))
    b.classList.toggle("active", b.dataset.tab === name);
  localStorage.setItem(TAB_KEY, name);
  if (!full) resizeMap();    // 숨김 상태에서 바뀐 컨테이너 크기를 지도에 알림
  if (cu) growSlideFields(); // 숨겨진 동안 잰 높이는 0 — 보일 때 다시 잰다
  if (rec) loadRecords();
  if (sheet) loadSheet();
}

// 서브탭: 산 목록 / 등산로 / 스팟
function showSub(name) {
  for (const el of document.querySelectorAll("#panel-scroll .subpanel"))
    el.hidden = el.dataset.sub !== name;
  for (const b of document.querySelectorAll("#subtabs .subtab"))
    b.classList.toggle("active", b.dataset.sub === name);
}

// 산 선택 여부에 따라 편집 영역/안내 문구 전환 (등산로·스팟 서브탭 공용)
function setMountainVisible(on) {
  for (const el of document.querySelectorAll("#panel-scroll .mnt-body")) el.hidden = !on;
  for (const el of document.querySelectorAll("#panel-scroll .sec-mnt-empty")) el.hidden = on;
  $("spotcfg-hint").hidden = on;   // 스팟 미리보기는 산이 선택돼야 보인다
}

// ── 등반 기록 · 진단 ──────────────────────────────────────────────────────
// climb_records 는 RLS 가 "본인 것만"이라 브라우저에서 직접 못 읽는다 — 서버(/api/records)가
// service_role 로 대신 조회한다. track.meta 는 iOS 앱이 기록한 배터리·GPS 요약(schema.sql 참조).
const REC = { rows: [] };

// 등반 배터리 모드(IOS.md §7-5) — meta.bat_mode 원값 → 표시 라벨.
const BAT_MODE_LABEL = { normal: "일반", saver: "절전", max: "최대절전" };

const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 시간당 배터리 소모(%/h). 측정 불가면 null —
// 충전 중이었거나(소모량 무의미), 잔량 미측정(시뮬·이어하기)이거나, 10분 미만(5% 단위라 튐).
function drainRate(r) {
  const m = r.meta;
  if (!m || m.charged || m.bat_start < 0 || m.bat_end < 0) return null;
  const h = (r.duration_s || 0) / 3600;
  if (h < 1 / 6) return null;
  return (m.bat_start - m.bat_end) / h;
}

async function loadRecords() {
  $("rec-state").textContent = "불러오는 중…";
  try {
    REC.rows = await api("/records?limit=300");
    renderRecords();
    $("rec-state").textContent = `${REC.rows.length}건`;
  } catch (e) {
    $("rec-state").textContent = "실패: " + e.message;
    $("rec-summary").innerHTML = "";
    $("rec-list").innerHTML = "";
  }
}

// %/h 집계에서 빠진 사유. 무엇이 빠졌는지 보이지 않으면 남은 데이터가 전부인 줄 착각한다.
function excludeReason(r) {
  const m = r.meta;
  if (!m) return "진단 없음";
  if (m.charged) return "충전 중";
  if (m.bat_start < 0 || m.bat_end < 0) return "잔량 미측정";
  if ((r.duration_s || 0) / 3600 < 1 / 6) return "10분 미만";
  return null;
}

const avgOf = (a) => a.reduce((s, x) => s + x, 0) / a.length;

// started_at 은 timestamptz 라 Supabase 가 UTC(+00:00)로 준다. 문자열을 그대로 자르면
// KST 와 9시간 어긋난다 — 11:17 저장분이 02:17 로 보였다(2026-07-30 발견).
const KST_FMT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",   // h23: 자정이 24 로 나오지 않게
});
function fmtKst(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  const p = Object.fromEntries(KST_FMT.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// 그룹별 %/h 분포 — 개별 점 + 평균선(SVG 직접 생성, 라이브러리 의존 없음).
// ⚠️ 평균 막대를 쓰지 않는다: 표본이 2~3건일 때 막대는 없는 확신을 만든다.
//    점을 그대로 찍어야 "3건이 12~26 으로 흩어져 있다"가 눈에 들어온다.
function dotPlot(groups, unit = "%/h") {
  const W = 540, H = 220, L = 48, R = 16, T = 16, B = 34;
  const all = groups.flatMap((g) => g.values);
  if (!all.length) return "";
  const yMax = Math.max(10, Math.ceil(Math.max(...all) * 1.15));
  const cx = (i) => L + ((i + 0.5) * (W - L - R)) / groups.length;
  const cy = (v) => H - B - (v / yMax) * (H - T - B);
  const ticks = [0, yMax / 2, yMax];

  const axis = ticks.map((t) =>
    `<line x1="${L}" y1="${cy(t)}" x2="${W - R}" y2="${cy(t)}" stroke="#e3e3e3"/>
     <text x="${L - 8}" y="${cy(t) + 4}" text-anchor="end" font-size="10" fill="#999">${t.toFixed(0)}</text>`
  ).join("");

  const body = groups.map((g, i) => {
    const x = cx(i);
    const mean = avgOf(g.values);
    const thin = g.values.length < 3;   // 표본 부족 — 평균선을 흐리게
    // 지터는 인덱스 기반(결정적) — 새로고침마다 점이 튀지 않게. 한 줄에 최대 5개씩
    // 중심 대칭으로 벌린다(평균선 중앙과 점 무리의 중심이 어긋나지 않게).
    const lane = Math.min(g.values.length - 1, 4) / 2;
    const dots = g.values.map((v, j) =>
      `<circle cx="${(x + ((j % 5) - lane) * 5).toFixed(1)}" cy="${cy(v).toFixed(1)}" r="3.4" fill="#111" fill-opacity="0.75"/>`
    ).join("");
    return `${dots}
      <line x1="${x - 26}" y1="${cy(mean)}" x2="${x + 26}" y2="${cy(mean)}"
            stroke="#111" stroke-width="2" stroke-opacity="${thin ? 0.3 : 1}"/>
      <text x="${x}" y="${cy(mean) - 8}" text-anchor="middle" font-size="11"
            font-weight="700" fill="#111" fill-opacity="${thin ? 0.45 : 1}">${mean.toFixed(1)}</text>
      <text x="${x}" y="${H - B + 15}" text-anchor="middle" font-size="11" fill="#111">${escHtml(g.key)}</text>
      <text x="${x}" y="${H - B + 27}" text-anchor="middle" font-size="9" fill="#999">n=${g.values.length}${thin ? " 표본부족" : ""}</text>`;
  }).join("");

  return `<svg class="rec-chart" viewBox="0 0 ${W} ${H}" role="img">
    <text x="4" y="12" font-size="10" fill="#999">${escHtml(unit)}</text>
    ${axis}${body}
  </svg>`;
}

function renderRecords() {
  // 요약 — 소모율 분포를 두 축으로 본다.
  //  ① GPS 정확도 모드별 (정확도를 낮추면 실제로 덜 먹는가)
  //  ② 등반 배터리 모드별 (IOS.md §7-5 — 일반/절전/최대절전이 실제로 차이를 만드는가)
  const byGps = new Map();
  const byMode = new Map();
  const skipped = new Map();
  const push = (map, key, v) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(v);
  };
  for (const r of REC.rows) {
    const v = drainRate(r);
    if (v == null) {
      const why = excludeReason(r) || "기타";
      skipped.set(why, (skipped.get(why) || 0) + 1);
      continue;
    }
    push(byGps, r.meta.gps_mode || "?", v);
    if (r.meta.bat_mode) push(byMode, BAT_MODE_LABEL[r.meta.bat_mode] || r.meta.bat_mode, v);
  }
  const toGroups = (map) => [...map.entries()].map(([key, values]) => ({ key, values }));
  const groups = toGroups(byGps);
  const modeGroups = toGroups(byMode);
  const skipNote = skipped.size
    ? `<p class="dim rec-skip">집계 제외 ${[...skipped.entries()].map(([k, n]) => `${k} ${n}건`).join(" · ")}</p>`
    : "";

  // 분포표 — 평균만 보여주지 않는다(표본이 적을 때 평균은 위험하다).
  const table = (gs, head) =>
    `<table class="rec-tbl"><thead><tr><th>${head}</th><th>평균</th><th>최소~최대</th><th>표본</th></tr></thead><tbody>${
      gs.map((g) => {
        const mn = Math.min(...g.values), mx = Math.max(...g.values);
        return `<tr><td>${escHtml(g.key)}</td><td><b>${avgOf(g.values).toFixed(1)} %/h</b></td>
          <td class="dim">${mn.toFixed(1)} ~ ${mx.toFixed(1)}</td>
          <td>${g.values.length}건${g.values.length < 3 ? ' <span class="warn">표본부족</span>' : ""}</td></tr>`;
      }).join("")}</tbody></table>`;

  const modeBlock = modeGroups.length
    ? `<h3 class="rec-h3">등반 배터리 모드별 시간당 소모</h3>${dotPlot(modeGroups)}${table(modeGroups, "배터리 모드")}`
    : "";

  $("rec-summary").innerHTML = groups.length
    ? `${modeBlock}
       <h3 class="rec-h3">GPS 모드별 시간당 배터리 소모</h3>
       ${dotPlot(groups)}
       ${table(groups, "GPS 모드")}${skipNote}`
    : `<p class="dim">아직 측정 가능한 기록이 없습니다 — 실기기에서 10분 이상, 충전하지 않고 등반한 기록이 필요합니다.</p>${skipNote}`;

  // 목록
  const rows = REC.rows.map((r) => {
    const m = r.meta;
    const rate = drainRate(r);
    const when = fmtKst(r.started_at);   // UTC → KST (문자열 자르기 금지)
    const dur = r.duration_s ? `${Math.floor(r.duration_s / 3600)}:${String(Math.floor(r.duration_s % 3600 / 60)).padStart(2, "0")}` : "—";
    const bat = !m ? "—"
      : m.charged ? "충전 중"
      : m.bat_start < 0 ? "미측정"
      : `${m.bat_start}→${m.bat_end}%`;
    // GPS — 수준(정확도 설정 모드)과 지점 수(수신한 위치 fix 개수, 유실은 경고로)를 분리
    const gpsMode = m ? escHtml(m.gps_mode) : "—";
    const gpsFix = !m ? "—"
      : `${m.fixes}${m.fixes_dropped ? ` <span class="warn">(-${m.fixes_dropped})</span>` : ""}`;
    const acc = m && m.acc_avg >= 0 ? `±${m.acc_avg}m` : "—";
    // 환경 — meta v2 부터. 빌드·기기·OS 를 각각의 열로 분리
    const build = m && m.build ? `b${escHtml(m.build)}` : "—";
    const device = m && m.device ? escHtml(m.device) : "—";
    const osVer = m && m.os ? escHtml(m.os) : "—";
    // §7-4 두 열 — meta v3 부터.
    // 저전력: low_power(시작 시점)만으로는 "잔량이 떨어져 중간에 켜진" 경우를 놓쳐 lpm 을 쓴다.
    // 전경/배경: 소모에서 화면 기여분과 순수 GPS 기여분을 가르는 열쇠.
    const lpm = !m || m.lpm === undefined ? "—"
      : m.lpm ? '<span class="warn">ON</span>' : "OFF";
    const mins = (s) => Math.round((s || 0) / 60);
    const phase = !m || m.fg_s === undefined ? "—"
      : `${mins(m.fg_s)} / ${mins(m.bg_s)}분`;
    // §7-5 — meta v4 부터. 모드별 %/h 비교의 축이라 요약 그래프도 이 값으로 묶는다.
    const batMode = !m || !m.bat_mode ? "—" : BAT_MODE_LABEL[m.bat_mode] || escHtml(m.bat_mode);
    return `<tr>
      <td>${escHtml(when)}</td>
      <td>${escHtml(r.course_name || "—")}<span class="dim"> ${escHtml(r.mountain_id || "")}</span></td>
      <td>${r.distance_km != null ? r.distance_km.toFixed(2) : "—"}km</td>
      <td>${dur}</td>
      <td>${batMode}</td>
      <td>${bat}</td>
      <td>${lpm}</td>
      <td>${rate != null ? `<b>${rate.toFixed(1)}</b>` : "—"}</td>
      <td class="dim">${phase}</td>
      <td>${gpsMode}</td>
      <td>${gpsFix}</td>
      <td>${acc}</td>
      <td class="dim">${build}</td>
      <td class="dim">${device}</td>
      <td class="dim">${osVer}</td>
      <td>${r.points}점</td>
      <td class="dim">${escHtml((r.user_id || "").slice(0, 8))}</td>
    </tr>`;
  }).join("");
  $("rec-list").innerHTML = REC.rows.length
    ? `<table class="rec-tbl"><thead><tr>
         <th>시작</th><th>코스</th><th>거리</th><th>시간</th>
         <th title="등반 배터리 모드 — 일반/절전/최대절전 (IOS.md §7-5)">모드</th>
         <th>배터리</th>
         <th title="세션 중 1회라도 저전력 모드">저전력</th>
         <th>%/h</th><th title="전경(화면 켜짐) / 배경 누적">전경/배경</th>
         <th>GPS 수준</th><th>GPS 지점</th><th>평균정확도</th>
         <th>빌드</th><th>기기</th><th>OS</th><th>트랙</th><th>사용자</th>
       </tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="dim">기록이 없습니다.</p>`;
}

$("rec-reload").onclick = loadRecords;
$("rec-dl").onclick = () => {
  const tok = adminToken ? `?token=${encodeURIComponent(adminToken)}` : "";
  location.href = "/api/records/export" + tok;
};

for (const b of document.querySelectorAll("#tabs .tab")) b.onclick = () => showTab(b.dataset.tab);
for (const b of document.querySelectorAll("#subtabs .subtab")) b.onclick = () => showSub(b.dataset.sub);

// 지도 표시 설정 오버레이 — 접기/펼치기 + 스팟/기저POI 전환
$("mapcfg-toggle").onclick = () => $("mapcfg").classList.toggle("collapsed");
for (const b of document.querySelectorAll("#mapcfg-tabs .mcfg-tab")) {
  b.onclick = () => {
    for (const t of document.querySelectorAll("#mapcfg-tabs .mcfg-tab"))
      t.classList.toggle("active", t === b);
    for (const pane of document.querySelectorAll("#mapcfg .mapcfg-pane"))
      pane.hidden = pane.dataset.cfg !== b.dataset.cfg;
  };
}

// 편집 패널 폭 조절 (남긴 유일한 배치 조작)
{
  const panel = $("editor-panel"), handle = $("panel-resize");
  const clamp = (w) => Math.max(300, Math.min(window.innerWidth - 320, w));
  const saved = +localStorage.getItem(PANELW_KEY) || 0;
  if (saved) panel.style.width = clamp(saved) + "px";
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    document.body.style.userSelect = "none";
    const move = (ev) => {
      panel.style.width = clamp(ev.clientX - panel.getBoundingClientRect().left) + "px";
      resizeMap();
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.classList.remove("dragging");
      document.body.style.userSelect = "";
      localStorage.setItem(PANELW_KEY, parseInt(panel.style.width, 10) || 380);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
}

window.addEventListener("resize", resizeMap);
showTab(localStorage.getItem(TAB_KEY) === "cu" ? "cu" : "mnt");
showSub("list");
setMountainVisible(false);      // 부팅 시엔 산 미선택 — 안내 문구 + 스팟 미리보기 힌트

// ── 표시 설정 (앱 전역 — 분류별 {줌, 기호, 크기, 볼드}) ──
// 스팟(R2 config/spot-display.json)과 기저지도 POI(config/poi-display.json)가 같은 편집기 공유.
// 노출 줌 — 스팟·POI 공용. 예전엔 스팟이 2단위(10·12·14·16·18), POI 가 0.5단위(12~16)로
// 갈려 있어 같은 "z14"가 두 화면에서 다른 의미처럼 읽혔다. 정수 1단계로 통일한다.
// 라벨의 축척은 대략치(위도 37.5° 기준) — 숫자만 보고 감이 안 오는 문제를 함께 해소.
const ZOOM_OPTS = [
  [null, "끔"], [0, "항상"],
  [10, "z10 · 광역 (20km)"], [11, "z11 · 시 전체 (10km)"],
  [12, "z12 · 산 전체 (5km)"], [13, "z13 · 산기슭 (3km)"],
  [14, "z14 · 동네 (1km)"], [15, "z15 · 들머리 (500m)"],
  [16, "z16 · 근접 (300m)"], [17, "z17 · 건물 (150m)"], [18, "z18 · 코앞 (70m)"],
];
// 글자 크기 — 4단계로 단순화. 이전엔 6~24 를 0.1 단위로 받아 8.4·8.9·9.2·9.7·10.1 처럼
// 미세하게 갈렸는데, 흑백 지도에서 그 차이는 읽히지 않고 관리만 어려웠다.
const SIZE_OPTS = [8, 10, 12, 14];
// 아이콘 자체가 없는 분류 (기저지도 도시 POI — 텍스트 전용 레이어)
const POI_NO_ICON = ["학교", "관공서", "병원", "아파트단지", "공원", "마트·쇼핑", "문화·체육"];

// ── 기호 고르개 ── 버튼 아래 뜨는 판. 형태별 탭 + 격자에서 골라 넣는다.
// 판은 하나만 만들어 재사용한다(행마다 만들면 1700칸 × 분류 수가 된다).
let symPicker = null, symPickerClose = null;

function buildSymbolPicker() {
  const box = document.createElement("div");
  box.id = "sym-picker";
  box.hidden = true;
  box.innerHTML = `<div class="sp-modes"></div>
    <div class="sp-tabs"></div><div class="sp-grid"></div>
    <div class="sp-foot">지도 글리프에 실제로 있는 <b>1696자</b> — 여기 없는 문자는 지도에서 안 그려집니다.</div>`;
  document.body.appendChild(box);

  // 바깥 클릭·Esc 로 닫기 (버튼 자신의 클릭은 openSymbolPicker 가 토글로 처리)
  document.addEventListener("mousedown", (e) => {
    if (!box.hidden && !box.contains(e.target) && !e.target.closest(".cfg-sym")) symPickerClose?.();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") symPickerClose?.(); });
  return box;
}

function openSymbolPicker(anchor, current, hasBuiltin, onPick) {
  const box = symPicker ||= buildSymbolPicker();
  if (!box.hidden && box._anchor === anchor) return symPickerClose(); // 같은 버튼 → 닫기
  box._anchor = anchor;

  symPickerClose = () => { box.hidden = true; box._anchor = null; symPickerClose = null; };
  const pick = (v) => { onPick(v); symPickerClose(); };

  // 위쪽: 끔 / 기본 아이콘
  const modes = box.querySelector(".sp-modes");
  modes.textContent = "";
  const mode = (label, value, on, note) => {
    const b = Object.assign(document.createElement("button"), {
      type: "button", textContent: label, className: on ? "on" : "", title: note || "",
    });
    b.onclick = () => pick(value);
    modes.appendChild(b);
  };
  mode("끔", false, current === false, "기호 없이 이름만");
  mode(hasBuiltin ? "기본 아이콘" : "기본 아이콘 없음", true, current === true,
    hasBuiltin ? "손으로 그린 뱃지 아이콘" : "이 분류는 기본 아이콘이 없어 아무것도 안 나옵니다");
  if (!hasBuiltin) modes.lastChild.classList.add("warn");

  // 형태 탭 + 격자
  const tabs = box.querySelector(".sp-tabs");
  const grid = box.querySelector(".sp-grid");
  const cur = symChar(current);
  const showGroup = (g, btn) => {
    for (const t of tabs.children) t.classList.toggle("on", t === btn);
    grid.textContent = "";
    grid.scrollTop = 0;
    for (const ch of g.chars) {
      const b = Object.assign(document.createElement("button"), {
        type: "button", textContent: ch, className: ch === cur ? "on" : "",
      });
      b.onclick = () => pick(ch);
      grid.appendChild(b);
    }
  };
  tabs.textContent = "";
  // 지금 고른 문자가 든 묶음을 열어 둔다 (없으면 첫 묶음)
  const start = SYMBOL_GROUPS.findIndex((g) => cur && g.chars.includes(cur));
  SYMBOL_GROUPS.forEach((g, i) => {
    const t = Object.assign(document.createElement("button"), { type: "button", textContent: g.name });
    t.onclick = () => showGroup(g, t);
    tabs.appendChild(t);
    if (i === (start < 0 ? 0 : start)) showGroup(g, t);
  });

  // 버튼 아래에 띄우되 화면 밖으로 나가지 않게
  box.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
  box.style.top = (r.bottom + h + 8 > innerHeight && r.top - h - 4 > 0
    ? r.top - h - 4 : r.bottom + 4) + "px";
}

// 컨트롤 + 캡션 묶음
function ctl(caption, el) {
  const w = document.createElement("span");
  w.className = "cfg-ctl";
  w.append(Object.assign(document.createElement("small"), { textContent: caption }), el);
  return w;
}

// 설정 섹션 바인딩 — load 함수를 돌려준다.
// onChange(categories): 값이 바뀔 때마다(저장 전에도) 호출 — 편집 지도 라이브 미리보기용.
function bindDisplayCfg(apiPath, prefix, noIconCats = [], onChange = null) {
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
      // 목록 밖 저장값(예전 0.5 단위)도 사라지지 않게 보여준다 — 고르면 정수로 정리된다.
      const opts = ZOOM_OPTS.some(([v]) => v === val.zoom) ? ZOOM_OPTS
        : [...ZOOM_OPTS, [val.zoom, `z${val.zoom} (이전 값)`]];
      for (const [v, label] of opts) {
        const o = document.createElement("option");
        o.value = v === null ? "" : v;
        o.textContent = label;
        o.selected = v === val.zoom;
        sel.appendChild(o);
      }
      sel.onchange = () => { val.zoom = sel.value === "" ? null : +sel.value; dirty(); };
      // 기호 — 3상: 끔 / 기본 아이콘 / 문자 (val.icon = false | true | "★")
      // 버튼 하나로 셋을 다 고른다. 예전엔 체크박스 + 자유 입력이었는데, 쓸 수 있는
      // 문자가 정해져 있어(글리프가 있는 것만) 직접 타이핑하면 안 그려지는 글자를
      // 넣기 쉬웠다 — 고르개는 애초에 되는 것만 보여 준다.
      const hasBuiltin = !noIconCats.includes(cat);
      const symBtn = document.createElement("button");
      symBtn.className = "cfg-sym";
      symBtn.type = "button";
      symBtn.title = hasBuiltin
        ? "기호 고르기 — 끔 · 기본 아이콘 · 문자"
        : "이 분류는 기본 아이콘이 없습니다 — 문자를 골라야 기호가 생깁니다";
      const paintSym = () => {
        const ch = symChar(val.icon);
        symBtn.textContent = ch || (val.icon === true ? "기본" : "끔");
        symBtn.classList.toggle("is-char", !!ch);
        symBtn.classList.toggle("is-off", val.icon === false);
        // 기본 아이콘이 없는 분류에서 "기본" = 아무것도 안 나온다 → 눈에 띄게
        symBtn.classList.toggle("warn", !hasBuiltin && val.icon === true);
      };
      symBtn.onclick = () => openSymbolPicker(symBtn, val.icon, hasBuiltin, (next) => {
        val.icon = next; paintSym(); dirty();
      });
      paintSym();
      // 글자 크기 — 4단계 선택. 예전 값(8.4·9.2·10.1 등)은 가장 가까운 단계로 보여주고,
      // 저장하면 그 값으로 정규화된다(단순화가 목적이라 원래 값을 남기지 않는다).
      const size = document.createElement("select");
      const near = SIZE_OPTS.reduce((a, b) =>
        Math.abs(b - val.size) < Math.abs(a - val.size) ? b : a);
      for (const px of SIZE_OPTS) {
        const o = document.createElement("option");
        o.value = px;
        o.textContent = `${px}px`;
        o.selected = px === near;
        size.appendChild(o);
      }
      if (near !== val.size) val.size = near;   // 표시와 저장값을 일치시킨다
      size.onchange = () => { val.size = +size.value; dirty(); };
      // 볼드
      const bold = document.createElement("input");
      bold.type = "checkbox";
      bold.checked = val.bold;
      bold.onchange = () => { val.bold = bold.checked; dirty(); };

      row.append(
        Object.assign(document.createElement("span"), { textContent: cat, className: "cfg-cat" }),
        ctl("줌", sel), ctl("기호", symBtn), ctl("크기", size), ctl("볼드", bold));
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
const loadSpotCfg = bindDisplayCfg("/config/spots", "spotcfg", [], (cats) => {
  spotCfgLive = cats;
  applySpotEditorStyle();
});
const loadPoiCfg = bindDisplayCfg("/config/poi", "poicfg", POI_NO_ICON, (cats) => {
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

// 항목의 대표산 이름 (지난 큐레이션 목록 메타)
const cuMountainName = (cu) => {
  const it = (cu.items || [])[0];
  return it ? (it.type === "mountain" ? it.name : (it.mountain || "")) : "(항목 없음)";
};

const cuExpanded = new Set(); // 펼쳐서 편집 중인 지난 큐레이션 id

// ── 드래그 정렬 ── 큐레이션끼리(#cu-list) · 항목끼리(각 ul.cu-items) 공통.
// 잡이(.cu-grip)를 누르는 동안에만 draggable 을 켠다 — 안 그러면 슬라이드 위 입력의
// 텍스트 선택이 드래그로 가로채인다. (코스 목록 .c-grip 과 같은 방식)
function makeSortable(container, itemSel, axis, onCommit) {
  container.addEventListener("dragover", (e) => {
    const dragging = container.querySelector(itemSel + ".dragging");
    if (!dragging) return; // 파일을 끌어온 경우 — 여기서 손대지 않는다 (커버 이미지 드롭)
    e.preventDefault();
    let best = null, bestD = Infinity;
    for (const el of container.querySelectorAll(itemSel)) {
      if (el === dragging) continue;
      const r = el.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (d < bestD) { bestD = d; best = el; }
    }
    if (!best) return;
    const r = best.getBoundingClientRect();
    // 세로 목록은 위/아래로, 카드 그리드는 같은 줄이면 좌/우로 판정
    const after = axis === "grid"
      ? (e.clientY > r.bottom ? true : e.clientY < r.top ? false : e.clientX > r.left + r.width / 2)
      : e.clientY > r.top + r.height / 2;
    if (after) best.after(dragging); else best.before(dragging);
  });
  container.addEventListener("drop", (e) => {
    if (container.querySelector(itemSel + ".dragging")) e.preventDefault();
  });
}

function attachGrip(el, grip, key, onCommit) {
  grip.addEventListener("mousedown", () => { el.draggable = true; });
  grip.addEventListener("mouseup", () => { el.draggable = false; });
  el.addEventListener("dragstart", (e) => {
    el.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", key); // Firefox 는 데이터 없으면 드래그 미시작
  });
  el.addEventListener("dragend", () => {
    el.draggable = false;
    el.classList.remove("dragging");
    onCommit();
  });
}

// 화면에 놓인 순서를 데이터 순서로 — 맨 위 큐레이션이 앱에 노출된다
function commitCuOrder() {
  const order = [...$("cu-list").children].map((el) => el._cu).filter(Boolean);
  if (order.length !== curDoc.curations.length) return; // 방어: 개수가 안 맞으면 무시
  curDoc.curations = order;
  renderCurations(); cuDirty();
}
makeSortable($("cu-list"), ".cu-entry", "y", commitCuOrder);

function renderCurations() {
  const box = $("cu-list");
  box.innerHTML = "";
  if (!curDoc.curations.length) {
    box.innerHTML = '<p class="dim" style="margin:6px 0">등록된 큐레이션이 없습니다. ＋ 새 큐레이션으로 시작하세요.</p>';
    return;
  }
  // 첫 번째 = 앱에 노출 중인 매거진(항상 펼침), 나머지 = 지난 큐레이션(썸네일 행 → 클릭 시 편집)
  curDoc.curations.forEach((cu, i) => {
    const el = (i === 0 || cuExpanded.has(cu.id)) ? curationBlock(cu) : pastCurationRow(cu);
    el.classList.add("cu-entry");
    el._cu = cu;
    box.appendChild(el);
  });
  growSlideFields();
}

const gripEl = (title) => Object.assign(document.createElement("span"), {
  className: "cu-grip", textContent: "⠿", title,
});

// 제목·설명 textarea 를 내용 높이에 맞춘다.
// 숨겨진 요소는 scrollHeight 가 0 이라 그대로 쓰면 칸이 찌그러진다 — 그럴 땐 건드리지 않고
// 탭이 보이는 시점(showTab)에 다시 잰다.
function growField(el) {
  if (!el.isConnected || !el.offsetParent) return;
  el.style.height = "auto";
  if (el.scrollHeight) el.style.height = el.scrollHeight + "px";
}
function growSlideFields() {
  requestAnimationFrame(() => {
    for (const el of document.querySelectorAll(".cu-slide textarea")) growField(el);
  });
}

function pastCurationRow(cu) {
  const row = document.createElement("div");
  row.className = "cu-past";
  const grip = gripEl("끌어서 순서 변경 (맨 위 = 앱 노출)");

  const open = document.createElement("div");
  open.className = "cu-past-open";
  open.title = "클릭해서 편집";
  open.append(
    Object.assign(document.createElement("span"), { className: "cu-past-title", textContent: cu.title || "(이름 없음)" }),
    Object.assign(document.createElement("span"), {
      className: "cu-past-meta", textContent: `${cuMountainName(cu)} · ${cu.items.length}장`,
    }));
  open.onclick = () => { cuExpanded.add(cu.id); renderCurations(); };

  // 펼치지 않고도 내용을 알아보게 — 앞 5장 커버 썸네일
  const thumbs = document.createElement("div");
  thumbs.className = "cu-thumbs";
  for (const it of cu.items.slice(0, 5)) {
    const t = document.createElement("i");
    if (it.img) t.style.backgroundImage = `url("${it.img}")`;
    thumbs.appendChild(t);
  }

  row.append(grip, open, thumbs);
  attachGrip(row, grip, cu.id, commitCuOrder);
  return row;
}

// 항목 하나 = 앱 캐러셀 슬라이드와 같은 정사각 카드.
// 글자 입력을 앱에서 놓이는 자리에 그대로 얹어, 위치를 설명할 필요가 없게 했다.
function itemCard(cu, it, commitItems) {
  const li = document.createElement("li");
  li.className = "cu-card";
  li._item = it;

  const slide = document.createElement("div");
  slide.className = "cu-slide";
  if (it.img) slide.append(Object.assign(document.createElement("img"), { className: "cs-img", src: it.img, alt: "" }));
  slide.append(Object.assign(document.createElement("div"), { className: "cs-shade" }));

  // 전부 선택 항목 — 비우면 앱에서 그 요소를 아예 렌더하지 않는다 (app.js)
  // 제목·설명은 앱에서 여러 줄로 감기므로 textarea 로 (한 줄 input 이면 긴 글이 잘려
  // "본 대로 나온다"는 전제가 깨진다). 높이는 내용에 맞춰 자란다.
  const field = (key, cls, ph, multiline) => {
    const el = document.createElement(multiline ? "textarea" : "input");
    Object.assign(el, { className: cls, placeholder: ph, value: it[key] || "" });
    if (multiline) {
      el.rows = 1;
      el.addEventListener("input", () => growField(el));
    }
    el.onchange = () => { it[key] = el.value.trim(); cuDirty(); };
    return el;
  };
  slide.append(
    field("sub", "cs-sub", "부가설명"),
    field("title", "cs-title", "제목", true),
    field("desc", "cs-desc", "설명", true),
    field("logo", "cs-logo", "로고"),
    field("credit", "cs-credit", "출처"));

  // 커버 이미지 → R2 images/mountains/<카드별 고유 키>
  // 예전엔 산코드 키를 같은 산 카드끼리 공유했는데, 한 카드의 교체가 다른 카드까지
  // 바꾸는 결합이 생겨 폐기(2026-08-02) — 업로드마다 <산코드>-<hex> 고유 키를 쓴다.
  const file = Object.assign(document.createElement("input"), {
    // gif = 큐레이션 움짤 — 앱 캐러셀 <img> 에서 자동 재생 (iOS 는 GifView)
    type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", hidden: true,
  });
  const imgBtn = Object.assign(document.createElement("button"), {
    className: "cs-img-btn", textContent: it.img ? "사진 교체" : "＋ 사진",
    title: it.img ? `현재: ${it.img}` : "클릭하거나 카드에 사진 파일을 끌어 놓으세요",
  });
  const upload = async (f) => {
    if (!f) return;
    imgBtn.textContent = "올리는 중…"; imgBtn.disabled = true;
    try {
      const key = it.type === "free" ? it.code
        : `${it.code}-${Math.random().toString(16).slice(2, 8)}`;
      const r = await api(`/mountain-image?code=${key}`, {
        method: "POST", headers: { "Content-Type": f.type }, body: f,
      });
      it.img = r.url;
      cuDirty(); renderCurations();
    } catch (e) {
      imgBtn.textContent = "실패"; imgBtn.title = e.message; imgBtn.disabled = false;
    }
  };
  imgBtn.onclick = () => file.click();
  file.onchange = () => upload(file.files[0]);

  // 카드에 사진 파일을 끌어 놓아도 업로드 (순서 드래그와 types 로 구분)
  const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  slide.addEventListener("dragover", (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); e.stopPropagation(); slide.classList.add("drop");
  });
  slide.addEventListener("dragleave", () => slide.classList.remove("drop"));
  slide.addEventListener("drop", (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); e.stopPropagation(); slide.classList.remove("drop");
    upload(e.dataTransfer.files[0]);
  });

  const grip = gripEl("끌어서 순서 변경");
  const rm = Object.assign(document.createElement("button"), { textContent: "×", title: "항목 제거" });
  rm.onclick = () => {
    cu.items = cu.items.filter((x) => x !== it);
    renderCurations(); cuDirty();
  };
  const tools = document.createElement("div");
  tools.className = "cs-tools";
  tools.append(grip, imgBtn, rm);
  slide.append(tools, file);

  const meta = document.createElement("div");
  meta.className = "cs-meta";
  const swapBtn = Object.assign(document.createElement("button"), {
    className: "cu-swap", textContent: "변경",
    title: "연결된 산/코스를 바꿉니다 — 문구·사진은 유지(다른 산이면 사진은 그 산 커버로)",
  });
  meta.append(
    Object.assign(document.createElement("span"), {
      className: "cu-kind",
      textContent: { free: "자유", mountain: "산", course: "코스", spot: "스팟" }[it.type] || it.type,
    }),
    Object.assign(document.createElement("span"), {
      className: "cu-name",
      textContent: it.type === "free" ? (it.url ? "" : "연결 없음")
        : it.type === "course" || it.type === "spot" ? `${it.mountain} · ${it.name}` : it.name,
    }),
    swapBtn);

  // 빈 카드 전용 — 외부 링크 URL (탭하면 이동, https 만 저장됨)
  if (it.type === "free") {
    const urlIn = Object.assign(document.createElement("input"), {
      className: "cu-url", type: "url", value: it.url || "",
      placeholder: "링크 URL (선택 — 탭하면 이동, https://)",
      title: "비우면 순수 콘텐츠 카드(탭해도 이동 없음)",
    });
    urlIn.onchange = () => {
      const v = urlIn.value.trim();
      if (v) it.url = v; else delete it.url;
      cuDirty();
    };
    meta.insertBefore(urlIn, swapBtn);
  }

  // 대상 변경 — 메타 줄을 검색 입력으로 바꿔 산·코스를 다시 고른다(추가 검색과 동일한 소스).
  // 문구(sub/title/desc/logo/credit)는 유지, 사진은 산이 달라지면 그 산의 기존 커버로 교체(없으면 제거).
  swapBtn.onclick = () => {
    const q = Object.assign(document.createElement("input"), {
      type: "search", placeholder: "바꿀 산·코스 검색", autocomplete: "off",
    });
    const res = Object.assign(document.createElement("ul"), { className: "cu-results" });
    res.hidden = true;
    const cancel = Object.assign(document.createElement("button"), { className: "cu-swap", textContent: "취소" });
    cancel.onclick = () => renderCurations();
    meta.innerHTML = "";
    meta.append(q, cancel, res);
    q.focus();
    let seq2 = 0;
    q.oninput = async () => {
      const kw = q.value.trim();
      const my = ++seq2;
      if (!kw) { res.hidden = true; return; }
      const [mts, courses, spots] = await Promise.all([
        api("/mountains").then((l) => l.filter((m) => m.name.includes(kw)).slice(0, 5)).catch(() => []),
        api(`/course-search?q=${encodeURIComponent(kw)}`).catch(() => []),
        api(`/spot-search?q=${encodeURIComponent(kw)}`).catch(() => []),
      ]);
      if (my !== seq2) return;
      res.innerHTML = "";
      const pick = (label, tgt) => {
        const li2 = document.createElement("li");
        li2.textContent = label;
        li2.onclick = () => {
          // 문구·사진 전부 유지 — 사진이 새 대상과 안 맞으면 운영자가 [사진 교체]로 바꾼다
          // (자동 제거는 애써 올린 썸네일을 날리는 부작용이 더 컸다, 2026-08-01 피드백).
          it.type = tgt.type; it.code = tgt.code;
          if (tgt.type === "free") { delete it.name; delete it.mountain; }
          else {
            it.name = tgt.name;
            if (tgt.mountain) it.mountain = tgt.mountain; else delete it.mountain;
          }
          if (tgt.coord) it.coord = tgt.coord; else delete it.coord;
          if (tgt.type !== "free") delete it.url;   // 링크는 빈 카드 전용
          renderCurations(); cuDirty();
        };
        res.appendChild(li2);
      };
      for (const m of mts)
        pick(`산 · ${m.name} (${m.code})${m.published ? "" : " — 비공개"}`,
          { type: "mountain", code: m.code, name: m.name });
      for (const c of courses.slice(0, 10))
        pick(`코스 · ${c.mountain} — ${c.name}${c.status !== "ready" ? " (비공개 코스)" : ""}`,
          { type: "course", code: c.code, name: c.name, mountain: c.mountain });
      for (const s of spots.slice(0, 8))
        pick(`스팟 · ${s.mountain} — ${s.name}`,
          { type: "spot", code: s.code, name: s.name, mountain: s.mountain, coord: s.coord });
      if (it.type !== "free")
        pick("자유 · 연결 없음(빈 카드)으로 전환",
          { type: "free", code: "free-" + Math.random().toString(16).slice(2, 10) });
      if (!res.children.length) res.innerHTML = '<li class="dup">검색 결과 없음</li>';
      res.hidden = false;
    };
  };

  li.append(slide, meta);
  attachGrip(li, grip, it.code || "", commitItems);
  return li;
}

function curationBlock(cu) {
  const isLive = curDoc.curations[0] === cu; // 앱 노출 중 여부
  const div = document.createElement("div");
  div.className = "cu-block" + (isLive ? " live" : "");

  // 제목 + (노출 배지 | 맨 위로·접기) + 삭제
  const head = document.createElement("div");
  head.className = "cu-head";
  const grip = gripEl("끌어서 순서 변경 (맨 위 = 앱 노출)");
  const title = Object.assign(document.createElement("input"), {
    className: "cu-title", placeholder: "큐레이션 이름 (예: 가을 단풍 추천)", value: cu.title || "",
  });
  title.onchange = () => { cu.title = title.value.trim(); cuDirty(); };
  head.append(grip, title);
  if (isLive) {
    head.append(Object.assign(document.createElement("span"), {
      className: "cu-live", textContent: "앱에 노출 중", title: "앱 추천 탭 캐러셀에 노출되는 매거진",
    }));
  } else {
    const promote = Object.assign(document.createElement("button"), {
      textContent: "맨 위로", title: "이 큐레이션을 앱 캐러셀 매거진으로 (끌어 올려도 됩니다)",
    });
    promote.onclick = () => {
      curDoc.curations = [cu, ...curDoc.curations.filter((x) => x !== cu)];
      cuExpanded.delete(cu.id);
      renderCurations(); cuDirty();
    };
    const fold = Object.assign(document.createElement("button"), { textContent: "접기" });
    fold.onclick = () => { cuExpanded.delete(cu.id); renderCurations(); };
    head.append(promote, fold);
  }
  const del = Object.assign(document.createElement("button"), { className: "danger", textContent: "삭제" });
  del.onclick = () => {
    if (!confirm(`큐레이션 "${cu.title || "(이름 없음)"}" 삭제?`)) return;
    curDoc.curations = curDoc.curations.filter((x) => x !== cu);
    renderCurations(); cuDirty();
  };
  head.append(del);

  // 항목 카드 그리드 — 순서가 곧 캐러셀 순서
  const ul = document.createElement("ul");
  ul.className = "cu-items";
  const commitItems = () => {
    const order = [...ul.children].map((el) => el._item).filter(Boolean);
    if (order.length !== cu.items.length) return;
    cu.items = order; cuDirty(); // DOM 은 이미 새 순서 — 다시 그리지 않는다(깜빡임 방지)
  };
  for (const it of cu.items) ul.appendChild(itemCard(cu, it, commitItems));
  makeSortable(ul, ".cu-card", "grid", commitItems);
  if (!cu.items.length) {
    ul.innerHTML = '<p class="dim" style="margin:2px">아래에서 산·코스를 검색해 추가하세요.</p>';
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
    // 산: 관리 중인 초안 목록에서 이름 매칭 / 코스·스팟: 서버 검색
    const [mts, courses, spots] = await Promise.all([
      api("/mountains").then((l) => l.filter((m) => m.name.includes(kw)).slice(0, 5)).catch(() => []),
      api(`/course-search?q=${encodeURIComponent(kw)}`).catch(() => []),
      api(`/spot-search?q=${encodeURIComponent(kw)}`).catch(() => []),
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
          // 로고 기본값만 프리필. 같은 산 커버 자동 재사용은 폐기(2026-08-02) —
          // 스팟 카드가 엉뚱한 산 사진을 물려받는 혼란이 커서 새 카드는 항상 빈 배경.
          cu.items.push({ ...item, logo: "© 하이하잇" });
          renderCurations(); cuDirty();
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
    for (const s of spots.slice(0, 8))
      row(`스팟 · ${s.mountain} — ${s.name}`,
        { type: "spot", code: s.code, name: s.name, mountain: s.mountain, coord: s.coord });
    if (!res.children.length) res.innerHTML = '<li class="dup">검색 결과 없음</li>';
    res.hidden = false;
  };
  // 빈 카드 — 산/코스 연결 없는 순수 콘텐츠 슬라이드 (문구·사진·움짤만, 탭해도 이동 없음)
  const freeBtn = Object.assign(document.createElement("button"), {
    className: "cu-free-add", textContent: "＋ 빈 카드",
    title: "산/코스 연결 없는 슬라이드 — 문구·사진(움짤)만 노출, 탭해도 이동하지 않음",
  });
  freeBtn.onclick = () => {
    cu.items.push({ type: "free", code: "free-" + Math.random().toString(16).slice(2, 10),
                    logo: "© 하이하잇" });
    renderCurations(); cuDirty();
  };
  addWrap.append(q, freeBtn, res);

  div.append(head, ul, addWrap);
  return div;
}

$("cu-new").onclick = () => {
  if (!curDoc) curDoc = { version: 1, curations: [] };
  const cu = { id: "cu-" + Math.random().toString(36).slice(2, 10), title: "", items: [] };
  curDoc.curations.push(cu);
  cuExpanded.add(cu.id); // 새 큐레이션은 바로 펼쳐 편집 (노출 전환은 맨 위로 끌기)
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

// 큐레이션 xlsx 백업 — 내려받기 / 업로드(전체 교체, 서버가 직전 상태를 backups/ 에 스냅샷)
$("cu-dl").onclick = () => {
  const tok = adminToken ? `?token=${encodeURIComponent(adminToken)}` : "";
  location.href = "/api/curations/export" + tok;
};
$("cu-ul").onclick = () => $("cu-file").click();
$("cu-file").onchange = async () => {
  const f = $("cu-file").files[0];
  $("cu-file").value = "";
  if (!f) return;
  if (!confirm("업로드하면 현재 큐레이션 전체가 파일 내용으로 교체됩니다.\n(직전 상태는 자동 백업됩니다)")) return;
  cuState("가져오는 중…");
  const headers = adminToken ? { "X-Admin-Token": adminToken } : {};
  const r = await fetch("/api/curations/import", { method: "POST", headers, body: f });
  const res = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (res.error) { cuState("가져오기 실패: " + res.error); return; }
  curDoc = res;
  renderCurations();
  cuState("가져오기 완료 ✓ (앱 새로고침 시 반영)");
};

// ── 배포 버전 표시 ──
// 원격(EC2) 체크아웃에서 "git pull 이 반영됐는지"를 눈으로 확인하기 위한 것.
// 서버가 요청 시점의 git HEAD 를 읽어 주므로 정적 파일만 pull 해도 즉시 갱신된다.
// dirty = 추적 파일에 수정 있음 — admin_data/ 를 쓰는 서버 특성상 관리자 작업 후엔
// 보통 켜지며, 다음 pull 이 충돌할 수 있다는 신호다.
async function loadVersion() {
  const el = $("app-version");
  try {
    const v = await api("/version");
    if (!v.commit) { el.textContent = ""; return; }
    el.textContent = `${v.commit}${v.dirty ? " *" : ""} · ${v.date}`;
    el.title = `${v.subject}\n${v.date}` + (v.dirty ? "\n\n* 추적 파일에 수정 있음 (pull 충돌 주의)" : "");
  } catch (_) { el.textContent = ""; }
}

// ── 부팅 ── (401 이면 api() 가 로그인 게이트를 띄움)
refreshList().catch(() => {});
loadSpotCfg().catch(() => {});
loadPoiCfg().catch(() => {});
loadCurations().catch(() => {});
loadVersion().catch(() => {});

// ── 시트 — 산 메타·스팟 일괄 편집 (그리드 + xlsx 왕복, /api/sheet*) ──────────
// 행 스키마는 서버 sheet_lib 과 동일(왕복 대칭). 저장/가져오기는 서버가 diff 를 계산해
// 자동 백업 후 병합한다. 시트 변경은 draft 만 바꾸므로 앱 반영에는 해당 산 재발행이 필요.
const SHEET = { mnts: [], spots: [], backups: [], file: null };
const SH_CATS = ["정상", "장소", "조망점", "화장실", "정자", "헬기장", "음수대",
                 "주차장", "분기점", "시종점"];  // 서버 SPOT_DISPLAY_DEFAULT 와 일치 유지

// api() 는 JSON 오류를 message 로만 던진다 — 시트는 행 단위 오류 배열이 필요해 원본을 받는다.
async function shFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (adminToken) headers["X-Admin-Token"] = adminToken;
  const r = await fetch("/api" + path, { ...opts, headers });
  if (r.status === 401) showLogin();
  return r.json().catch(() => ({ error: `HTTP ${r.status}` }));
}

async function loadSheet() {
  $("sh-state").textContent = "불러오는 중…";
  try {
    const d = await shFetch("/sheet");
    if (d.error) throw new Error(d.error);
    SHEET.mnts = d.mountains;
    SHEET.spots = d.spots;
    SHEET.backups = d.backups || [];
    renderSheet();
    $("sh-state").textContent = `산 ${SHEET.mnts.length} · 스팟 ${SHEET.spots.length}`;
  } catch (e) {
    $("sh-state").textContent = "실패: " + e.message;
  }
}

const shInput = (k, v, type, ro = false) => {
  if (type === "bool")
    return `<input type="checkbox" data-k="${k}" ${v ? "checked" : ""} ${ro ? "disabled" : ""}>`;
  const val = v === null || v === undefined ? "" : escHtml(v);
  if (ro) return `<span class="sh-ro" data-k="${k}">${val}</span>`;
  const num = type === "num" ? ' type="number" step="any"' : "";
  const list = type === "cat" ? ' list="sh-cats"' : "";
  return `<input class="sh-in sh-${type}" data-k="${k}"${num}${list} value="${val}">`;
};

function renderSheet() {
  $("sh-mnt").innerHTML =
    `<tr><th>산코드</th><th>이름</th><th>지역</th><th>해발</th><th>순서</th>
      <th>100대</th><th>BAC</th><th>KNPS</th><th>공개</th><th>발행</th></tr>` +
    SHEET.mnts.map((m, i) => `<tr data-i="${i}" data-code="${m.code}">
      <td class="dim">${m.code}</td>
      <td>${shInput("name", m.name, "text")}</td>
      <td>${shInput("region", m.region, "text")}</td>
      <td>${shInput("elev", m.elev, "num")}</td>
      <td>${shInput("sort_order", m.sort_order, "num")}</td>
      <td>${shInput("famous", m.famous, "bool")}</td>
      <td>${shInput("bac100", m.bac100, "bool")}</td>
      <td>${shInput("knps", m.knps, "bool")}</td>
      <td>${shInput("published", m.published, "bool")}</td>
      <td class="dim">${m.pack_version ? "v" + m.pack_version : "—"}</td>
    </tr>`).join("");

  const fsel = $("sh-filter");
  const cur = fsel.value;
  fsel.innerHTML = `<option value="">전체 산</option>` +
    SHEET.mnts.map((m) => `<option value="${m.code}">${escHtml(m.name)}</option>`).join("");
  fsel.value = [...fsel.options].some((o) => o.value === cur) ? cur : "";
  $("sh-addspot").disabled = !fsel.value;

  if (!document.getElementById("sh-cats")) {
    const dl = document.createElement("datalist");
    dl.id = "sh-cats";
    dl.innerHTML = SH_CATS.map((c) => `<option value="${c}">`).join("");
    document.body.appendChild(dl);
  }
  renderSpotRows();
  renderBackups();
  $("sh-save").disabled = true;
}

function renderSpotRows() {
  const code = $("sh-filter").value;
  const rows = SHEET.spots.map((s, i) => ({ s, i }))
    .filter(({ s }) => !code || s.code === code);
  $("sh-spots").innerHTML =
    `<tr><th>산</th><th>분류</th><th>이름</th><th>위도</th><th>경도</th><th>상세</th>
      <th>비고</th><th>주봉</th><th>줌</th><th>기호</th><th>크기</th><th>볼드</th><th>삭제</th></tr>` +
    rows.map(({ s, i }) => `<tr data-i="${i}" data-code="${s.code}" data-id="${escHtml(s.id || "")}"
        class="${s.deleted ? "sh-del" : ""}${s.id ? "" : " sh-new"}">
      <td class="dim">${escHtml(s.mountain || s.code)}${s.id ? "" : " <b>신규</b>"}</td>
      <td>${shInput("category", s.category, "cat")}</td>
      <td>${shInput("name", s.name, "text")}</td>
      <td>${shInput("lat", s.lat, "num")}</td>
      <td>${shInput("lng", s.lng, "num")}</td>
      <td>${shInput("detail", s.detail, "text")}</td>
      <td>${shInput("etc", s.etc, "text")}</td>
      <td>${shInput("main", s.main, "bool")}</td>
      <td>${shInput("disp_zoom", s.disp_zoom, "num")}</td>
      <td>${shInput("disp_icon", s.disp_icon === true ? "TRUE" : s.disp_icon === false ? "FALSE" : s.disp_icon, "text")}</td>
      <td>${shInput("disp_size", s.disp_size, "num")}</td>
      <td>${shInput("disp_bold", s.disp_bold, "bool")}</td>
      <td>${shInput("deleted", s.deleted, "bool")}</td>
    </tr>`).join("");
}

function renderBackups() {
  const sel = $("sh-backup");
  sel.innerHTML = `<option value="">백업…</option>` +
    SHEET.backups.map((b) =>
      `<option value="${b.ts}">${b.ts} (${b.codes.length}산)</option>`).join("");
  $("sh-restore").disabled = !sel.value;
}

// DOM → 서버 행 스키마. 그리드가 보여주는 값이 곧 보낼 값(행 = 전체 상태).
function collectSheetRows() {
  const read = (tr) => {
    const out = {};
    for (const el of tr.querySelectorAll("[data-k]"))
      out[el.dataset.k] = el.type === "checkbox" ? el.checked
        : (el.value ?? el.textContent).trim();
    return out;
  };
  const mountains = [...$("sh-mnt").querySelectorAll("tr[data-i]")].map((tr) => ({
    ...read(tr), code: tr.dataset.code, _row: `산 ${tr.dataset.code}`,
  }));
  const spots = [...$("sh-spots").querySelectorAll("tr[data-i]")].map((tr) => ({
    ...read(tr), code: tr.dataset.code, id: tr.dataset.id, _row: `스팟 ${tr.dataset.id || "신규"}`,
  }));
  return { mountains, spots };
}

function sheetResult(res) {
  if (res.errors?.length) {
    $("sh-state").textContent = "오류: " + res.errors[0] +
      (res.errors.length > 1 ? ` (외 ${res.errors.length - 1}건)` : "");
    return false;
  }
  const codes = res.codes || [];
  $("sh-state").textContent = codes.length
    ? `적용 완료 (백업 ${res.backup}) — 재발행 필요: ${codes.join(", ")}`
    : "변경 없음";
  return true;
}

// 산 / 스팟 서브탭 — 표를 하나씩 전체 높이로. 스팟 도구(산 필터·추가)는 스팟 탭에서만.
function showShSub(name) {
  $("sh-sec-mnt").hidden = name !== "mnt";
  $("sh-sec-spots").hidden = name !== "spots";
  $("sh-spot-tools").hidden = name !== "spots";
  for (const b of document.querySelectorAll("#sh-tabs .sh-tab"))
    b.classList.toggle("active", b.dataset.sh === name);
}
for (const b of document.querySelectorAll("#sh-tabs .sh-tab"))
  b.onclick = () => showShSub(b.dataset.sh);

$("sh-reload").onclick = () => loadSheet();
$("sh-mnt").addEventListener("input", () => { $("sh-save").disabled = false; });
$("sh-spots").addEventListener("input", () => { $("sh-save").disabled = false; });
$("sh-filter").onchange = () => { renderSpotRows(); $("sh-addspot").disabled = !$("sh-filter").value; };

$("sh-addspot").onclick = () => {
  const code = $("sh-filter").value;
  if (!code) return;
  const m = SHEET.mnts.find((x) => x.code === code);
  SHEET.spots.push({ code, mountain: m?.name, id: "", category: "장소", name: null,
                     lat: null, lng: null, detail: null, etc: null, main: false,
                     disp_zoom: null, disp_icon: null, disp_size: null,
                     disp_bold: null, deleted: false });
  renderSpotRows();
  $("sh-save").disabled = false;
};

$("sh-save").onclick = async () => {
  $("sh-state").textContent = "저장 중…";
  const res = await shFetch("/sheet", { method: "PUT", body: JSON.stringify(collectSheetRows()) });
  if (res.error) { $("sh-state").textContent = "실패: " + res.error; return; }
  if (sheetResult(res)) loadSheet();
};

$("sh-dl").onclick = () => {
  const tok = adminToken ? `?token=${encodeURIComponent(adminToken)}` : "";
  location.href = "/api/sheet/export" + tok;
};

$("sh-ul").onclick = () => $("sh-file").click();
$("sh-file").onchange = async () => {
  const f = $("sh-file").files[0];
  $("sh-file").value = "";
  if (!f) return;
  SHEET.file = f;
  $("sh-state").textContent = "검사 중…";
  const plan = await shFetch("/sheet/import", { method: "POST", body: f });
  if (plan.error) { $("sh-state").textContent = "실패: " + plan.error; return; }
  showSheetDiff(plan);
  $("sh-state").textContent = "";
};

const fmtV = (v) => v === null || v === undefined || v === "" ? "빈 값"
  : Array.isArray(v) ? v.map((x) => Array.isArray(x) ? x.join(",") : x).join(" · ") || "빈 값"
  : String(v);

function showSheetDiff(plan) {
  const rows = [];
  if (plan.errors.length)
    rows.push(`<div class="sh-err"><b>오류 ${plan.errors.length}건 — 수정 후 다시 올리세요</b><ul>` +
      plan.errors.map((e) => `<li>${escHtml(e)}</li>`).join("") + "</ul></div>");
  if (plan.warnings.length)
    rows.push(`<div class="sh-warn"><ul>` +
      plan.warnings.map((e) => `<li>${escHtml(e)}</li>`).join("") + "</ul></div>");
  const chg = (c) => Object.entries(c).map(([k, [a, b]]) =>
    `${k}: ${escHtml(fmtV(a))} → <b>${escHtml(fmtV(b))}</b>`).join(", ");
  for (const m of plan.mountains)
    rows.push(`<div class="sh-line">[산] ${escHtml(m.name)} (${m.code}) — ${chg(m.changes)}</div>`);
  for (const s of plan.spots)
    rows.push(`<div class="sh-line">[스팟 ${s.action}] ${s.code} · ${escHtml(s.category || "")} ` +
      `${escHtml(s.name || "")}${s.changes ? " — " + chg(s.changes) : ""}</div>`);
  if (!plan.mountains.length && !plan.spots.length && !plan.errors.length)
    rows.push(`<div class="sh-line dim">변경 없음 — 현재 데이터와 동일합니다.</div>`);
  $("sh-diff-body").innerHTML = rows.join("");
  $("sh-diff-apply").disabled =
    !!plan.errors.length || (!plan.mountains.length && !plan.spots.length);
  $("sh-diff").hidden = false;
}

$("sh-diff-cancel").onclick = () => { $("sh-diff").hidden = true; SHEET.file = null; };
$("sh-diff-apply").onclick = async () => {
  if (!SHEET.file) return;
  $("sh-diff-apply").disabled = true;
  const res = await shFetch("/sheet/import?apply=1", { method: "POST", body: SHEET.file });
  $("sh-diff").hidden = true;
  SHEET.file = null;
  if (res.error) { $("sh-state").textContent = "실패: " + res.error; return; }
  if (sheetResult(res)) loadSheet();
};

$("sh-backup").onchange = () => { $("sh-restore").disabled = !$("sh-backup").value; };
$("sh-restore").onclick = async () => {
  const ts = $("sh-backup").value;
  if (!ts) return;
  if (!confirm(`백업 ${ts} 로 되돌립니다.\n대상 산의 현재 draft 가 백업 시점으로 교체됩니다.`)) return;
  const res = await shFetch("/sheet/restore?ts=" + encodeURIComponent(ts), { method: "POST" });
  if (res.error) { $("sh-state").textContent = "실패: " + res.error; return; }
  $("sh-state").textContent = `복원 완료: ${res.codes.join(", ")} — 재발행 필요`;
  loadSheet();
};
