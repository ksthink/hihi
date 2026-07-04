import maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/+esm";
import { Protocol } from "https://cdn.jsdelivr.net/npm/pmtiles@3.2.1/+esm";
import { buildStyle } from "./basemap-style.js";
import { supabase, signUp, signIn, signOut } from "./supabase-client.js";

// ── 설정 ──────────────────────────────────────────────
const PMTILES_URL = `${location.origin}/pmtiles/v4.pmtiles`; // 로컬 프록시 경유 (CORS 회피)

const PARKS = {
  bukhansan: { label: "북한산", center: [126.990, 37.672], zoom: 11.3, bbox: [126.90, 37.59, 127.06, 37.75], file: "data/bukhansan-routes.geojson" },
  seoraksan: { label: "설악산", center: [128.457, 38.135], zoom: 11.6, bbox: [128.43, 38.08, 128.48, 38.18], file: "data/seoraksan.geojson" }
};

const DIFF_LEVEL = { 초급: 1, 중급: 2, 고급: 3 };
// 데이터 값(초급/중급/고급) → 화면 표시 라벨
const DIFF_LABEL = { 초급: "보통", 중급: "어려움", 고급: "매우 어려움" };
const difLabel = (d) => DIFF_LABEL[d] || d;
const EMPTY_FC = { type: "FeatureCollection", features: [] };

// ── 테마 (흑백 화이트 / 다크) ────────────────────────
const THEME_KEY = "hiheight-theme";
let theme =
  localStorage.getItem(THEME_KEY) ||
  (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
document.documentElement.dataset.theme = theme;

function trailColors() {
  return theme === "dark"
    ? { line: "#ffffff", casing: "#000000" }
    : { line: "#111111", casing: "#ffffff" };
}

// ── PMTiles 프로토콜 등록 ────────────────────────────
const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

// ── 지도 초기화 ──────────────────────────────────────
const map = new maplibregl.Map({
  container: "map",
  style: buildStyle(PMTILES_URL, theme),
  center: PARKS.bukhansan.center,
  zoom: PARKS.bukhansan.zoom,
  hash: true,
  // 대한민국으로 이동/축소 범위 제한 (제주·독도가 잘리지 않도록 여백 포함, 한 단계 더 축소 허용)
  maxBounds: [[121.0, 31.0], [135.0, 40.5]], // [SW, NE] — 남한 전역 + 주변 여백
  minZoom: 5,
  localIdeographFontFamily: "'KakaoSmallSans', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif"
});
// 확대/축소 버튼 없이 나침반만 + 현재위치 — 지도 하단 우측에 배치
// (bottom 코너는 나중에 추가한 컨트롤이 위로 쌓임 → 나침반을 위, 현재위치를 아래로)
const geolocate = new maplibregl.GeolocateControl({ trackUserLocation: true });
map.addControl(geolocate, "bottom-right");
map.addControl(new maplibregl.NavigationControl({ showZoom: false, showCompass: true, visualizePitch: true }), "bottom-right");
map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }), "bottom-left");

// 화이트/다크 토글 — MapLibre 컨트롤 버튼(나침반과 동일 프레임), 나침반 위에 배치
class ThemeControl {
  onAdd() {
    const div = document.createElement("div");
    div.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "theme-toggle";
    btn.setAttribute("aria-label", "테마 전환");
    btn.innerHTML =
      '<svg class="icn moon" viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 14.3A8.2 8.2 0 0 1 9.7 3.5a8.2 8.2 0 1 0 10.8 10.8z"/></svg>' +
      '<svg class="icn sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/></svg>';
    btn.addEventListener("click", () => applyTheme(theme === "dark" ? "light" : "dark"));
    div.appendChild(btn);
    this._c = div;
    return div;
  }
  onRemove() { this._c.remove(); }
}
map.addControl(new ThemeControl(), "bottom-right");

// ── 상태 ─────────────────────────────────────────────
let currentPark = "bukhansan";
let peaksData = null;
let spotsData = null;
let contoursData = null;
let selectedTrail = null;
let selectedName = null;
let interactionsBound = false;
const trailCache = {};

// 지도에 표시할 경로 지점 종류
const SHOWN = ["분기점", "시종점"];

// ── 난이도 미터 (흑백) ───────────────────────────────
function difMeter(diff) {
  const lv = DIFF_LEVEL[diff] || 1;
  let s = '<span class="dmeter">';
  for (let i = 1; i <= 3; i++) s += `<i class="${i <= lv ? "on" : ""}"></i>`;
  return s + "</span>";
}

