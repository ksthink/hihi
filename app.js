import maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/+esm";
import { Protocol } from "https://cdn.jsdelivr.net/npm/pmtiles@3.2.1/+esm";
import { buildStyle } from "./basemap-style.js";

// ── 설정 ──────────────────────────────────────────────
const PMTILES_URL = `${location.origin}/pmtiles/v4.pmtiles`; // 로컬 프록시 경유 (CORS 회피)
const UPSTREAM_PMTILES_URL = "https://demo-bucket.protomaps.com/v4.pmtiles"; // 오프라인 추출 CLI용

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
  localIdeographFontFamily: "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif"
});
// 확대/축소 버튼 없이 나침반만 + 현재위치 — 지도 하단 우측에 배치
// (bottom 코너는 나중에 추가한 컨트롤이 위로 쌓임 → 나침반을 위, 현재위치를 아래로)
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), "bottom-right");
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
document.getElementById("start-btn").disabled = true;
document.getElementById("start-btn").addEventListener("click", () => {
  if (!selectedTrail) return;
  const btn = document.getElementById("start-btn");
  const tracking = btn.dataset.on === "1";
  btn.dataset.on = tracking ? "0" : "1";
  btn.textContent = tracking ? "등반 시작" : "등반 중 · 종료";
  btn.classList.toggle("recording", !tracking);
});

// ── 기록 뷰 ──────────────────────────────────────────
const RECORDS = [
  { name: "북한산 백운대", date: "2026.06.21", dist: 8.4, time: "4:10" },
  { name: "설악산 대청봉", date: "2026.05.30", dist: 11.2, time: "7:25" },
  { name: "북한산 비봉", date: "2026.05.02", dist: 6.1, time: "3:05" },
  { name: "설악산 울산바위", date: "2026.04.18", dist: 7.6, time: "3:40" }
];
function renderRecords() {
  const ul = document.getElementById("rec-list");
  ul.innerHTML = "";
  RECORDS.forEach((r) => {
    const li = document.createElement("li");
    li.className = "rec-item";
    li.innerHTML = `
      <div class="ri-top"><span class="ri-name">${r.name}</span><span class="ri-date">${r.date}</span></div>
      <div class="ri-meta"><span>${r.dist} km</span><span>${r.time}</span></div>`;
    ul.appendChild(li);
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
document.getElementById("dl-offline").addEventListener("click", () => {
  const cfg = PARKS[currentPark];
  const [minLon, minLat, maxLon, maxLat] = cfg.bbox;
  const out = `${currentPark}-offline.pmtiles`;
  const script = `#!/usr/bin/env bash
# ${cfg.label} 영역 오프라인 지도 추출 (하이하잇)
# 필요: pmtiles CLI  ->  https://github.com/protomaps/go-pmtiles/releases

pmtiles extract "${UPSTREAM_PMTILES_URL}" "${out}" \\
  --bbox=${minLon},${minLat},${maxLon},${maxLat} \\
  --minzoom=8 --maxzoom=15

echo "완료: ${out}"
`;
  download(`extract-${currentPark}.sh`, script, "text/x-shellscript");
  document.getElementById("dl-note").textContent =
    `bbox ${minLon},${minLat},${maxLon},${maxLat} · pmtiles CLI로 실행하면 ${out} 생성`;
});

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
