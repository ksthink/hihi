import maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/+esm";
import { Protocol, PMTiles, FileSource } from "https://cdn.jsdelivr.net/npm/pmtiles@3.2.1/+esm";
import { buildStyle } from "./basemap-style.js";
import { supabase, signUp, signIn, signOut } from "./supabase-client.js";
import { fetchWeather, renderStrip } from "./weather.js";
import { nationalPointNumber } from "./npn.js";

// ── 설정 ──────────────────────────────────────────────
const PMTILES_URL = `${location.origin}/pmtiles/v4.pmtiles`; // 로컬 프록시 경유 (CORS 회피)
// 현재 기저 소스: 온라인(PMTILES_URL) 또는 로컬 팩("local-<산id>", IndexedDB Blob 등록 후)
let baseUrl = PMTILES_URL;

// 산 식별자 = 산림청 산코드 9자리 (scripts/MNT_CODE.xlsx → data/mnt-codes.json, 전국 2,931산).
// 산 이름은 전국 중복(317건)이 있어 코드가 전 시스템 표준 키다:
// Storage packs/<산코드>/ · mountains.id · saved_packs/climb_records.mountain_id · IndexedDB 팩 키
// 대표 코드 = 주봉(정상) 코드, 산정보가 충실한 쪽 (북한산→백운대, 설악산→대청봉, 청계산→과천)
//
// 카탈로그 주도: 산 목록은 Supabase mountains 테이블(published, sort_order 순)에서 로드.
// 관리자 콘솔(/admin, 로컬)에서 배포하면 앱 새로고침만으로 반영된다 — 코드 배포 불필요.
// iOS 도 동일 테이블을 소비. 오프라인 부팅은 localStorage 캐시 폴백.
let PARKS = {}; // 산코드 → { label, center, zoom, bbox, elev, region, famous }
const CATALOG_KEY = "hiheight-catalog";

async function loadCatalog() {
  try {
    let q = await supabase.from("mountains").select("*")
      .eq("published", true).order("sort_order").order("name");
    if (q.error) q = await supabase.from("mountains").select("*").order("name"); // 마이그레이션 전 호환
    if (q.error || !q.data || !q.data.length) throw q.error || new Error("empty");
    PARKS = {};
    for (const m of q.data) {
      PARKS[m.id] = {
        label: m.name, center: m.center, zoom: m.zoom, bbox: m.bbox,
        elev: m.elev, region: m.region, famous: m.famous !== false
      };
    }
    localStorage.setItem(CATALOG_KEY, JSON.stringify(PARKS));
  } catch (_) {
    // 오프라인 등 조회 실패 → 마지막 카탈로그 캐시로 (저장 팩 열람 유지)
    try { PARKS = JSON.parse(localStorage.getItem(CATALOG_KEY)) || {}; } catch (_e) { PARKS = {}; }
  }
  return Object.keys(PARKS);
}

// Storage 팩 파일 공개 URL — 카탈로그의 데이터 소스 (routes/spots/contours/base.pmtiles)
const packUrl = (park, file) =>
  supabase.storage.from("packs").getPublicUrl(`${park}/${file}`).data.publicUrl;

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
    ? { line: "#ffffff", casing: "#000000", faded: "#5c5c5c" }
    : { line: "#111111", casing: "#ffffff", faded: "#b8b8b8" };
}

// ── PMTiles 프로토콜 등록 ────────────────────────────
const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