// ── 오버레이(등산로·봉우리) 레이어 ───────────────────
function ensureOverlays() {
  const c = trailColors();
  const widthExpr = [
    "interpolate", ["linear"], ["zoom"],
    11, ["match", ["get", "difficulty"], "초급", 1.6, "중급", 2.4, "고급", 3.4, 2.2],
    16, ["match", ["get", "difficulty"], "초급", 3.5, "중급", 5, "고급", 7, 4.5]
  ];

  if (!map.getSource("contours") && contoursData) {
    const cc = theme === "dark"
      ? { line: "#3a3a3a", label: "#8a8a8a", halo: "#000000" }
      : { line: "#c4bfb5", label: "#8a857c", halo: "#ffffff" };
    map.addSource("contours", { type: "geojson", data: contoursData });
    // 50m 보조 등고선 (확대 시)
    map.addLayer({
      id: "contour-line", type: "line", source: "contours", minzoom: 12.5,
      filter: ["==", ["get", "idx"], 0],
      paint: { "line-color": cc.line, "line-width": 0.5, "line-opacity": 0.5 }
    });
    // 100m 주 등고선
    map.addLayer({
      id: "contour-index", type: "line", source: "contours", minzoom: 10.5,
      filter: ["==", ["get", "idx"], 1],
      paint: { "line-color": cc.line, "line-width": 1.1, "line-opacity": 0.7 }
    });
    // 고도 라벨 (주 등고선)
    map.addLayer({
      id: "contour-label", type: "symbol", source: "contours", minzoom: 13.5,
      filter: ["==", ["get", "idx"], 1],
      layout: {
        "symbol-placement": "line", "text-field": ["concat", ["to-string", ["get", "elev"]], "m"],
        "text-font": ["Noto Sans Regular"], "text-size": 10, "symbol-spacing": 300
      },
      paint: { "text-color": cc.label, "text-halo-color": cc.halo, "text-halo-width": 1.4 }
    });
  }

  if (!map.getSource("trails")) {
    map.addSource("trails", { type: "geojson", data: trailCache[currentPark] || EMPTY_FC });

    map.addLayer({
      id: "trail-casing", type: "line", source: "trails",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": c.casing,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4, 16, 10]
      }
    });
    map.addLayer({
      id: "trail-line", type: "line", source: "trails",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.line, "line-width": widthExpr }
    });
  }

  if (!map.getSource("spots") && spotsData) {
    map.addSource("spots", { type: "geojson", data: spotsData });
    map.addLayer({
      id: "spots-dots", type: "circle", source: "spots", minzoom: 10.5,
      filter: ["in", ["get", "category"], ["literal", SHOWN]],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.2, 16, 1.8],
        "circle-color": c.line,
        "circle-stroke-color": c.casing,
        "circle-stroke-width": 0.6
      }
    });
  }

  if (!map.getSource("peaks") && peaksData) {
    map.addSource("peaks", { type: "geojson", data: peaksData });
    map.addLayer({
      id: "peak-symbols", type: "symbol", source: "peaks",
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 13, "text-offset": [0, -0.6], "text-anchor": "bottom"
      },
      paint: { "text-color": c.line, "text-halo-color": c.casing, "text-halo-width": 1.8 }
    });
  }

  // 상호작용은 한 번만 바인딩 (레이어 id 기준이라 테마 재부착 후에도 유효)
  if (!interactionsBound && map.getLayer("trail-line")) {
    map.on("click", "trail-line", (e) => selectByName(e.features[0].properties.name));
    map.on("mouseenter", "trail-line", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "trail-line", () => (map.getCanvas().style.cursor = ""));
    map.on("click", "spots-dots", (e) => {
      const p = e.features[0].properties;
      new maplibregl.Popup({ maxWidth: "240px" })
        .setLngLat(e.lngLat)
        .setHTML(`<div class="popup-title">${p.category || "스팟"}</div>
          <div class="popup-meta">${p.detail || ""}${p.etc ? "<br>" + p.etc : ""}</div>`)
        .addTo(map);
    });
    map.on("mouseenter", "spots-dots", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "spots-dots", () => (map.getCanvas().style.cursor = ""));
    interactionsBound = true;
  }

  applySpotsVisibility();
  applyContourVisibility();
  applyTrailFilter();
}

// 스팟은 북한산에서만, 그리고 토글이 켜졌을 때만 표시
function applySpotsVisibility() {
  const vis = currentPark === "bukhansan" ? "visible" : "none";
  if (map.getLayer("spots-dots")) map.setLayoutProperty("spots-dots", "visibility", vis);
}

// 등고선은 북한산(데이터 보유 지역)에서만 표시
function applyContourVisibility() {
  const vis = currentPark === "bukhansan" ? "visible" : "none";
  ["contour-line", "contour-index", "contour-label"].forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
  });
}

// 등산로 선택 시 해당 루트만 표시(필터), 미선택이면 전체 표시
function applyTrailFilter() {
  const f = selectedName ? ["==", ["get", "name"], selectedName] : null;
  ["trail-casing", "trail-line"].forEach((id) => {
    if (map.getLayer(id)) map.setFilter(id, f);
  });
  const btn = document.getElementById("show-all");
  if (btn) btn.hidden = !selectedName;
  const cc = document.getElementById("cur-course");
  const dv = document.getElementById("title-div");
  if (cc) cc.textContent = selectedName || "";
  if (dv) dv.hidden = !selectedName;
  document.querySelectorAll(".trail-item").forEach((x) =>
    x.classList.toggle("selected", x.dataset.name === selectedName)
  );
}

function selectByName(name) {
  const f = trailCache[currentPark] && trailCache[currentPark].features.find((x) => x.properties.name === name);
  if (f) focusTrail(f);
}

function clearSelection() {
  selectedName = null;
  applyTrailFilter();
  document.querySelectorAll(".maplibregl-popup").forEach((p) => p.remove());
}

// setStyle(테마 변경) 후 오버레이 재부착
map.on("styledata", () => {
  if (!map.getSource("trails") || (peaksData && !map.getSource("peaks")) || (spotsData && !map.getSource("spots")) || (contoursData && !map.getSource("contours"))) ensureOverlays();
});

// ── 산 데이터 로드 ───────────────────────────────────
async function loadPark(park) {
  currentPark = park;
  selectedName = null; // 산 전환 시 전체 표시로 초기화
  const cfg = PARKS[park];
  const cur = document.getElementById("cur-mtn");
  if (cur) cur.textContent = cfg.label;
  let geojson = trailCache[park];
  if (!geojson) { geojson = await fetch(cfg.file).then((r) => r.json()); trailCache[park] = geojson; }

  ensureOverlays();
  if (map.getSource("trails")) map.getSource("trails").setData(geojson);
  applySpotsVisibility();
  applyContourVisibility();
  applyTrailFilter();
  map.flyTo({ center: cfg.center, zoom: cfg.zoom, duration: 900 });
  renderTrailList(geojson);
  refreshSaveButton();
}

// ── 사이드바(시트) 등산로 목록 ───────────────────────
function renderTrailList(geojson) {
  const ul = document.getElementById("trail-list");
  ul.innerHTML = "";
  geojson.features.forEach((f) => {
    const p = f.properties;
    const li = document.createElement("li");
    li.className = "trail-item";
    li.dataset.name = p.name;
    li.innerHTML = `
      <div class="t-left">
        <div class="t-name">${p.name} <span class="badge">${difLabel(p.difficulty)} ${difMeter(p.difficulty)}</span></div>
        <div class="t-meta">${p.peak ? `<span>${p.peak}</span>` : ""}<span>${p.distance_km}km</span>${p.time_hr ? `<span>${p.time_hr}h</span>` : ""}${p.surface ? `<span>${p.surface}</span>` : ""}</div>
        <div class="t-desc">${p.desc || ""}</div>
      </div>
      ${p.profile ? `<div class="t-prof">${profileSVG(p.profile, 96, 44)}</div>` : ""}`;
    li.addEventListener("click", () => focusTrail(f));
    ul.appendChild(li);
  });
}

function focusTrail(feature) {
  selectedTrail = feature;
  selectedName = feature.properties.name;
  applyTrailFilter();
  updateClimb(feature);
  const g = feature.geometry;
  const flat = (g.type === "MultiLineString" ? g.coordinates : [g.coordinates]).flat();
  const b = flat.reduce(
    (a, c) => [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[0]), Math.max(a[3], c[1])],
    [Infinity, Infinity, -Infinity, -Infinity]
  );
  document.getElementById("sheet").classList.remove("expanded");
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], {
    padding: { top: 130, bottom: 320, left: 40, right: 40 }, maxZoom: 16, duration: 800
  });
}