// ── 지도 초기화 ──────────────────────────────────────
const map = new maplibregl.Map({
  container: "map",
  style: buildStyle(baseUrl, theme),
  center: [126.990, 37.672], // 카탈로그 로드 전 기본 뷰 (첫 산 로드 시 flyTo)
  zoom: 11.3,
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

// ── 지도 POI 아이콘 (흑백 뱃지, 런타임 캔버스 생성) ────
// 외부 스프라이트/CDN 없이 styleimagemissing 때 즉석 생성 — 오프라인·테마 전환 자동 대응.
// iOS 이식 시 동일 아이콘 id 로 UIImage 를 스타일에 등록하면 됨.
const POI_TEXT = { toilets: "WC", parking: "P", information: "i", place_of_worship: "卍" };

function makePoiIcon(id) {
  const kind = id.replace(/^poi-/, "");
  const dark = theme === "dark";
  const fg = dark ? "#f2f2f2" : "#111111";
  const bg = dark ? "#000000" : "#ffffff";
  const S = 20, P = 2;                       // 뱃지 크기(css px), 여백
  const cv = document.createElement("canvas");
  cv.width = cv.height = S * 2;              // 2x 해상도
  const ctx = cv.getContext("2d");
  ctx.scale(2, 2);

  // 뱃지: 역은 원형, 나머지는 라운드 사각
  ctx.fillStyle = bg;
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  if (kind === "station") ctx.arc(S / 2, S / 2, S / 2 - P, 0, Math.PI * 2);
  else ctx.roundRect(P, P, S - 2 * P, S - 2 * P, 4);
  ctx.fill(); ctx.stroke();

  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  if (kind in POI_TEXT) {
    // 글자 아이콘 (WC · P · i · 卍)
    const t = POI_TEXT[kind];
    ctx.font = `bold ${t.length > 1 ? 8 : 11}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(t, S / 2, S / 2 + 0.5);
  } else if (kind === "bus_stop") {
    // 버스: 차체 + 창 + 바퀴
    ctx.beginPath(); ctx.roundRect(5.5, 5, 9, 8, 1.5); ctx.fill();
    ctx.fillStyle = bg;
    ctx.fillRect(6.5, 6.5, 7, 2.5);
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(7.5, 14, 1.2, 0, Math.PI * 2); ctx.arc(12.5, 14, 1.2, 0, Math.PI * 2); ctx.fill();
  } else if (kind === "station") {
    // 전철: 차체 + 창 + 하단 레일
    ctx.beginPath(); ctx.roundRect(6, 4.5, 8, 8.5, 2); ctx.fill();
    ctx.fillStyle = bg;
    ctx.fillRect(7, 6, 6, 3);
    ctx.fillStyle = fg;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(6.5, 15.5); ctx.lineTo(9, 13); ctx.moveTo(13.5, 15.5); ctx.lineTo(11, 13); ctx.stroke();
  } else if (kind === "drinking_water") {
    // 물방울
    ctx.beginPath();
    ctx.moveTo(S / 2, 4.5);
    ctx.bezierCurveTo(13.5, 8.5, 14, 10.5, 14, 12);
    ctx.arc(S / 2, 12, 4, 0, Math.PI, false);
    ctx.bezierCurveTo(6, 10.5, 6.5, 8.5, S / 2, 4.5);
    ctx.fill();
  } else {
    return; // 모르는 아이콘은 생성하지 않음
  }
  if (!map.hasImage(id)) map.addImage(id, ctx.getImageData(0, 0, S * 2, S * 2), { pixelRatio: 2 });
}
map.on("styleimagemissing", (e) => {
  if (e.id.startsWith("poi-")) makePoiIcon(e.id);
});

// ── 상태 ─────────────────────────────────────────────
let currentPark = null; // 카탈로그 로드 후 첫 산으로 설정
let peaksData = null;
let selectedTrail = null;
let selectedName = null;
let interactionsBound = false;
const trailCache = {};
// 산별 오버레이 데이터: { <park>: { spots, contours } } — 시작 시 북한산은 fetch, 저장 팩은 IndexedDB
const parkOverlays = {};
// pmtiles Protocol 에 로컬 Blob 소스가 등록된 산: { <park>: true }
const localRegistered = {};

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

  const ov = parkOverlays[currentPark] || {};

  if (!map.getSource("contours")) {
    const cc = theme === "dark"
      ? { line: "#3a3a3a", label: "#8a8a8a", halo: "#000000" }
      : { line: "#c4bfb5", label: "#8a857c", halo: "#ffffff" };
    map.addSource("contours", { type: "geojson", data: ov.contours || EMPTY_FC });
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
    // 선택된 코스 강조 레이어 (검정, 나머지 회색 위에 얹음)
    map.addLayer({
      id: "trail-hl", type: "line", source: "trails",
      layout: { "line-cap": "round", "line-join": "round" },
      filter: ["==", ["get", "name"], "__none__"],
      paint: { "line-color": c.line, "line-width": widthExpr }
    });
  }

  if (!map.getSource("spots")) {
    map.addSource("spots", { type: "geojson", data: ov.spots || EMPTY_FC });
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
    // 운영자가 이름 붙인 분기점/시종점만 지도 라벨 (관리자 콘솔 큐레이션)
    map.addLayer({
      id: "spots-labels", type: "symbol", source: "spots", minzoom: 12.5,
      filter: ["all", ["in", ["get", "category"], ["literal", SHOWN]], ["has", "name"]],
      layout: {
        "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"],
        "text-size": 10.5, "text-offset": [0, 0.7], "text-anchor": "top", "text-max-width": 8
      },
      paint: { "text-color": c.line, "text-halo-color": c.casing, "text-halo-width": 1.4 }
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
    ["trail-line", "trail-hl"].forEach((id) => {
      map.on("click", id, (e) => selectByName(e.features[0].properties.name));
      map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
    });
    map.on("click", "spots-dots", (e) => {
      const p = e.features[0].properties;
      new maplibregl.Popup({ maxWidth: "240px" })
        .setLngLat(e.lngLat)
        .setHTML(`<div class="popup-title">${p.name || p.category || "스팟"}</div>
          <div class="popup-meta">${p.name ? p.category + "<br>" : ""}${p.detail || ""}${p.etc ? "<br>" + p.etc : ""}</div>`)
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

// 스팟/등고선은 현재 산의 데이터가 있을 때만 표시 (산별 일반화)
function applySpotsVisibility() {
  const vis = (parkOverlays[currentPark] || {}).spots ? "visible" : "none";
  ["spots-dots", "spots-labels"].forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
  });
}

function applyContourVisibility() {
  const vis = (parkOverlays[currentPark] || {}).contours ? "visible" : "none";
  ["contour-line", "contour-index", "contour-label"].forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
  });
}

// 등산로 선택 시: 선택 코스는 검정(trail-hl), 나머지는 회색(trail-line faded).
// 미선택이면 전체를 검정으로 표시.
function applyTrailFilter() {
  const c = trailColors();
  if (map.getLayer("trail-line"))
    map.setPaintProperty("trail-line", "line-color", selectedName ? c.faded : c.line);
  if (map.getLayer("trail-hl"))
    map.setFilter("trail-hl", ["==", ["get", "name"], selectedName || "__none__"]);
  const btn = document.getElementById("show-all");
  if (btn) btn.hidden = !selectedName;
  const cc = document.getElementById("cur-course");
  const dv = document.getElementById("title-div");
  if (cc) cc.textContent = selectedName || "";
  if (dv) dv.hidden = !selectedName;
  document.querySelectorAll(".trail-item").forEach((x) => {
    const on = x.dataset.name === selectedName;
    x.classList.toggle("selected", on);
    if (on) x.scrollIntoView({ block: "nearest", behavior: "smooth" }); // 목록도 해당 코스로 이동
  });
}

function selectByName(name) {
  const f = trailCache[currentPark] && trailCache[currentPark].features.find((x) => x.properties.name === name);
  if (f) focusTrail(f);
}

function clearSelection() {
  selectedName = null;
  applyTrailFilter();
  document.querySelectorAll(".maplibregl-popup").forEach((p) => p.remove());
  fitPark(); // 전체 코스가 화면에 꽉 차도록 다시 맞춤
}

// GeoJSON 전체 좌표의 경계 [minLng, minLat, maxLng, maxLat]
function geojsonBounds(gj) {
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of (gj.features || [])) {
    const g = f.geometry;
    const flat = (g.type === "MultiLineString" ? g.coordinates : [g.coordinates]).flat();
    for (const c of flat) b = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])];
  }
  return b;
}

// 하단 시트/상단 검색을 피해 화면에 최적화된 패딩 (작은 화면에서 과도한 패딩 방지)
function fitPadding() {
  const h = map.getContainer().clientHeight;
  return { top: 110, bottom: Math.min(300, Math.round(h * 0.32)), left: 36, right: 36 };
}

// 현재 산의 전체 코스 범위에 맞춰 지도 축소/확대
function fitPark(duration = 800) {
  const gj = trailCache[currentPark];
  if (!gj || !gj.features || !gj.features.length) return;
  const b = geojsonBounds(gj);
  if (!isFinite(b[0])) return;
  document.getElementById("sheet")?.classList.remove("expanded");
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: fitPadding(), maxZoom: 15.5, duration });
}

// setStyle(테마/기저 변경) 후 오버레이 재부착
map.on("styledata", () => {
  if (!map.getSource("trails") || (peaksData && !map.getSource("peaks")) || !map.getSource("spots") || !map.getSource("contours")) ensureOverlays();
});

// ── 기저 소스 선택: 로컬 팩이 등록된 산이면 로컬, 아니면 온라인 ──
function useBaseFor(park) {
  const target = localRegistered[park] ? "local-" + park : PMTILES_URL;
  if (target !== baseUrl) {
    baseUrl = target;
    map.setStyle(buildStyle(baseUrl, theme)); // styledata 가 오버레이 재부착
  }
}

// 산별 오버레이(스팟/등고선) 지연 로드 — Storage packs/<산코드>/ 에서.
// 저장 팩(openSavedMap)이 이미 채웠으면 그대로 둔다.
async function ensureParkOverlays(park) {
  if (parkOverlays[park]) return;
  const fetchPack = (file) =>
    fetch(packUrl(park, file)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [spots, contours] = await Promise.all([
    fetchPack("spots.geojson"), fetchPack("contours.geojson")
  ]);
  parkOverlays[park] = { spots, contours };
}

// ── 산 데이터 로드 ───────────────────────────────────
async function loadPark(park) {
  currentPark = park;
  selectedName = null; // 산 전환 시 전체 표시로 초기화
  const cfg = PARKS[park];
  const cur = document.getElementById("cur-mtn");
  if (cur) cur.textContent = cfg.label;
  useBaseFor(park);
  let geojson = trailCache[park];
  if (!geojson) { geojson = await fetch(packUrl(park, "routes.geojson")).then((r) => r.json()); trailCache[park] = geojson; }
  await ensureParkOverlays(park);

  ensureOverlays();
  if (map.getSource("trails")) map.getSource("trails").setData(geojson);
  // 산별 오버레이(스팟/등고선) 데이터 주입
  const ov = parkOverlays[park] || {};
  if (map.getSource("spots")) map.getSource("spots").setData(ov.spots || EMPTY_FC);
  if (map.getSource("contours")) map.getSource("contours").setData(ov.contours || EMPTY_FC);
  applySpotsVisibility();
  applyContourVisibility();
  applyTrailFilter();
  fitPark(900); // 코스 전체 범위에 맞춰 축소/확대 (고정 줌 대신 화면 최적화)
  renderTrailList(geojson);
  refreshMapBtn();
  renderClimbWeather();  // 스냅샷/캐시로 등반 카드 즉시 표시
  loadMountainInfo(park); // 산 소개/높이/관리주체 카드 (날씨 위)
  loadWeather(park);     // 온라인이면 최신 예보로 갱신(비동기)
}

// ── 산 소개 카드 (mountain_info: 산코드 조인 · 높이/소개/관리주체) ──
// 검색된 산의 코스 목록 최상단(날씨 위)에 표시. iOS 이식: 동일 테이블을 supabase-swift 로 소비.
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const miCache = {}; // park(산코드) -> mountain_info 행 | null (세션 메모리)
async function loadMountainInfo(park) {
  const sec = document.getElementById("mi-sec");
  if (!sec) return;
  if (miCache[park] !== undefined) { renderMountainInfo(sec, park, miCache[park]); return; }
  sec.hidden = true; sec.innerHTML = ""; // 조회 전 이전 산 카드 제거
  let info = null;
  try {
    const { data } = await supabase.from("mountain_info")
      .select("name,elev,manager,manager_tel,description").eq("code", park).maybeSingle();
    info = data || null;
  } catch (_) { info = null; }
  miCache[park] = info;
  if (park === currentPark) renderMountainInfo(sec, park, info);
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (_) {}
  try { // 비보안 컨텍스트(http) 폴백
    const ta = document.createElement("textarea");
    ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  } catch (_) { return false; }
}
function renderMountainInfo(sec, park, info) {
  const cfg = PARKS[park] || {};
  const name = cfg.label || (info && info.name) || "";
  const elev = (info && info.elev != null) ? info.elev : cfg.elev;
  const desc = ((info && info.description) || "").trim();
  const mgr = info && info.manager;
  const tel = info && info.manager_tel;
  if (!name || (!desc && !mgr && elev == null)) { sec.hidden = true; sec.innerHTML = ""; return; }
  const LIMIT = 100;
  const long = desc.length > LIMIT;
  let expanded = false, telShown = false;
  function draw() {
    const shown = (!long || expanded) ? desc : desc.slice(0, LIMIT).trim() + "…";
    sec.innerHTML =
      `<div class="mi-head"><span class="mi-name">${esc(name)}</span>` +
      (elev != null ? `<span class="mi-elev">${Math.round(elev)}m</span>` : "") +
      (mgr ? `<span class="mi-mgr"><button class="mi-mgr-btn" type="button">관리 · ${esc(mgr)}</button>` +
        (telShown && tel ? `<button class="mi-tel" type="button">${esc(tel)}</button>` : "") + `</span>` : "") +
      `</div>` +
      (desc ? `<p class="mi-desc${expanded ? " open" : ""}">${esc(shown)}` +
        (long && !expanded ? ` <button class="mi-more" type="button">더 읽기</button>` : "") + `</p>` : "");
    sec.hidden = false;
    const more = sec.querySelector(".mi-more");
    if (more) more.onclick = (e) => { e.stopPropagation(); expanded = true; draw(); };
    const descEl = sec.querySelector(".mi-desc");
    if (descEl && long) descEl.onclick = () => { if (expanded) { expanded = false; draw(); } }; // 본문 누르면 접힘
    const mgrBtn = sec.querySelector(".mi-mgr-btn");
    if (mgrBtn) mgrBtn.onclick = () => { telShown = !telShown; draw(); };
    const telEl = sec.querySelector(".mi-tel");
    if (telEl) telEl.onclick = async () => {
      const ok = await copyText(tel);
      telEl.textContent = ok ? "복사됨 ✓" : tel;
      if (ok) setTimeout(() => { const e = sec.querySelector(".mi-tel"); if (e) e.textContent = tel; }, 1200);
    };
  }
  draw();
}

// ── 날씨 (기상청 단기예보 · 오프라인 스냅샷) ──────────
// 탐험(온라인): 실시간 시간대별 예보. 등반(오프라인): 마지막 온라인 스냅샷.
const wxCache = {}; // park -> fetchWeather 결과 (세션 메모리)
function wxKey(park) {
  const d = new Date(Date.now() + 9 * 3600000); // KST 날짜
  return `hiheight-wx:${park}:${d.toISOString().slice(0, 10)}`;
}
async function loadWeather(park) {
  const cfg = PARKS[park];
  const sec = document.getElementById("wx-explore-sec");
  const title = document.getElementById("wx-explore-title");
  if (!cfg || !cfg.center) { if (sec) sec.hidden = true; return; }
  if (title && cfg.label) title.textContent = `${cfg.label} 부근 오늘 날씨`;
  try {
    const data = await fetchWeather(cfg.center[1], cfg.center[0]); // 산 위치 격자 기준
    wxCache[park] = data;
    try { localStorage.setItem(wxKey(park), JSON.stringify(data)); } catch (_) {} // 오프라인 스냅샷
    if (park === currentPark) {
      renderStrip(document.getElementById("wx-explore"), data);
      if (sec) sec.hidden = false;
      renderClimbWeather();
    }
  } catch (_) {
    if (park === currentPark && sec) sec.hidden = true; // 조회 실패 시 탐험엔 숨김
  }
}
// 등반 카드/HUD 용: 온라인 캐시 우선, 없으면 오늘 스냅샷(오프라인)
function currentWeather(park) {
  if (wxCache[park]) return { data: wxCache[park], offline: false };
  try {
    const raw = localStorage.getItem(wxKey(park));
    if (raw) return { data: JSON.parse(raw), offline: true };
  } catch (_) {}
  return null;
}
function renderClimbWeather() {
  const park = climbSession ? climbSession.park : currentPark;
  const el = document.getElementById("wx-climb");
  if (!el) return;
  const w = park && currentWeather(park);
  if (!w) { el.hidden = true; return; }
  renderStrip(el, w.data, { offline: w.offline });
  el.hidden = false;
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
  localStorage.setItem("hiheight-last-course:" + currentPark, selectedName); // 저장 지도 열 때 자동선택용
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
// 카탈로그(PARKS)에서 파생 — famous 플래그는 관리자 콘솔에서 지정
function catalogList(famousOnly = false) {
  return Object.entries(PARKS)
    .filter(([, p]) => !famousOnly || p.famous)
    .map(([code, p]) => ({
      park: code, name: p.label,
      elev: p.elev ? p.elev + "m" : "", region: p.region || ""
    }));
}
function renderFamous() {
  const ul = document.getElementById("famous-list");
  ul.innerHTML = "";
  catalogList(true).forEach((m) => {
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

  // 접두 우선, 없으면 포함 매치 (가장 유사한 산부터) — 공개 카탈로그 전체 대상.
  // 빈 입력이면 아무것도 반환하지 않음(타이핑에 따른 자동완성 목록만 노출).
  function matches(q) {
    if (!q) return [];
    const all = catalogList();
    const pre = all.filter((m) => m.name.startsWith(q));
    const inc = all.filter((m) => !m.name.startsWith(q) && m.name.includes(q));
    return [...pre, ...inc];
  }
  // 입력한 글자는 진하게(typed), 자동완성된 나머지는 흐리게(ghost)
  function highlight(name, q) {
    if (name.startsWith(q)) {
      return `<span class="sr-typed">${q}</span><span class="sr-ghost">${name.slice(q.length)}</span>`;
    }
    const i = name.indexOf(q); // 접두가 아닌 포함 매치: 매치 부분만 진하게
    return i < 0 ? `<span class="sr-ghost">${name}</span>`
      : `<span class="sr-ghost">${name.slice(0, i)}</span><span class="sr-typed">${name.slice(i, i + q.length)}</span><span class="sr-ghost">${name.slice(i + q.length)}</span>`;
  }
  function render(q) {
    const query = (q || "").trim();
    if (!query) { results.innerHTML = ""; return; } // 입력 전에는 목록 미노출
    const list = matches(query);
    if (!list.length) { results.innerHTML = '<li class="sr-empty">검색 결과 없음</li>'; return; }
    results.innerHTML = list
      .map((m, i) => `<li data-park="${m.park}" class="${i === 0 ? "active" : ""}"><span class="sr-name">${highlight(m.name, query)}</span><span class="sr-meta">${m.elev} · ${m.region}</span></li>`)
      .join("");
    results.querySelectorAll("li[data-park]").forEach((li) =>
      li.addEventListener("click", () => { selectMountain(li.dataset.park); close(); })
    );
  }
  // 입력창에 가장 유사한 산 이름을 인라인 자동완성(나머지 글자 선택 표시)
  function autocomplete() {
    const typed = input.value;
    if (!typed) return;
    const m = catalogList().find((x) => x.name.startsWith(typed) && x.name !== typed);
    if (m) { input.value = m.name; input.setSelectionRange(typed.length, m.name.length); }
  }
  function pick() {
    const q = input.value.trim();
    const m = catalogList().find((x) => x.name === q) || matches(q)[0];
    if (m) { selectMountain(m.park); close(); }
  }
  function open() { panel.hidden = false; results.innerHTML = ""; input.focus(); }
  function close() { panel.hidden = true; input.value = ""; }

  btn.addEventListener("click", (e) => { e.stopPropagation(); panel.hidden ? open() : close(); });
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => {
    composing = false;
    render(input.value);
    autocomplete();                        // 인라인 자동완성은 조합 종료 후에만(IME 간섭 방지)
  });
  input.addEventListener("input", (e) => {
    render(input.value);                   // 목록은 한글 조합 중에도 매 글자 갱신
    if (composing) return;                 // 값 채우는 인라인 자동완성만 조합 종료 후
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
// 추천 코스 (당장은 하드코딩 존치 — 추후 routes.geojson `reco` 속성으로 이관 예정)
const RECO = [
  { name: "오색 - 대청봉 코스", park: "428302602", parkLabel: "설악산", diff: "고급", why: "설악 정상 대청봉을 최단 시간에 오르는 도전 코스" },
  { name: "진달래길", park: "113050202", parkLabel: "북한산", diff: "초급", why: "진달래능선을 따라 대동문으로, 봄이면 진달래 명소인 대표 등산로 (OSM)" },
  { name: "천불동계곡 코스", park: "428302602", parkLabel: "설악산", diff: "중급", why: "비선대·양폭을 지나는 설악의 대표 계곡길" }
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
  const mtn = (PARKS[currentPark] && PARKS[currentPark].label) || "";
  const badge = document.getElementById("climb-mtn"), div = document.getElementById("climb-div");
  if (badge) { badge.textContent = mtn; badge.hidden = !mtn; }
  if (div) div.hidden = !mtn;
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

  // 등반 중 HUD 에는 날씨 미표시 (출발 전 등반 카드에서만 확인)
  const wxHud = document.getElementById("wx-hud");
  if (wxHud) wxHud.hidden = true;

  // 국가지점번호: 지도 우측 상단(산·코스 박스 아래) — 현재 위치로 갱신
  const npnCode = document.getElementById("npn-code");
  const npnBox = document.getElementById("npn-box");
  if (npnCode) npnCode.textContent = "측정 중…";
  if (npnBox) npnBox.hidden = false;

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
        updateNpn(pos.coords.latitude, pos.coords.longitude); // 국가지점번호는 매 위치마다 갱신
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
  const npnBox = document.getElementById("npn-box");
  if (npnBox) npnBox.hidden = true;
  setStartBtn(false);
  await saveClimb();
}

// 현재 위치 → 국가지점번호 (지도 우측 상단 박스 갱신)
function updateNpn(lat, lon) {
  const el = document.getElementById("npn-code");
  if (!el) return;
  const r = nationalPointNumber(lat, lon);
  el.textContent = r ? r.code : "격자 밖";
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

  // 세션 변화 → UI/기록/저장된 지도 갱신 (등록 직후 INITIAL_SESSION 도 여기로 들어옴)
  supabase.auth.onAuthStateChange((_ev, session) => {
    currentUser = session?.user || null;
    updateAuthUI();
    renderRecords();
    renderSavedMaps(); // 로그아웃 → 숨김, 로그인 → 본인 계정 목록만
  });
}

// ── 다운로드 ─────────────────────────────────────────
// ── 로컬 팩 저장소 (IndexedDB) ───────────────────────
// 온라인일 때 지도(타일)+팩 데이터를 기기에 저장 → 등반 시 오프라인 사용.
// 웹 한계(iOS 파일시스템에서 해소): IndexedDB 는 브라우저 저장소라 용량 압박 시 퇴거될 수 있고,
// 앱 셸(html/js)·글리프 폰트는 네트워크 필요 → 완전 오프라인 "실행"은 iOS 로컬 번들 단계.
const IDB_NAME = "hiheight-packs", IDB_STORE = "packs";
function idbOpen() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(IDB_NAME, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(IDB_STORE, { keyPath: "id" });
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbTx(mode, fn) {
  const db = await idbOpen();
  try {
    return await new Promise((res, rej) => {
      const rq = fn(db.transaction(IDB_STORE, mode).objectStore(IDB_STORE));
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  } finally { db.close(); }
}
const idbGet = (id) => idbTx("readonly", (st) => st.get(id));
const idbPut = (rec) => idbTx("readwrite", (st) => st.put(rec));
const idbDelete = (id) => idbTx("readwrite", (st) => st.delete(id));
const idbList = () => idbTx("readonly", (st) => st.getAll());

// ── 지도 다운로드 (Storage → IndexedDB) ─────────────
// packUrl 은 상단 카탈로그 블록에 정의 (오버레이 로드와 공용)
let downloading = false;

// 시트 헤더 "지도 다운" 버튼 상태
async function refreshMapBtn() {
  const btn = document.getElementById("dl-map");
  if (!btn) return;
  const has = !!(await idbGet(currentPark).catch(() => null));
  btn.textContent = has ? "지도 저장됨 ✓" : "지도 다운";
  btn.classList.toggle("saved", has);
  btn.disabled = has || downloading;
}

// 확인 모달: 용량 경고 (mountains 카탈로그에서 실제 용량 조회)
async function openDlConfirm() {
  if (!currentUser) {
    // 지도 다운로드는 계정 기준(saved_packs) — 로그인 유도
    const msg = document.getElementById("auth-msg");
    if (msg) msg.textContent = "지도 다운로드는 로그인 후 이용할 수 있습니다.";
    showTab("girok");
    return;
  }
  if (downloading || (await idbGet(currentPark).catch(() => null))) return;
  const msg = document.getElementById("dc-msg");
  document.getElementById("dc-title").textContent = `${PARKS[currentPark].label} 지도 다운로드`;
  msg.innerHTML = "지도 용량이 클 수 있어요.<br>Wi-Fi 상태에서 진행해 주세요.";
  document.getElementById("dl-confirm").hidden = false;
  try {
    const { data } = await supabase.from("mountains")
      .select("pack_size_kb").eq("id", currentPark).maybeSingle();
    if (data && data.pack_size_kb)
      msg.innerHTML = `지도 용량이 클 수 있어요 (약 ${(data.pack_size_kb / 1024).toFixed(1)}MB).<br>Wi-Fi 상태에서 진행해 주세요.`;
  } catch (_) {}
}
document.getElementById("dl-map").addEventListener("click", openDlConfirm);
document.getElementById("dc-cancel").addEventListener("click", () => {
  document.getElementById("dl-confirm").hidden = true;
});
document.getElementById("dc-ok").addEventListener("click", () => {
  document.getElementById("dl-confirm").hidden = true;
  downloadPack(currentPark);
});

async function downloadPack(park) {
  if (downloading) return;
  downloading = true;
  refreshMapBtn();
  const cfg = PARKS[park];
  const prog = document.getElementById("dl-progress");
  const fill = document.getElementById("dp-fill");
  const status = document.getElementById("dp-status");
  document.getElementById("dp-name").textContent = cfg.label;
  document.getElementById("dp-size").textContent = "";
  prog.hidden = false;
  fill.style.width = "0%";
  status.textContent = "기저 지도 내려받는 중…";
  try {
    // 1) base.pmtiles — 바이트 단위 진행률 (전체의 90%)
    const res = await fetch(packUrl(park, "base.pmtiles"));
    if (!res.ok) throw new Error("기저 지도 파일 없음 (HTTP " + res.status + ")");
    const total = +res.headers.get("Content-Length") || 0;
    if (total) document.getElementById("dp-size").textContent = (total / 1048576).toFixed(1) + " MB";
    const chunks = [];
    let got = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total) fill.style.width = Math.min(90, (got / total) * 90).toFixed(1) + "%";
    }
    const base = new Blob(chunks, { type: "application/octet-stream" });

    // 2) 팩 데이터 (routes 필수, spots/contours 선택)
    status.textContent = "등산로·시설·등고선 내려받는 중…";
    const fetchJson = async (file) => {
      const r = await fetch(packUrl(park, file));
      return r.ok ? r.json() : null;
    };
    const routes = await fetchJson("routes.geojson");
    fill.style.width = "94%";
    if (!routes) throw new Error("등산로 데이터 없음");
    const spots = await fetchJson("spots.geojson");
    fill.style.width = "97%";
    const contours = await fetchJson("contours.geojson");
    fill.style.width = "99%";

    // 3) 기기 저장 + 계정 표시
    const rec = {
      id: park, label: cfg.label, base, routes, spots, contours,
      size_bytes: base.size, pack_version: 1, downloaded_at: new Date().toISOString()
    };
    await idbPut(rec);
    fill.style.width = "100%";
    if (currentUser) {
      await supabase.from("saved_packs").upsert({
        user_id: currentUser.id, mountain_id: park, pack_version: rec.pack_version
      });
    }
    status.textContent = "다운로드 완료 — 저장된 지도가 등반 탭에 추가되었습니다.";
    downloading = false;
    refreshMapBtn();
    await renderSavedMaps();
    setTimeout(() => { prog.hidden = true; showTab("deung"); }, 900);
  } catch (e) {
    console.error("지도 다운로드 실패:", e);
    status.textContent = "다운로드 실패: " + (e.message || e) + " — 다시 시도해 주세요.";
    fill.style.width = "0%";
    downloading = false;
    refreshMapBtn();
  }
}

// ── 저장된 지도 (등반 탭) — 로그인 계정 기준 노출 ─────
async function renderSavedMaps() {
  const wrap = document.getElementById("saved-maps");
  const ul = document.getElementById("sm-list");
  if (!wrap || !ul) return;
  // 로그아웃 상태: 목록 숨김 (팩 파일 자체는 기기에 유지 — 재로그인 시 다시 표시)
  if (!currentUser) { wrap.hidden = true; ul.innerHTML = ""; return; }
  let recs = [];
  try { recs = await idbList(); } catch (_) {}
  // 본인 계정의 saved_packs 와 교차 — 다른 계정이 받은 팩은 노출하지 않음
  // (오프라인 등으로 조회 실패 시엔 기기 목록 그대로 표시: 오프라인 우선)
  try {
    const { data, error } = await supabase.from("saved_packs").select("mountain_id");
    if (!error && data) {
      const mine = new Set(data.map((r) => r.mountain_id));
      recs = recs.filter((r) => mine.has(r.id));
    }
  } catch (_) {}
  wrap.hidden = !recs.length;
  ul.innerHTML = "";
  recs.forEach((rec) => {
    const li = document.createElement("li");
    li.className = "sm-item";
    li.innerHTML = `
      <div class="sm-info">
        <span class="sm-name">${rec.label}</span>
        <span class="sm-meta">${(rec.size_bytes / 1048576).toFixed(1)}MB · ${fmtDate(rec.downloaded_at)} 저장 · 오프라인 사용 가능</span>
      </div>
      <button class="sm-del">삭제</button>`;
    li.querySelector(".sm-del").addEventListener("click", async (e) => {
      e.stopPropagation();
      await idbDelete(rec.id);
      delete localRegistered[rec.id];
      if (currentUser) await supabase.from("saved_packs").delete().eq("mountain_id", rec.id);
      if (baseUrl === "local-" + rec.id) useBaseFor(currentPark); // 사용 중이던 로컬 소스면 온라인으로 복귀
      renderSavedMaps();
      refreshMapBtn();
    });
    li.addEventListener("click", () => openSavedMap(rec.id));
    ul.appendChild(li);
  });
}

// 저장된 지도 열기: 로컬 타일 + 로컬 데이터로 지도 표시, 최근 코스 자동선택
async function openSavedMap(id) {
  const rec = await idbGet(id).catch(() => null);
  if (!rec) return;
  if (!PARKS[id]) {
    // 완전 오프라인 + 카탈로그 캐시 부재 → 저장 팩 레코드로 최소 카탈로그 복원
    const flat = rec.routes.features.flatMap((f) =>
      (f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [f.geometry.coordinates]).flat());
    const xs = flat.map((c) => c[0]), ys = flat.map((c) => c[1]);
    const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    PARKS[id] = { label: rec.label, zoom: 12,
      center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2], bbox };
  }
  if (!localRegistered[id]) {
    // IndexedDB Blob 을 pmtiles 소스로 등록 → "pmtiles://local-<id>" (네트워크 불필요)
    protocol.add(new PMTiles(new FileSource(new File([rec.base], "local-" + id))));
    localRegistered[id] = true;
  }
  trailCache[id] = rec.routes;
  parkOverlays[id] = { spots: rec.spots || null, contours: rec.contours || null };
  await loadPark(id); // useBaseFor 가 로컬 소스로 스타일 전환
  const last = localStorage.getItem("hiheight-last-course:" + id);
  const f = rec.routes.features.find((x) => x.properties.name === last) || rec.routes.features[0];
  if (f) focusTrail(f); // 최근(없으면 첫) 코스 자동선택 → 등반 시작 버튼 활성
  showTab("tam");
}

// ── 테마 토글 ────────────────────────────────────────
function applyTheme(t) {
  theme = t;
  localStorage.setItem(THEME_KEY, t);
  document.documentElement.dataset.theme = t;
  map.setStyle(buildStyle(baseUrl, t)); // styledata 핸들러가 오버레이 재부착 (로컬 팩 유지)
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

// ── 인트로 스플래시 ──────────────────────────────────
// 태그라인(0.25s) → 브랜드(1.15s) 순차 페이드인, 2.8s 에 페이드아웃 → 탐험 화면.
// 지도 초기 로딩을 자연스럽게 가려주는 역할도 겸한다.
(function splash() {
  const el = document.getElementById("splash");
  if (!el) return;
  setTimeout(() => {
    el.classList.add("hide");
    setTimeout(() => el.remove(), 700);
  }, 2800);
})();

// ── 시작 ─────────────────────────────────────────────
setupAuth(); // 세션 복원 + 로그인/가입/로그아웃 바인딩 (기록/저장 UI 구동)

map.on("load", async () => {
  peaksData = await fetch("data/peaks.geojson").then((r) => r.json()).catch(() => null);
  ensureOverlays();
  const codes = await loadCatalog(); // mountains 카탈로그 (오프라인 시 캐시)
  if (codes.length) await loadPark(codes[0]); // 첫 산(sort_order 1위) — 오버레이는 산별 지연 로드
  renderFamous();
  renderReco();
  renderRecords();
  renderSavedMaps(); // IndexedDB 에 저장된 지도 목록 (등반 탭)
  document.getElementById("loading").classList.add("hidden");
});
map.on("error", (e) => console.error("Map error:", e && e.error));