// ── 명산 선택 (추천 탭의 "대한민국 100대 명산") ──────
const FAMOUS = [
  { park: "bukhansan", name: "북한산", elev: "836m", region: "서울·경기" },
  { park: "seoraksan", name: "설악산", elev: "1708m", region: "강원 속초·양양" }
];
function renderFamous() {
  const ul = document.getElementById("famous-list");
  ul.innerHTML = "";
  FAMOUS.forEach((m) => {
    const li = document.createElement("li");
    li.className = "famous-item";
    li.innerHTML = `<span class="fm-name">${m.name}</span><span class="fm-meta">${m.elev} · ${m.region}</span>`;
    li.addEventListener("click", () => selectMountain(m.park));
    ul.appendChild(li);
  });
}
document.getElementById("famous-btn").addEventListener("click", () => {
  const ul = document.getElementById("famous-list");
  ul.hidden = !ul.hidden;
  document.getElementById("famous-btn").classList.toggle("open", !ul.hidden);
});
function selectMountain(park) {
  showTab("tam");
  loadPark(park);
}

// ── 산 검색 (좌상단 돋보기) + 자동완성 ───────────────
(function setupSearch() {
  const btn = document.getElementById("search-btn");
  const panel = document.getElementById("search-panel");
  const input = document.getElementById("search-input");
  const results = document.getElementById("search-results");
  let composing = false;

  // 접두 우선, 없으면 포함 매치 (가장 유사한 산부터)
  function matches(q) {
    if (!q) return FAMOUS.slice();
    const pre = FAMOUS.filter((m) => m.name.startsWith(q));
    const inc = FAMOUS.filter((m) => !m.name.startsWith(q) && m.name.includes(q));
    return [...pre, ...inc];
  }
  function highlight(name, q) {
    const i = q ? name.indexOf(q) : -1;
    return i < 0 ? name : name.slice(0, i) + "<strong>" + name.slice(i, i + q.length) + "</strong>" + name.slice(i + q.length);
  }
  function render(q) {
    const query = (q || "").trim();
    const list = matches(query);
    if (!list.length) { results.innerHTML = '<li class="sr-empty">검색 결과 없음</li>'; return; }
    results.innerHTML = list
      .map((m, i) => `<li data-park="${m.park}" class="${i === 0 ? "active" : ""}">${highlight(m.name, query)}<span class="sr-meta">${m.elev} · ${m.region}</span></li>`)
      .join("");
    results.querySelectorAll("li[data-park]").forEach((li) =>
      li.addEventListener("click", () => { selectMountain(li.dataset.park); close(); })
    );
  }
  // 입력창에 가장 유사한 산 이름을 인라인 자동완성(나머지 글자 선택 표시)
  function autocomplete() {
    const typed = input.value;
    if (!typed) return;
    const m = FAMOUS.find((x) => x.name.startsWith(typed) && x.name !== typed);
    if (m) { input.value = m.name; input.setSelectionRange(typed.length, m.name.length); }
  }
  function pick() {
    const q = input.value.trim();
    const m = FAMOUS.find((x) => x.name === q) || matches(q)[0];
    if (m) { selectMountain(m.park); close(); }
  }
  function open() { panel.hidden = false; render(""); input.focus(); }
  function close() { panel.hidden = true; input.value = ""; }

  btn.addEventListener("click", (e) => { e.stopPropagation(); panel.hidden ? open() : close(); });
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; render(input.value); autocomplete(); });
  input.addEventListener("input", (e) => {
    if (composing) return;                 // 한글 조합 중에는 조합 종료 후 처리
    render(input.value);
    const del = e.inputType && e.inputType.startsWith("delete");
    if (!del) autocomplete();
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); pick(); } });
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !document.getElementById("search").contains(e.target)) close();
  });
})();

// ── 하단 탭바 (탐험/추천/등반/기록) ──────────────────
const appEl = document.getElementById("app");
function showTab(name) {
  document.querySelectorAll(".tabbtn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  appEl.classList.toggle("not-explore", name !== "tam");
  if (name === "tam") setTimeout(() => map.resize(), 60);
}
document.querySelectorAll(".tabbtn").forEach((b) =>
  b.addEventListener("click", () => showTab(b.dataset.tab))
);

// ── 추천 뷰 ──────────────────────────────────────────
const RECO = [
  { name: "오색 - 대청봉 코스", park: "seoraksan", parkLabel: "설악산", diff: "고급", why: "설악 정상 대청봉을 최단 시간에 오르는 도전 코스" },
  { name: "진달래길", park: "bukhansan", parkLabel: "북한산", diff: "초급", why: "진달래능선을 따라 대동문으로, 봄이면 진달래 명소인 대표 등산로 (OSM)" },
  { name: "천불동계곡 코스", park: "seoraksan", parkLabel: "설악산", diff: "중급", why: "비선대·양폭을 지나는 설악의 대표 계곡길" }
];
function renderReco() {
  const box = document.getElementById("reco-list");
  box.innerHTML = "";
  RECO.forEach((r) => {
    const el = document.createElement("div");
    el.className = "reco-card";
    el.innerHTML = `
      <span class="rc-badge">${difLabel(r.diff)} ${difMeter(r.diff)}</span>
      <div class="rc-park">${r.parkLabel}</div>
      <div class="rc-name">${r.name}</div>
      <div class="rc-why">${r.why}</div>`;
    el.addEventListener("click", () => openTrailByName(r.park, r.name));
    box.appendChild(el);
  });
}
async function openTrailByName(park, name) {
  showTab("tam");
  await loadPark(park);
  const f = trailCache[park].features.find((x) => x.properties.name === name);
  if (f) focusTrail(f);
}

// ── 등반 뷰 ──────────────────────────────────────────
function updateClimb(feature) {
  const p = feature.properties;
  document.getElementById("climb-course").textContent = p.name;
  document.getElementById("climb-dist").textContent = p.distance_km;
  document.getElementById("climb-time").textContent = p.time_hr || "–";
  document.getElementById("climb-diff").innerHTML = difMeter(p.difficulty);
  const hasElev = p.max_elev != null;
  document.getElementById("climb-emax").textContent = hasElev ? p.max_elev : "–";
  document.getElementById("climb-gain").textContent = hasElev ? "+" + p.ascent : "–";
  document.getElementById("climb-emin").textContent = hasElev ? p.min_elev : "–";
  renderProfile(p.profile);
  const bits = [p.peak, p.start ? `들머리 ${p.start}` : null, p.surface ? `노면 ${p.surface}` : null].filter(Boolean);
  document.getElementById("climb-hint").textContent = bits.join(" · ") || p.desc || "";
  document.getElementById("start-btn").disabled = false;
}

// 고도 프로파일 스파크라인 SVG 문자열 생성 (흑백)
function profileSVG(prof, W, H) {
  if (!prof || prof.length < 2) return "";
  const pad = 3;
  const min = Math.min(...prof), max = Math.max(...prof), rng = max - min || 1;
  const pts = prof.map((v, i) => [
    pad + (W - 2 * pad) * i / (prof.length - 1),
    pad + (H - 2 * pad) * (1 - (v - min) / rng)
  ]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = `${line} L ${W - pad} ${H - pad} L ${pad} ${H - pad} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="prof-svg">` +
    `<path d="${area}" class="prof-area"/><path d="${line}" class="prof-line"/></svg>`;
}
function renderProfile(prof) {
  document.getElementById("climb-profile").innerHTML = profileSVG(prof, 300, 72);
}
// ── 등반 세션: 지도 기반 실시간 트래킹 ────────────────
// 시작 → 지도 화면(선택 코스만 표시) + 현재위치 추적 + HUD(경과·이동거리·GPS 트랙).
// 종료 → 실측(시간·이동거리·트랙)을 climb_records 로 저장.
// 웹 한계(iOS 에서 해소): 화면이 꺼지면 GPS 중단(백그라운드 추적은 CoreLocation 단계),
// 기저 타일은 온라인 소스(진짜 오프라인 지도는 iOS 로컬 팩 단계).
let climbSession = null; // { startedAt, feature, park, watchId, timer, track:[[lng,lat,t]], dist }

const R_EARTH = 6371000;
function haversine(a, b) { // [lng,lat] 두 점 거리(m)
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]), dLng = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(s));
}

function fmtClock(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function setStartBtn(on) {
  const btn = document.getElementById("start-btn");
  btn.dataset.on = on ? "1" : "0";
  btn.textContent = on ? "등반 중 · 종료" : "등반 시작";
  btn.classList.toggle("recording", on);
}

function startClimb() {
  const p = selectedTrail.properties;
  climbSession = {
    startedAt: new Date(), feature: selectedTrail, park: currentPark,
    watchId: null, timer: null, track: [], dist: 0
  };
  setStartBtn(true);

  // 지도 화면으로 전환: 선택 코스만 표시(이미 필터됨) + 코스 범위로 이동
  showTab("tam");
  appEl.classList.add("climbing");
  const hud = document.getElementById("climb-hud");
  hud.hidden = false;
  document.getElementById("ch-course").textContent = p.name;
  document.getElementById("ch-course-dist").textContent = p.distance_km ?? "–";
  document.getElementById("ch-dist").textContent = "0.00";
  document.getElementById("ch-pts").textContent = "0";
  document.getElementById("ch-note").textContent = "";

  // 경과 시간 타이머
  climbSession.timer = setInterval(() => {
    if (!climbSession) return;
    const sec = Math.floor((Date.now() - climbSession.startedAt.getTime()) / 1000);
    document.getElementById("ch-time").textContent = fmtClock(sec);
  }, 1000);

  // 현재위치 점(파랑 점) 표시 + 지도 추적
  try { geolocate.trigger(); } catch (_) {}

  // GPS 트랙 기록 (5m 이상 이동 시 지점 추가)
  if (navigator.geolocation) {
    climbSession.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!climbSession) return;
        const pt = [pos.coords.longitude, pos.coords.latitude];
        const last = climbSession.track[climbSession.track.length - 1];
        if (last) {
          const d = haversine(last, pt);
          if (d < 5) return;                    // 잡음 제거
          climbSession.dist += d;
        }
        climbSession.track.push([+pt[0].toFixed(6), +pt[1].toFixed(6), Math.floor(Date.now() / 1000)]);
        document.getElementById("ch-dist").textContent = (climbSession.dist / 1000).toFixed(2);
        document.getElementById("ch-pts").textContent = climbSession.track.length;
      },
      (err) => {
        document.getElementById("ch-note").textContent =
          "위치 접근 불가(" + err.message + ") — 시간 기준으로 기록됩니다.";
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );
  } else {
    document.getElementById("ch-note").textContent = "이 브라우저는 위치를 지원하지 않습니다.";
  }
}

async function stopClimb() {
  if (!climbSession) return;
  if (climbSession.watchId != null) navigator.geolocation.clearWatch(climbSession.watchId);
  if (climbSession.timer) clearInterval(climbSession.timer);
  appEl.classList.remove("climbing");
  document.getElementById("climb-hud").hidden = true;
  setStartBtn(false);
  await saveClimb();
}

document.getElementById("start-btn").disabled = true;
document.getElementById("start-btn").addEventListener("click", () => {
  if (!selectedTrail) return;
  if (climbSession) { stopClimb(); return; }
  if (!currentUser) {
    const hint = document.getElementById("climb-hint");
    if (hint) hint.textContent = "등반 기록을 저장하려면 기록 탭에서 로그인하세요.";
    showTab("girok");
    return;
  }
  startClimb();
});
document.getElementById("ch-stop").addEventListener("click", () => stopClimb());

async function saveClimb() {
  if (!climbSession || !currentUser) { climbSession = null; return; }
  const s = climbSession;
  climbSession = null;
  const p = s.feature.properties;
  const ended = new Date();
  const measuredKm = s.dist / 1000;
  // 트랙이 너무 크면 균등 솎아내기 (기록당 최대 2000지점)
  let track = s.track;
  if (track.length > 2000) {
    const step = track.length / 2000;
    track = Array.from({ length: 2000 }, (_, i) => s.track[Math.floor(i * step)]);
  }
  const rec = {
    user_id: currentUser.id,
    mountain_id: s.park,
    course_name: p.name,
    started_at: s.startedAt.toISOString(),
    ended_at: ended.toISOString(),
    // 실측 이동거리가 유의미하면(50m+) 실측, 아니면 코스 거리로 기록
    distance_km: measuredKm >= 0.05 ? +measuredKm.toFixed(2) : (p.distance_km ?? null),
    ascent_m: p.ascent ?? null,
    duration_s: Math.max(1, Math.round((ended - s.startedAt) / 1000)),
    track: track.length >= 2 ? { points: track } : null
  };
  const { error } = await supabase.from("climb_records").insert(rec);
  const hint = document.getElementById("climb-hint");
  if (error) {
    console.error("기록 저장 실패:", error);
    if (hint) hint.textContent = "기록 저장 실패: " + error.message;
    return;
  }
  if (hint) hint.textContent =
    `등반 기록 저장 완료 — ${rec.distance_km}km · ${fmtClock(rec.duration_s)}` +
    (rec.track ? ` · GPS ${rec.track.points.length}지점` : "") + ". 기록 탭에서 확인하세요.";
  renderRecords();
}

// ── 기록 뷰 (Supabase climb_records) ─────────────────
let currentUser = null;

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${z(d.getMonth() + 1)}.${z(d.getDate())}`;
}
function fmtDur(s) {
  if (!s && s !== 0) return "–";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}
function setSummary(count, dist, gain) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("sum-count", count);
  set("sum-dist", dist);
  set("sum-gain", (gain || 0).toLocaleString());
}

async function renderRecords() {
  const ul = document.getElementById("rec-list");
  const empty = document.getElementById("rec-empty");
  if (!ul) return;
  ul.innerHTML = "";

  if (!currentUser) {
    empty.hidden = false;
    empty.textContent = "로그인하고 등반 기록을 저장하세요.";
    setSummary(0, 0, 0);
    return;
  }

  const { data, error } = await supabase
    .from("climb_records")
    .select("*")
    .order("started_at", { ascending: false });

  if (error) {
    console.error("기록 로드 실패:", error);
    empty.hidden = false;
    empty.textContent = "기록을 불러오지 못했습니다. (테이블/스키마 확인)";
    setSummary(0, 0, 0);
    return;
  }

  const recs = data || [];
  empty.hidden = recs.length > 0;
  if (!recs.length) empty.textContent = "아직 등반 기록이 없습니다. 코스를 선택해 등반을 시작해 보세요.";

  let totDist = 0, totGain = 0;
  recs.forEach((r) => {
    totDist += r.distance_km || 0;
    totGain += r.ascent_m || 0;
    const li = document.createElement("li");
    li.className = "rec-item";
    li.innerHTML = `
      <div class="ri-top"><span class="ri-name">${r.course_name || r.mountain_id || "산행"}</span><span class="ri-date">${fmtDate(r.started_at)}</span></div>
      <div class="ri-meta"><span>${(r.distance_km ?? 0)} km</span><span>${fmtDur(r.duration_s)}</span></div>`;
    ul.appendChild(li);
  });
  setSummary(recs.length, totDist.toFixed(1), totGain);
}

// ── 계정 (Supabase Auth) ─────────────────────────────
function updateAuthUI() {
  const out = document.getElementById("auth-out");
  const inb = document.getElementById("auth-in");
  const who = document.getElementById("auth-user");
  if (!out || !inb) return;
  if (currentUser) {
    out.hidden = true; inb.hidden = false;
    if (who) who.textContent = currentUser.email || "로그인됨";
  } else {
    out.hidden = false; inb.hidden = true;
  }
}
function setupAuth() {
  const email = document.getElementById("auth-email");
  const pass = document.getElementById("auth-pass");
  const msg = document.getElementById("auth-msg");
  const creds = () => ({ e: (email.value || "").trim(), p: pass.value || "" });

  document.getElementById("auth-signin").addEventListener("click", async () => {
    msg.textContent = "";
    const { e, p } = creds();
    if (!e || !p) { msg.textContent = "이메일과 비밀번호를 입력하세요."; return; }
    const { error } = await signIn(e, p);
    if (error) { msg.textContent = error.message; return; }
    pass.value = "";
  });
  document.getElementById("auth-signup").addEventListener("click", async () => {
    msg.textContent = "";
    const { e, p } = creds();
    if (!e || !p) { msg.textContent = "이메일과 비밀번호를 입력하세요."; return; }
    const { data, error } = await signUp(e, p);
    if (error) { msg.textContent = error.message; return; }
    if (data.user && !data.session) msg.textContent = "확인 메일을 보냈습니다. 메일 인증 후 로그인하세요.";
    else pass.value = "";
  });
  document.getElementById("auth-signout").addEventListener("click", () => signOut());

  // 세션 변화 → UI/기록/저장버튼 갱신 (등록 직후 INITIAL_SESSION 도 여기로 들어옴)
  supabase.auth.onAuthStateChange((_ev, session) => {
    currentUser = session?.user || null;
    updateAuthUI();
    renderRecords();
    refreshSaveButton();
  });
}

// ── 다운로드 ─────────────────────────────────────────
function download(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
document.getElementById("dl-geojson").addEventListener("click", () => {
  const g = trailCache[currentPark];
  if (g) download(`${currentPark}-trails.geojson`, JSON.stringify(g, null, 2));
});

// 오프라인 저장: Supabase Storage 에서 팩을 취득(배포 검증) + saved_packs 에 기록.
// (브라우저 진짜 오프라인 캐싱은 iOS 파일시스템 단계에서 구현 — 여기선 배포+저장표시)
document.getElementById("dl-save").addEventListener("click", async () => {
  const note = document.getElementById("dl-note");
  if (!currentUser) {
    note.textContent = "오프라인 저장은 로그인 후 이용할 수 있습니다.";
    showTab("girok");
    return;
  }
  const park = currentPark;
  const btn = document.getElementById("dl-save");
  btn.disabled = true;
  note.textContent = "저장 중…";
  try {
    // 팩 파일 취득(존재/접근 확인)
    const files = ["routes.geojson", "spots.geojson", "contours.geojson"];
    let got = 0;
    for (const f of files) {
      const { data, error } = await supabase.storage.from("packs").download(`${park}/${f}`);
      if (!error && data) got++;
    }
    // 저장 표시
    const { error } = await supabase.from("saved_packs").upsert({
      user_id: currentUser.id, mountain_id: park, pack_version: 1
    });
    if (error) throw error;
    btn.textContent = "저장됨 ✓";
    btn.classList.add("saved");
    note.textContent = `${PARKS[park].label} 오프라인 저장 완료 (팩 ${got}/${files.length}개 확인)`;
  } catch (e) {
    console.error("오프라인 저장 실패:", e);
    note.textContent = "저장 실패: " + (e.message || e);
    btn.disabled = false;
  }
});

// 현재 산의 저장 여부에 맞춰 저장 버튼 상태 갱신
async function refreshSaveButton() {
  const btn = document.getElementById("dl-save");
  if (!btn) return;
  const reset = () => {
    btn.textContent = "이 산 오프라인 저장";
    btn.classList.remove("saved");
    btn.disabled = false;
  };
  if (!currentUser) { reset(); return; }
  const { data } = await supabase
    .from("saved_packs").select("mountain_id")
    .eq("mountain_id", currentPark).maybeSingle();
  if (data) {
    btn.textContent = "저장됨 ✓";
    btn.classList.add("saved");
    btn.disabled = true;
  } else {
    reset();
  }
}

// ── 테마 토글 ────────────────────────────────────────
function applyTheme(t) {
  theme = t;
  localStorage.setItem(THEME_KEY, t);
  document.documentElement.dataset.theme = t;
  map.setStyle(buildStyle(PMTILES_URL, t)); // styledata 핸들러가 오버레이 재부착
}

// ── 바텀시트 드래그/탭 ───────────────────────────────
(function setupSheet() {
  const sheet = document.getElementById("sheet");
  const grabber = document.getElementById("grabber");
  const COLLAPSED = 232;
  let dragging = false, startY = 0, startH = 0, moved = false;
  const screenH = () => sheet.parentElement.clientHeight;
  const expandedH = () => Math.round(screenH() * 0.74);

  function onDown(e) {
    dragging = true; moved = false;
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    startH = sheet.getBoundingClientRect().height;
    sheet.style.transition = "none"; grabber.style.cursor = "grabbing";
  }
  function onMove(e) {
    if (!dragging) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const dy = startY - y;
    if (Math.abs(dy) > 4) moved = true;
    sheet.style.height = Math.min(expandedH(), Math.max(COLLAPSED - 60, startH + dy)) + "px";
  }
  function onUp() {
    if (!dragging) return;
    dragging = false; grabber.style.cursor = "grab"; sheet.style.transition = "";
    const h = sheet.getBoundingClientRect().height;
    if (!moved) toggle();
    else snap(h > (COLLAPSED + expandedH()) / 2);
  }
  function snap(expand) { sheet.classList.toggle("expanded", expand); sheet.style.height = ""; }
  function toggle() { snap(!sheet.classList.contains("expanded")); }

  grabber.addEventListener("mousedown", onDown);
  grabber.addEventListener("touchstart", onDown, { passive: true });
  window.addEventListener("mousemove", onMove);
  window.addEventListener("touchmove", onMove, { passive: true });
  window.addEventListener("mouseup", onUp);
  window.addEventListener("touchend", onUp);
})();

// ── 전체 등산로 보기 (선택 해제) ─────────────────────
document.getElementById("show-all").addEventListener("click", (e) => {
  e.stopPropagation();
  clearSelection();
});

// ── 시작 ─────────────────────────────────────────────
setupAuth(); // 세션 복원 + 로그인/가입/로그아웃 바인딩 (기록/저장 UI 구동)

map.on("load", async () => {
  [peaksData, spotsData, contoursData] = await Promise.all([
    fetch("data/peaks.geojson").then((r) => r.json()),
    fetch("data/bukhansan-spots.geojson").then((r) => r.json()),
    fetch("data/bukhansan-contours.geojson").then((r) => r.json())
  ]);
  ensureOverlays();
  await loadPark("bukhansan");
  renderFamous();
  renderReco();
  renderRecords();
  document.getElementById("loading").classList.add("hidden");
});
map.on("error", (e) => console.error("Map error:", e && e.error));
