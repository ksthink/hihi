import maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/+esm";
import { Protocol, PMTiles, FileSource } from "https://cdn.jsdelivr.net/npm/pmtiles@3.2.1/+esm";
import { buildStyle, POI_DISPLAY_DEFAULT, normPoiDisplay } from "./basemap-style.js";
import { supabase, signUp, signIn, signOut } from "./supabase-client.js";
import { fetchWeather, renderStrip } from "./weather.js";
import { nationalPointNumber } from "./npn.js";

// ── 설정 ──────────────────────────────────────────────
const PMTILES_URL = `${location.origin}/pmtiles/kr-base.pmtiles`; // same-origin 프록시 → 자체 호스팅 R2 base (CORS 회피)
const TERRAIN_URL = `${location.origin}/pmtiles/kr-terrain.pmtiles`; // 음영기복 terrain-RGB (온라인 전용)
// 현재 기저 소스: 온라인(PMTILES_URL) 또는 로컬 팩("local-<산id>", IndexedDB Blob 등록 후)
let baseUrl = PMTILES_URL;
// 음영기복은 온라인 기저일 때만 — 로컬 팩(오프라인) 열람 시 원격 fetch 를 만들지 않는다
const terrainFor = (base) => (base === PMTILES_URL ? TERRAIN_URL : null);

// ── 기저지도 POI 표시 정책 (admin 편집 · R2 config/poi-display.json) ──
// 지도 생성 전에 필요하므로 localStorage 캐시를 동기로 읽어 초기 스타일에 반영하고,
// R2 최신본은 비동기로 받아 달라졌을 때만 레이어에 재적용한다 (부팅 비차단).
const POICFG_KEY = "hiheight-poi-display";
let poiDisplay = normPoiDisplay(null);
try {
  poiDisplay = normPoiDisplay(JSON.parse(localStorage.getItem(POICFG_KEY)));
} catch (_) { /* 기본값 유지 */ }

// 산 식별자 = 산림청 산코드 9자리 (mountain/<산코드>/ 원본 폴더가 곧 목록).
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
    if (q.error) throw q.error;
    // 빈 카탈로그도 정상 상태 — 캐시 폴백하면 삭제된 산(옛 캐시)이 되살아난다
    PARKS = {};
    for (const m of q.data || []) {
      PARKS[m.id] = {
        label: m.name, center: m.center, zoom: m.zoom, bbox: m.bbox,
        elev: m.elev, region: m.region, famous: m.famous !== false,
        lists: m.lists || [] // 공식 추천 카테고리 (bac100·knps — migrations-002)
      };
    }
    localStorage.setItem(CATALOG_KEY, JSON.stringify(PARKS));
  } catch (_) {
    // 조회 실패(오프라인 등)에만 마지막 카탈로그 캐시로 폴백 (저장 팩 열람 유지)
    try { PARKS = JSON.parse(localStorage.getItem(CATALOG_KEY)) || {}; } catch (_e) { PARKS = {}; }
  }
  return Object.keys(PARKS);
}

// Storage 팩 파일 공개 URL — 카탈로그의 데이터 소스 (routes/spots/contours/base.pmtiles)
// 팩 파일은 Cloudflare R2 자체 호스팅(egress 무료). 브라우저가 직접 fetch → R2 CORS 필요(공개 OSM 데이터).
// base.pmtiles(최대 8.5MB)는 Vercel 함수 4.5MB 한도 초과라 프록시 불가 → R2 직결이 정답.
const R2_PACKS_BASE = "https://pub-cfc2302f77a446c1a0fdff6d0ae4e451.r2.dev/packs";
const packUrl = (park, file) => `${R2_PACKS_BASE}/${park}/${file}`;

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
// 등반 중 '지나갈 곳'(선택 코스) 색 — 지나온 실측 트랙(본선색: 라이트 검정/다크 흰색)보다
// 한 단계 낮춘 짙은 회색 (다크 모드에선 검정 배경 위 중간 회색)
const climbAheadColor = () => (theme === "dark" ? "#969696" : "#666666");

// ── 기저 모드 (지형 전용 / OSM) ──────────────────────
// 기본은 지형 전용: 음영기복+등고선+루트+스팟에 최소 오리엔테이션만 — 저데이터·저배터리.
// 들머리 접근 등 도로 맥락이 필요하면 토글로 OSM 전체 basemap 을 켠다.
const BASEMODE_KEY = "hiheight-basemode";
let baseMode = localStorage.getItem(BASEMODE_KEY) === "osm" ? "osm" : "terrain";
// 모든 setStyle 경로의 단일 진입점 — 라이브 모듈 상태(baseUrl·theme·poiDisplay·baseMode)를 캡처.
const buildCurrentStyle = () => buildStyle(baseUrl, theme, terrainFor(baseUrl), poiDisplay, baseMode);

// ── PMTiles 프로토콜 등록 ────────────────────────────
const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

// ── 지도 초기화 ──────────────────────────────────────
const map = new maplibregl.Map({
  container: "map",
  style: buildCurrentStyle(),
  center: [126.990, 37.672], // 카탈로그 로드 전 기본 뷰 (첫 산 로드 시 flyTo)
  zoom: 11.3,
  hash: true,
  // 남한에 최적화한 이동/축소 범위. 최대 축소에서 경계가 화면에 꽉 차면 팬이 잠기고
  // 각 지점의 화면 위치는 경계 박스 안 상대 위치로 고정된다. 그래서:
  //  · 북 39.2 — 북한 노출 최소화하되 파주·고성 등 접경은 넉넉히 (화면 상단 ~90%)
  //  · 남 28.3 — 제주가 화면 높이 ~44% 지점(하단 시트 위)에 오도록 남쪽 여백 확보.
  //    남는 바다는 시트가 덮는 영역이라 낭비 아님
  maxBounds: [[121.5, 28.3], [134.0, 39.2]], // [SW, NE]
  // 6 미만이면 지명 필터(min_zoom 6: 부산·인천·대구…)가 정수 줌 5에서 평가돼 광역시가 사라짐.
  // 가로 경계가 폰 화면 폭에 맞는 z5.5까지 축소가 풀리는 것을 여기서 차단.
  minZoom: 6,
  localIdeographFontFamily: "'MonaS12', 'Apple SD Gothic Neo', 'Malgun Gothic', monospace"
});
window.__map = map; // 디버그·헤드리스 테스트 훅 (모듈 스코프라 밖에서 접근 불가)
// 초기 load 발생 여부 — isStyleLoaded() 는 타일 로딩 중 false 라 이 플래그로 판별
let mapLoadFired = false;
map.once("load", () => { mapLoadFired = true; });
// 하단 시트(232px)+탭바(72px)가 지도 아래를 상시 덮음(style.css #sheet) — 카메라 기준을
// 가시 영역으로 보정. 최대 축소 클램프·fitBounds·flyTo 가 시트 위 영역 중심으로 동작해
// 최남단(제주)이 시트에 가려지지 않는다. 등반 모드는 시트가 사라지므로 0 으로 전환.
const SHEET_PAD = 304;
map.setPadding({ top: 0, right: 0, bottom: SHEET_PAD, left: 0 });
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

// 지형 전용 / OSM 토글 — 테마 버튼과 동일 프레임, 그 위에 배치.
// 아이콘: 지형=산(음영 전용), OSM=접힌 지도. 버튼 상태는 setStyle 을 넘어 유지되므로
// (컨트롤 DOM 은 스타일에 속하지 않음) applyBaseMode 에서 직접 갱신한다.
const BASE_ICON = {
  terrain:
    '<svg class="icn" viewBox="0 0 24 24" fill="currentColor"><path d="M9.2 8.5l3.1 5.3 1.9-3.1L18 18H4l5.2-9.5z" opacity=".3"/><path d="M14.5 4l6.5 14H8L14.5 4zm0 3.9L10.8 16h7.4L14.5 7.9z"/></svg>',
  osm:
    '<svg class="icn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M9 4.5 3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5 9 4.5z"/><path d="M9 4.5v13M15 6.5v13"/></svg>',
};
const baseIcon = (m) => BASE_ICON[m === "osm" ? "osm" : "terrain"];
const baseTitle = (m) => (m === "terrain" ? "지형 전용 — 탭하면 OSM 지도" : "OSM 지도 — 탭하면 지형 전용");
class BaseControl {
  onAdd() {
    const div = document.createElement("div");
    div.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "base-toggle";
    btn.setAttribute("aria-label", "지형/지도 전환");
    btn.title = baseTitle(baseMode);
    btn.innerHTML = baseIcon(baseMode);
    btn.addEventListener("click", () => applyBaseMode(baseMode === "terrain" ? "osm" : "terrain"));
    div.appendChild(btn);
    this._c = div;
    return div;
  }
  onRemove() { this._c.remove(); }
}
map.addControl(new BaseControl(), "bottom-right");

// ── 지도 POI 아이콘 (흑백 뱃지, 런타임 캔버스 생성) ────
// 외부 스프라이트/CDN 없이 styleimagemissing 때 즉석 생성 — 오프라인·테마 전환 자동 대응.
// iOS 이식 시 동일 아이콘 id 로 UIImage 를 스타일에 등록하면 됨.
const POI_TEXT = { toilets: "WC", parking: "P", information: "i", place_of_worship: "卍", helipad: "H" };

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

  // 뱃지: 역·헬기장은 원형(관제 기호 관례), 나머지는 라운드 사각
  ctx.fillStyle = bg;
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  if (kind === "station" || kind === "helipad") ctx.arc(S / 2, S / 2, S / 2 - P, 0, Math.PI * 2);
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
  } else if (kind === "viewpoint") {
    // 조망점: 시점(점) + 부챗살(국제 지도 관례)
    ctx.lineWidth = 1.3;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const a of [-52, -26, 0, 26, 52]) {
      const r = (a - 90) * Math.PI / 180;
      ctx.moveTo(S / 2, 13.5);
      ctx.lineTo(S / 2 + Math.cos(r) * 8, 13.5 + Math.sin(r) * 8);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(S / 2, 13.5, 1.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "shelter") {
    // 정자: 지붕(팔작 곡선) + 기둥 2 + 마루
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.beginPath();                              // 지붕
    ctx.moveTo(4.5, 9);
    ctx.quadraticCurveTo(S / 2, 3, 15.5, 9);
    ctx.lineTo(4.5, 9);
    ctx.fill();
    ctx.beginPath();                              // 기둥
    ctx.moveTo(7, 9.5); ctx.lineTo(7, 14.5);
    ctx.moveTo(13, 9.5); ctx.lineTo(13, 14.5);
    ctx.stroke();
    ctx.fillRect(5, 14.5, 10, 1.4);               // 마루
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
let selectedTrail = null;
let selectedName = null;
let interactionsBound = false;
const trailCache = {};
// 산별 오버레이 데이터: { <park>: { spots, contours } } — 시작 시 북한산은 fetch, 저장 팩은 IndexedDB
const parkOverlays = {};
// pmtiles Protocol 에 로컬 Blob 소스가 등록된 산: { <park>: true }
const localRegistered = {};

// ── 스팟 표시 정책 (admin 에서 편집 · R2 config/spot-display.json) ──
// 값 = { zoom: 표시 시작 줌(0=항상, null=끔), icon: 기호(점·시설 아이콘·▲), size: 글자 px,
//        bold: 볼드 }. 레거시 형식(값이 숫자|null)은 normSpotDisplay 가 zoom 으로 승격.
// 부팅 시 R2 설정을 읽고 실패하면 캐시→기본값. iOS 도 동일 JSON 을 소비 (데이터 주도 정책).
// admin_server.py 기본값과 일치 유지. 정상의 size 는 주봉 크기(부봉은 비율 축소).
const SPOT_DISPLAY_DEFAULT = {
  정상: { zoom: 0, icon: true, size: 14.4, bold: true },
  장소: { zoom: 14, icon: true, size: 8.9, bold: false },
  조망점: { zoom: 18, icon: true, size: 8.4, bold: false },
  화장실: { zoom: 18, icon: true, size: 8.4, bold: false },
  정자: { zoom: 18, icon: true, size: 8.4, bold: false },
  헬기장: { zoom: 18, icon: true, size: 8.4, bold: false },
  음수대: { zoom: 18, icon: true, size: 8.4, bold: false },
  주차장: { zoom: null, icon: true, size: 8.4, bold: false },
  분기점: { zoom: null, icon: true, size: 8.9, bold: false },
  시종점: { zoom: null, icon: true, size: 8.9, bold: false },
};
function normSpotDisplay(raw) {
  const out = {};
  for (const [k, def] of Object.entries(SPOT_DISPLAY_DEFAULT)) {
    const v = raw?.[k];
    out[k] = v === undefined ? { ...def }
      : (v === null || typeof v === "number") ? { ...def, zoom: v }
      : { ...def, ...v };
  }
  return out;
}
const SPOT_FONT = (b) => [b ? "MonaS12 Bold" : "MonaS12 Regular"];
let spotDisplay = normSpotDisplay(null);
const SPOTCFG_KEY = "hiheight-spot-display";
async function loadSpotDisplay() {
  try {
    const url = R2_PACKS_BASE.replace(/\/packs$/, "") + "/config/spot-display.json";
    const cfg = await fetch(url, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null));
    if (!cfg?.categories) throw new Error("no cfg");
    spotDisplay = normSpotDisplay(cfg.categories);
    localStorage.setItem(SPOTCFG_KEY, JSON.stringify(spotDisplay));
  } catch (_) { // 미배포/오프라인 → 마지막 캐시, 없으면 기본값
    try {
      spotDisplay = normSpotDisplay(JSON.parse(localStorage.getItem(SPOTCFG_KEY)) || {});
    } catch (_e) { /* 기본값 유지 */ }
  }
}
// ── 기저지도 POI 설정 로드/적용 (상태 선언은 상단 — 지도 생성 전 캐시 반영) ──
async function loadPoiDisplay() {
  try {
    const url = R2_PACKS_BASE.replace(/\/packs$/, "") + "/config/poi-display.json";
    const cfg = await fetch(url, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null));
    if (!cfg?.categories) return; // 미배포/오프라인 → 캐시(또는 기본값)로 이미 동작 중
    const next = normPoiDisplay(cfg.categories);
    localStorage.setItem(POICFG_KEY, JSON.stringify(next));
    if (JSON.stringify(next) === JSON.stringify(poiDisplay)) return; // 변화 없음
    poiDisplay = next;
    // 스타일 재생성으로 반영 — 크기·볼드·아이콘까지 한 경로로 일관 적용.
    // (테마 토글과 동일 경로: styledata 핸들러가 오버레이 재부착)
    // 초기 로드 전이면 load 이후로 미룸. isStyleLoaded() 는 타일 스트리밍 중에도
    // false 라 판별 근거가 못 됨 — load 발생 플래그(mapLoadFired)를 쓴다.
    const restyle = () => map.setStyle(buildCurrentStyle());
    if (mapLoadFired) restyle();
    else map.once("load", restyle);
  } catch (_) { /* 캐시/기본값 유지 */ }
}

// ── 큐레이션 (admin 편집 · R2 config/curations.json) — 추천 탭 데이터 ──
// 있으면 추천 탭이 큐레이션 그룹을 렌더, 없으면(미배포·오프라인 첫 방문) 내장 RECO 폴백.
let curations = null;
const CURATIONS_KEY = "hiheight-curations";
try {
  curations = JSON.parse(localStorage.getItem(CURATIONS_KEY));
} catch (_) { /* 폴백 유지 */ }
async function loadCurations() {
  try {
    const url = R2_PACKS_BASE.replace(/\/packs$/, "") + "/config/curations.json";
    const cfg = await fetch(url, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null));
    if (!cfg?.curations) return;
    curations = cfg.curations;
    localStorage.setItem(CURATIONS_KEY, JSON.stringify(curations));
    renderReco(); // 이미 그려진 추천 탭 갱신 (부팅 순서 무관)
  } catch (_) { /* 캐시/폴백 유지 */ }
}

// 점·라벨로 그리는 분류 / 아이콘으로 그리는 분류 (정상은 spot-peaks 별도)
const DOT_CATS = ["분기점", "시종점", "장소"];
const FACILITY_ICON = {
  조망점: "poi-viewpoint", 화장실: "poi-toilets", 정자: "poi-shelter",
  헬기장: "poi-helipad", 음수대: "poi-drinking_water", 주차장: "poi-parking",
};
// 스팟 표시 우선순위: 스팟별 오버라이드(disp_zoom·disp_icon·disp_size·disp_bold,
// 관리자 스팟 편집에서 지정·팩 properties 로 발행) > 분류 전역 설정(spotDisplay).
// 분류별 노출 줌 게이트 — 끔(null)=99, disp_zoom 99=끔 (필터의 zoom 은 정수 줌에서 평가됨)
const zoomGate = (cats) => [">=", ["zoom"], ["coalesce", ["get", "disp_zoom"],
  ["match", ["get", "category"], ...cats.flatMap((c) => [c, spotDisplay[c]?.zoom ?? 99]), 99]]];
// 분류별 글자 크기·글꼴 (데이터 주도 match — 레이어 하나로 충돌 풀 공유)
const sizeMatch = (cats) => ["coalesce", ["get", "disp_size"], ["match", ["get", "category"],
  ...cats.flatMap((c) => [c, spotDisplay[c].size]), 8.9]];
// disp_bold 3상(true/false/없음→분류) — to-string: 없음(null)은 "" 로 떨어져 분류 폰트
const fontMatch = (cats) => ["match", ["to-string", ["get", "disp_bold"]],
  "true", ["literal", SPOT_FONT(true)], "false", ["literal", SPOT_FONT(false)],
  ["match", ["get", "category"],
    ...cats.flatMap((c) => [c, ["literal", SPOT_FONT(spotDisplay[c].bold)]]),
    ["literal", SPOT_FONT(false)]]];
// 기호 표시 게이트(불리언) — 스팟별 disp_icon 이 분류 설정을 덮음
const iconGate = (cats) => ["to-boolean", ["coalesce", ["get", "disp_icon"],
  ["match", ["get", "category"], ...cats.flatMap((c) => [c, spotDisplay[c].icon]), false]]];

// ── 난이도 미터 (흑백) ───────────────────────────────
function difMeter(diff) {
  const lv = DIFF_LEVEL[diff] || 1;
  let s = '<span class="dmeter">';
  for (let i = 1; i <= 3; i++) s += `<i class="${i <= lv ? "on" : ""}"></i>`;
  return s + "</span>";
}

// ── 코스 번호·시종점 (부록 D) ────────────────────────
// 번호: 팩 properties.no(관리자 부여), 없으면 레거시 팩 폴백으로 피처 순서(1-based)
const courseNo = (p, i) => (p && p.no != null ? p.no : i + 1);

// 코스 최장 라인 파트의 누적길이 중간점 — 번호 라벨 위치
function lineMidpoint(lines) {
  let best = lines[0] || [];
  let bestLen = -1;
  for (const ln of lines) {
    let L = 0;
    for (let i = 1; i < ln.length; i++) L += haversine(ln[i - 1], ln[i]);
    if (L > bestLen) { bestLen = L; best = ln; }
  }
  let acc = 0;
  const half = bestLen / 2;
  for (let i = 1; i < best.length; i++) {
    const d = haversine(best[i - 1], best[i]);
    if (acc + d >= half) {
      const t = d ? (half - acc) / d : 0;
      return [best[i - 1][0] + (best[i][0] - best[i - 1][0]) * t,
              best[i - 1][1] + (best[i][1] - best[i - 1][1]) * t];
    }
    acc += d;
  }
  return best[best.length - 1] || [0, 0];
}

const asLines = (g) => (g.type === "LineString" ? [g.coordinates] : g.coordinates);

// 번호 배지 이미지 — 캔버스에 직접 그려 글리프 실측(actualBoundingBox)으로 정중앙 배치.
// (심볼 text 는 폰트 메트릭 때문에 원 중심과 어긋남.)
// 기본: 흰 원+검정 숫자(라이트만 검정 테두리) / 선택(sel): 색 반전 — 검정 원+흰 숫자(다크만 흰 테두리)
function makeBadge(no, sel) {
  const scale = 2, r = 9.5, pad = 2, size = (r + pad) * 2 * scale;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  const cx = size / 2;
  ctx.beginPath();
  ctx.arc(cx, cx, r * scale, 0, Math.PI * 2);
  ctx.fillStyle = sel ? "#111111" : "#ffffff";
  ctx.fill();
  // 테두리: 지도 바탕과 원 색이 비슷해지는 조합에만 (라이트×흰 원, 다크×검정 원)
  if (sel ? theme === "dark" : theme !== "dark") {
    ctx.lineWidth = 1.5 * scale;
    ctx.strokeStyle = sel ? "#ffffff" : "#111111";
    ctx.stroke();
  }
  const s = String(no);
  ctx.fillStyle = sel ? "#ffffff" : "#111111";
  ctx.font = `700 ${11.5 * scale}px "MonaS12", monospace`;
  ctx.textAlign = "center";
  const m = ctx.measureText(s);
  ctx.fillText(s, cx, cx + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  return ctx.getImageData(0, 0, size, size);
}
// 배지는 필요 시점에 생성 — 테마 전환(setStyle)이 이미지를 비우면 현재 테마로 재생성됨
map.on("styleimagemissing", (e) => {
  const m = /^badge-(\d+)(-sel)?$/.exec(e.id);
  if (m && !map.hasImage(e.id)) map.addImage(e.id, makeBadge(+m[1], !!m[2]), { pixelRatio: 2 });
});

function courseNoFC(fc) {
  if (!fc || !fc.features) return EMPTY_FC;
  return { type: "FeatureCollection", features: fc.features.map((f, i) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: lineMidpoint(asLines(f.geometry)) },
    // name: 배지 클릭 → 코스 선택(selectByName) 연결용
    properties: { no: courseNo(f.properties, i), name: f.properties.name }
  })) };
}

// 선택된 코스의 시점·종점 포인트 (미선택이면 빈 FC)
function courseEndsData() {
  const fc = trailCache[currentPark];
  if (!selectedName || !fc) return EMPTY_FC;
  const f = fc.features.find((x) => x.properties.name === selectedName);
  if (!f) return EMPTY_FC;
  const lines = asLines(f.geometry);
  const first = lines[0], last = lines[lines.length - 1];
  if (!first?.length || !last?.length) return EMPTY_FC;
  return { type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Point", coordinates: first[0] },
      properties: { kind: "start", label: "출발" } },
    { type: "Feature", geometry: { type: "Point", coordinates: last[last.length - 1] },
      properties: { kind: "end", label: "도착" } },
  ] };
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
        "text-font": ["MonaS12 Regular"], "text-size": 8.4, "symbol-spacing": 300
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
    // 클릭 히트 확장 — 실제 선(2~7px)은 모바일 탭이 못 맞춤. 넓은 투명 선이 탭을 받는다.
    map.addLayer({
      id: "trail-hit", type: "line", source: "trails",
      paint: { "line-color": "#000", "line-opacity": 0.001,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 16, 16, 28] }
    });

    // 코스 번호 배지 — 코스 중앙에 항상 표시 (부록 D. 데이터 주도 → iOS 이식 안전)
    // makeBadge 캔버스 아이콘(styleimagemissing 생성): 숫자가 원 정중앙에 실측 배치됨.
    map.addSource("course-nos", { type: "geojson", data: courseNoFC(trailCache[currentPark]) });
    map.addLayer({
      id: "course-no-badges", type: "symbol", source: "course-nos", minzoom: 10.5,
      layout: {
        "icon-image": ["concat", "badge-", ["to-string", ["get", "no"]]],
        "icon-allow-overlap": true, "icon-ignore-placement": true
      }
    });
    // 시점·종점 마커 — 코스 선택 시에만 (applyTrailFilter 가 주입)
    map.addSource("course-ends", { type: "geojson", data: courseEndsData() });
    map.addLayer({
      id: "course-ends-dots", type: "circle", source: "course-ends",
      paint: {
        "circle-radius": 5,
        "circle-color": ["case", ["==", ["get", "kind"], "start"], c.line, c.casing],
        "circle-stroke-color": ["case", ["==", ["get", "kind"], "start"], c.casing, c.line],
        "circle-stroke-width": 2
      }
    });
    map.addLayer({
      id: "course-ends-labels", type: "symbol", source: "course-ends",
      layout: {
        "text-field": ["get", "label"], "text-font": ["MonaS12 Bold"],
        "text-size": 9.5, "text-offset": [0, 1.1], "text-anchor": "top",
        "text-allow-overlap": true
      },
      paint: { "text-color": c.line, "text-halo-color": c.casing, "text-halo-width": 1.6 }
    });

    // 저장된 산행 기록 트랙 (기록 탭에서 선택 시 setData) — 점선 라운드로 코스 선과 구분
    map.addSource("rec-track", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "rec-track-casing", type: "line", source: "rec-track",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.casing, "line-width": 6 }
    });
    map.addLayer({
      id: "rec-track", type: "line", source: "rec-track",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.line, "line-width": 2.6, "line-dasharray": [0.1, 1.8] }
    });

    // 등반 중 라이브 트랙(지나온 곳) — GPS 갱신마다 setData. 선택 코스(trail-hl,
    // 지나갈 곳)는 등반 중 짙은 회색으로 낮춰 실측 선이 그 위에 본선색으로 쌓인다.
    map.addSource("climb-track", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "climb-track-casing", type: "line", source: "climb-track",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.casing, "line-width": 6.5 }
    });
    map.addLayer({
      id: "climb-track", type: "line", source: "climb-track",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.line, "line-width": 3.4 }
    });
    applyClimbRoute(); // 테마 전환 등 재부착 시 진행 중 등반 상태 복원
  }

  if (!map.getSource("spots")) {
    map.addSource("spots", { type: "geojson", data: ov.spots || EMPTY_FC });
    // 분류별 노출 줌은 admin 설정(spotDisplay) 주도 — zoomGate 가 필터에서 게이팅
    map.addLayer({
      id: "spots-dots", type: "circle", source: "spots",
      // 기호(점)는 분류 설정+스팟별 오버라이드의 불리언 게이트 — 꺼진 스팟은 라벨만.
      // 라벨의 실제 위치를 특정하는 앵커 점 — 흑백에서 헤일로 링(casing)으로 분리.
      filter: ["all", ["in", ["get", "category"], ["literal", DOT_CATS]],
        iconGate(DOT_CATS), zoomGate(DOT_CATS)],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.4, 16, 3.8],
        "circle-color": c.line,
        "circle-stroke-color": c.casing,
        "circle-stroke-width": 1.4
      }
    });
    // 운영자가 이름 붙인 분기점/시종점만 지도 라벨 (관리자 콘솔 큐레이션)
    map.addLayer({
      id: "spots-labels", type: "symbol", source: "spots",
      filter: ["all", ["in", ["get", "category"], ["literal", DOT_CATS]], ["has", "name"], zoomGate(DOT_CATS)],
      layout: {
        "text-field": ["get", "name"], "text-font": fontMatch(DOT_CATS),
        "text-size": sizeMatch(DOT_CATS),
        // 점(앵커)이 커진 만큼 라벨을 아래로 — 점과 글자가 겹치지 않게
        "text-offset": [0, 0.9], "text-anchor": "top", "text-max-width": 8
      },
      paint: { "text-color": c.line, "text-halo-color": c.casing, "text-halo-width": 1.4 }
    });
    // 편의시설 (조망점·화장실·정자·헬기장·음수대·주차장) — 아이콘 + 이름(있을 때, 아이콘 우선).
    // 기호를 끈 분류는 이름만 표시. 충돌 시 자동 숨김으로 밀집 정리.
    const FAC_CATS = Object.keys(FACILITY_ICON);
    map.addLayer({
      id: "spots-facilities", type: "symbol", source: "spots",
      filter: ["all", ["in", ["get", "category"], ["literal", FAC_CATS]], zoomGate(FAC_CATS)],
      layout: {
        // 기호 게이트(분류 설정+스팟별 disp_icon)가 켜진 피처만 분류 아이콘, 꺼지면 이름만
        "icon-image": ["case", iconGate(FAC_CATS),
          ["match", ["get", "category"], ...Object.entries(FACILITY_ICON).flat(), ""], ""],
        "text-field": ["coalesce", ["get", "name"], ""],
        "text-font": fontMatch(FAC_CATS),
        "text-size": sizeMatch(FAC_CATS),
        "text-offset": [0, 1.05], "text-anchor": "top", "text-max-width": 8,
        "text-optional": true
      },
      paint: { "text-color": c.line, "text-halo-color": c.casing, "text-halo-width": 1.4 }
    });
    // 정상(peak) 스팟 → 봉우리 표식 (팩 주도 — 관리자에서 '정상'으로 찍은 지점).
    // 봉우리 표식: 라이트 ▲(채움) / 다크 △(외곽) + 지명. 테마 토글 시 재부착으로 갱신.
    // size 설정 = 주봉 크기, 부봉(main=false)은 11/14.4 비율로 축소. icon 설정 = ▲ 접두 기호.
    const pk = spotDisplay["정상"];
    map.addLayer({
      id: "spot-peaks", type: "symbol", source: "spots",
      filter: ["all", ["==", ["get", "category"], "정상"],
        [">=", ["zoom"], ["coalesce", ["get", "disp_zoom"], pk.zoom ?? 99]]],
      layout: {
        // ▲ 접두 기호 — 스팟별 disp_icon 이 분류 설정(pk.icon)을 덮음
        "text-field": ["concat",
          ["case", ["to-boolean", ["coalesce", ["get", "disp_icon"], pk.icon]],
            theme === "dark" ? "△" : "▲", ""],
          ["coalesce", ["get", "name"], ""]],
        "text-font": ["match", ["to-string", ["get", "disp_bold"]],
          "true", ["literal", SPOT_FONT(true)], "false", ["literal", SPOT_FONT(false)],
          ["literal", SPOT_FONT(pk.bold)]],
        // 정상은 기본 최상위. 부봉으로 낮추려면 스팟 main=false. disp_size 가 최우선.
        "text-size": ["coalesce", ["get", "disp_size"],
          ["case", ["==", ["get", "main"], false],
            Math.round(pk.size * (11 / 14.4) * 10) / 10, pk.size]],
        "text-offset": [0, -0.6], "text-anchor": "bottom"
      },
      paint: { "text-color": c.line, "text-halo-color": c.casing, "text-halo-width": 1.8 }
    });
  }

  // 상호작용은 한 번만 바인딩 (레이어 id 기준이라 테마 재부착 후에도 유효)
  if (!interactionsBound && map.getLayer("trail-line")) {
    // 번호 배지 클릭도 코스 선택 — focusTrail 이 목록 하이라이트·스크롤까지 처리
    // trail-hit(넓은 투명 선)이 코스 라인 탭을 받음. 배지를 나중에 등록해 겹칠 땐 배지가 우선.
    ["trail-hit", "course-no-badges"].forEach((id) => {
      map.on("click", id, (e) => selectByName(e.features[0].properties.name));
      map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
    });
    ["spots-dots", "spots-facilities"].forEach((id) => {
      map.on("click", id, (e) => {
        const p = e.features[0].properties;
        new maplibregl.Popup({ maxWidth: "240px" })
          .setLngLat(e.lngLat)
          .setHTML(`<div class="popup-title">${p.name || p.category || "스팟"}</div>
            <div class="popup-meta">${p.name ? p.category + "<br>" : ""}${p.detail || ""}${p.etc ? "<br>" + p.etc : ""}</div>`)
          .addTo(map);
      });
      map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
    });
    interactionsBound = true;
  }

  applySpotsVisibility();
  applyContourVisibility();
  applyTrailFilter();
}

// 스팟/등고선은 현재 산의 데이터가 있을 때만 표시 (산별 일반화)
function applySpotsVisibility() {
  const vis = (parkOverlays[currentPark] || {}).spots ? "visible" : "none";
  ["spots-dots", "spots-labels", "spots-facilities"].forEach((id) => {
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
  // 선택 코스의 번호 배지는 반전 아이콘(badge-N-sel)으로 교체 — 이미지는 styleimagemissing 이 생성
  if (map.getLayer("course-no-badges"))
    map.setLayoutProperty("course-no-badges", "icon-image",
      ["concat", "badge-", ["to-string", ["get", "no"]],
        ["case", ["==", ["get", "name"], selectedName || "__none__"], "-sel", ""]]);
  // 시점·종점 마커: 선택 시에만 해당 코스에 표시 (부록 D)
  if (map.getSource("course-ends")) map.getSource("course-ends").setData(courseEndsData());
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
  if (!gj || !gj.features || !gj.features.length) {
    // 코스 0개(빈 배포) 산 — 카탈로그의 중심/줌으로 이동
    const cfg = PARKS[currentPark];
    if (cfg?.center) map.flyTo({ center: cfg.center, zoom: cfg.zoom || 12, duration });
    return;
  }
  const b = geojsonBounds(gj);
  if (!isFinite(b[0])) return;
  document.getElementById("sheet")?.classList.remove("expanded");
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: fitPadding(), maxZoom: 15.5, duration });
}

// setStyle(테마/기저 변경) 후 오버레이 재부착.
// 부팅 중 조기 styledata 는 건너뜀 — 스팟 표시 설정(spotDisplayReady)이 오기 전에
// 레이어를 만들면 기본값으로 굳는다. 첫 부착은 map "load" 핸들러가 설정 확보 후 수행.
map.on("styledata", () => {
  if (!spotCfgReady) return;
  if (!map.getSource("trails") || !map.getSource("spots") || !map.getSource("contours")) ensureOverlays();
});

// ── 기저 소스 선택: 로컬 팩이 등록된 산이면 로컬, 아니면 온라인 ──
function useBaseFor(park) {
  const target = localRegistered[park] ? "local-" + park : PMTILES_URL;
  if (target !== baseUrl) {
    baseUrl = target;
    map.setStyle(buildCurrentStyle()); // styledata 가 오버레이 재부착
  }
}

// 산별 팩 파일 fetch — 프라미스를 공유해 부팅 프리페치와 loadPark 의 중복 요청을 막는다.
const packFetches = {}; // "<park>/<file>" → Promise<json|null>
function fetchPack(park, file) {
  const key = `${park}/${file}`;
  packFetches[key] ||= fetch(packUrl(park, file))
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return packFetches[key];
}
// 첫 산 팩 프리페치 — 카탈로그가 도착하면 지도 타일 로드와 병렬로 미리 받아둔다
function prefetchPark(park) {
  fetchPack(park, "routes.geojson");
  fetchPack(park, "spots.geojson");
  fetchPack(park, "contours.geojson");
}

// 산별 오버레이(스팟/등고선) 지연 로드 — Storage packs/<산코드>/ 에서.
// 저장 팩(openSavedMap)이 이미 채웠으면 그대로 둔다.
async function ensureParkOverlays(park) {
  if (parkOverlays[park]) return;
  const [spots, contours] = await Promise.all([
    fetchPack(park, "spots.geojson"), fetchPack(park, "contours.geojson")
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
  if (!geojson) {
    // 팩 유실/미배포(404 등)여도 부팅을 죽이지 않는다 — 등산로만 비우고 지도는 띄움
    geojson = (await fetchPack(park, "routes.geojson")) || EMPTY_FC;
    trailCache[park] = geojson;
  }
  await ensureParkOverlays(park);

  ensureOverlays();
  if (map.getSource("trails")) map.getSource("trails").setData(geojson);
  if (map.getSource("course-nos")) map.getSource("course-nos").setData(courseNoFC(geojson));
  // 산별 오버레이(스팟/등고선) 데이터 주입
  const ov = parkOverlays[park] || {};
  if (map.getSource("spots")) map.getSource("spots").setData(ov.spots || EMPTY_FC);
  if (map.getSource("contours")) map.getSource("contours").setData(ov.contours || EMPTY_FC);
  if (map.getSource("rec-track")) map.getSource("rec-track").setData(EMPTY_FC); // 산 전환 시 기록 트랙 지움
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
// 일출·일몰 (로컬 계산 · 오프라인 · 네트워크 불필요) — Almanac for Computers 알고리즘.
// 입력 lat/lng(도), tz 기본 KST(+9). 반환 { rise, set } "HH:MM" (극야·백야 등 계산불가면 null).
// iOS 이식: 동일 알고리즘을 SunTimes.swift 로 포팅(데이터 주도 아님, 순수 계산).
function sunTimes(lat, lng, tz = 9, date = new Date(Date.now() + tz * 3600000)) {
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const sin = (d) => Math.sin(d * D2R), cos = (d) => Math.cos(d * D2R), tan = (d) => Math.tan(d * D2R);
  const asin = (x) => Math.asin(x) * R2D, acos = (x) => Math.acos(x) * R2D, atan = (x) => Math.atan(x) * R2D;
  const y = date.getUTCFullYear();
  const N = Math.floor((Date.UTC(y, date.getUTCMonth(), date.getUTCDate()) - Date.UTC(y, 0, 0)) / 86400000);
  const zenith = 90.833, lngHour = lng / 15;              // 90.833° = 태양 상단연 + 대기굴절
  const wrap = (v, m) => ((v % m) + m) % m;
  function calc(rising) {
    const t = N + ((rising ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    const L = wrap(M + 1.916 * sin(M) + 0.020 * sin(2 * M) + 282.634, 360);
    let RA = wrap(atan(0.91764 * tan(L)), 360);
    RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;   // RA 를 L 과 같은 사분면으로
    RA /= 15;
    const sinDec = 0.39782 * sin(L), cosDec = cos(asin(sinDec));
    const cosH = (cos(zenith) - sinDec * sin(lat)) / (cosDec * cos(lat));
    if (cosH > 1 || cosH < -1) return null;               // 그 날 해가 안 뜸/안 짐
    let H = (rising ? 360 - acos(cosH) : acos(cosH)) / 15;
    const T = H + RA - 0.06571 * t - 6.622;
    return wrap(wrap(T - lngHour, 24) + tz, 24);
  }
  const fmt = (h) => {
    const m = wrap(Math.round(h * 60), 1440);
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };
  const r = calc(true), s = calc(false);
  return (r == null || s == null) ? null : { rise: fmt(r), set: fmt(s) };
}

function renderMountainInfo(sec, park, info) {
  const cfg = PARKS[park] || {};
  const name = cfg.label || (info && info.name) || "";
  const elev = (info && info.elev != null) ? info.elev : cfg.elev;
  // 이름·고도 + (우측)일출/일몰. 관리 주체·산 설명은 미표시(mountain_info 로딩은 유지).
  if (!name) { sec.hidden = true; sec.innerHTML = ""; return; }
  const c = cfg.center;
  const sun = c ? sunTimes(c[1], c[0]) : null;
  sec.innerHTML =
    `<div class="mi-head"><span class="mi-name">${esc(name)}</span>` +
    (elev != null ? `<span class="mi-elev">${Math.round(elev)}m</span>` : "") +
    (sun ? `<span class="mi-sun"><span>일출 ${sun.rise}</span><span>일몰 ${sun.set}</span></span>` : "") +
    `</div>`;
  sec.hidden = false;
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
  geojson.features.forEach((f, i) => {
    const p = f.properties;
    const li = document.createElement("li");
    li.className = "trail-item";
    li.dataset.name = p.name;
    li.innerHTML = `
      <div class="t-left">
        <div class="t-name"><span class="t-title"><span class="t-no">${courseNo(p, i)}</span>${p.name}</span> <span class="badge">${difLabel(p.difficulty)} ${difMeter(p.difficulty)}</span></div>
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
function catalogList(pred = null) {
  return Object.entries(PARKS)
    .filter(([, p]) => !pred || pred(p))
    .map(([code, p]) => ({
      park: code, name: p.label,
      elev: p.elev ? p.elev + "m" : "", region: p.region || ""
    }));
}
// 공식 추천 카테고리 — 산마다 admin 에서 분류(famous 컬럼 + lists 배열)
const OFFICIAL_LISTS = [
  { label: "대한민국 100대 명산", member: (p) => p.famous },
  { label: "블랙야크(BAC) 명산 100", member: (p) => (p.lists || []).includes("bac100") },
  { label: "국립공원공단 공식탐방로", member: (p) => (p.lists || []).includes("knps") },
];
function renderFamous() {
  const box = document.getElementById("official-lists");
  box.innerHTML = "";
  for (const list of OFFICIAL_LISTS) {
    const wrap = document.createElement("div");
    wrap.className = "famous";
    const btn = Object.assign(document.createElement("button"), {
      className: "famous-btn", textContent: list.label,
    });
    const ul = document.createElement("ul");
    ul.className = "famous-list";
    ul.hidden = true;
    const items = catalogList(list.member);
    for (const m of items) {
      const li = document.createElement("li");
      li.className = "famous-item";
      li.innerHTML = `<span class="fm-name">${m.name}</span><span class="fm-meta">${m.elev} · ${m.region}</span>`;
      li.addEventListener("click", () => selectMountain(m.park));
      ul.appendChild(li);
    }
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "famous-item fm-empty";
      li.innerHTML = '<span class="fm-meta">등록된 산 준비 중</span>';
      ul.appendChild(li);
    }
    btn.addEventListener("click", () => {
      ul.hidden = !ul.hidden;
      btn.classList.toggle("open", !ul.hidden);
    });
    wrap.append(btn, ul);
    box.appendChild(wrap);
  }
}
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
// 큐레이션 항목 클릭 → 산(탐험 탭에서 산 열기) 또는 코스(코스 선택·포커스)
function openCurationItem(it) {
  if (it.type === "mountain") { showTab("tam"); loadPark(it.code); }
  else openTrailByName(it.code, it.name);
}

// 첫 큐레이션 = 정사각 캐러셀 (수동 스와이프 스냅 + 점 인디케이터). 항목 순서 = 슬라이드 순서.
// 슬라이드 요소(전부 선택 — 입력 없으면 미표시):
//   sub 부가설명(좌상단 반투명 배지) → title 큰 제목 → desc 중앙 하단(가운데 정렬)
//   → logo 좌하단 마크(© 하이하잇). 배경 = 산 커버 이미지(없으면 무채색 그래디언트).
function pickCarousel(cu, items) {
  const frag = document.createDocumentFragment();
  const h = document.createElement("div");
  h.className = "reco-group-title";
  h.textContent = cu.title;
  frag.appendChild(h);

  const car = document.createElement("div");
  car.className = "pick-carousel";
  for (const it of items) {
    const slide = document.createElement("div");
    slide.className = "pick-slide";
    if (it.img) {
      const img = Object.assign(document.createElement("img"), {
        className: "ps-img", src: it.img, alt: "", loading: "lazy",
      });
      img.onerror = () => img.remove(); // 이미지 유실 → 그래디언트 배경 노출
      slide.appendChild(img);
    }
    slide.insertAdjacentHTML("beforeend", `
      <div class="ps-shade"></div>
      ${it.sub || it.title ? `<div class="ps-head">
        ${it.sub ? `<span class="ps-kicker">${it.sub}</span>` : ""}
        ${it.title ? `<div class="ps-title">${it.title}</div>` : ""}
      </div>` : ""}
      ${it.desc ? `<div class="ps-desc">${it.desc}</div>` : ""}
      ${it.logo ? `<div class="ps-logo">${it.logo}</div>` : ""}
      ${it.credit ? `<div class="ps-credit">${it.credit}</div>` : ""}`);
    slide.addEventListener("click", () => openCurationItem(it));
    car.appendChild(slide);
  }
  frag.appendChild(car);

  // 점 인디케이터 — 스크롤 스냅 위치 추적
  if (items.length > 1) {
    const dots = document.createElement("div");
    dots.className = "pick-dots";
    items.forEach((_, i) => {
      const d = document.createElement("i");
      if (i === 0) d.className = "on";
      dots.appendChild(d);
    });
    let raf = null;
    car.addEventListener("scroll", () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const w = car.firstChild.offsetWidth + 12; // 슬라이드 폭 + gap
        const i = Math.max(0, Math.min(items.length - 1, Math.round(car.scrollLeft / w)));
        [...dots.children].forEach((d, j) => d.classList.toggle("on", j === i));
      });
    }, { passive: true });
    frag.appendChild(dots);
  }
  return frag;
}

// 항목의 대표산 이름 (지난 매거진 목록 메타)
const itemMountainName = (it) =>
  it.type === "mountain" ? it.name : (it.mountain || PARKS[it.code]?.label || "");

let recoView = 0; // 추천 탭에서 보고 있는 매거진 인덱스 (0 = 노출 중)
function renderReco() {
  const box = document.getElementById("reco-list");
  box.innerHTML = "";
  // 큐레이션(admin 등록) 우선 — 카탈로그에 없는 산/코스는 열 수 없으므로 제외.
  // 노출 매거진 1세트만 캐러셀, 나머지는 "지난 매거진 보기" 목록(제목·대표산) —
  // 목록을 누르면 그 매거진이 캐러셀로 전환돼 자세히 볼 수 있다.
  if (curations?.length) {
    const valid = curations
      .map((cu, i) => ({ cu, i, items: (cu.items || []).filter((it) => PARKS[it.code]) }))
      .filter((v) => v.items.length);
    if (valid.length) {
      if (recoView >= valid.length) recoView = 0;
      const cur = valid[recoView];
      box.appendChild(pickCarousel(cur.cu, cur.items));
      const others = valid.filter((v) => v !== cur);
      if (others.length) {
        const wrap = document.createElement("div");
        wrap.className = "famous";
        const btn = Object.assign(document.createElement("button"), {
          className: "famous-btn", textContent: "지난 매거진 보기",
        });
        const ul = document.createElement("ul");
        ul.className = "famous-list";
        ul.hidden = true;
        for (const v of others) {
          const li = document.createElement("li");
          li.className = "famous-item";
          li.innerHTML = `<span class="fm-name">${v.cu.title}</span>
            <span class="fm-meta">${itemMountainName(v.items[0])}</span>`;
          li.addEventListener("click", () => {
            recoView = valid.indexOf(v);
            renderReco();
          });
          ul.appendChild(li);
        }
        btn.addEventListener("click", () => {
          ul.hidden = !ul.hidden;
          btn.classList.toggle("open", !ul.hidden);
        });
        wrap.append(btn, ul);
        box.appendChild(wrap);
      }
      return;
    }
  }
  // 폴백: 내장 추천 (큐레이션 미배포·오프라인 첫 방문)
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

// 등반 라이브 상태를 지도에 반영 — 지나온 트랙 라인 + 선택 코스를 '지나갈 곳' 회색으로.
// 등반 종료(climbSession=null) 시 트랙을 비우고 코스 색을 복원한다.
function applyClimbRoute() {
  const src = map.getSource("climb-track");
  if (!src) return;
  const pts = climbSession?.track || [];
  src.setData(pts.length >= 2
    ? { type: "Feature", properties: {},
        geometry: { type: "LineString", coordinates: pts.map((pt) => [pt[0], pt[1]]) } }
    : EMPTY_FC);
  if (map.getLayer("trail-hl"))
    map.setPaintProperty("trail-hl", "line-color",
      climbSession ? climbAheadColor() : trailColors().line);
}

function startClimb() {
  const p = selectedTrail.properties;
  climbSession = {
    startedAt: new Date(), feature: selectedTrail, park: currentPark,
    watchId: null, timer: null, track: [], dist: 0
  };
  setStartBtn(true);
  applyClimbRoute(); // 선택 코스를 '지나갈 곳' 회색으로 전환

  // 지도 화면으로 전환: 선택 코스만 표시(이미 필터됨) + 코스 범위로 이동
  showTab("tam");
  appEl.classList.add("climbing");
  map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 }); // 등반 중엔 시트 없음 — 전체 화면 기준
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
        // 트랙 점 = [lng, lat, 고도(m·없으면 null), unix초] — iOS(CoreLocation)도 동일 포맷 기록
        const ele = pos.coords.altitude != null ? Math.round(pos.coords.altitude) : null;
        climbSession.track.push([+pt[0].toFixed(6), +pt[1].toFixed(6), ele, Math.floor(Date.now() / 1000)]);
        applyClimbRoute(); // 지나온 루트 라이브 갱신
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
  map.setPadding({ top: 0, right: 0, bottom: SHEET_PAD, left: 0 }); // 시트 복귀 — 카메라 보정 복원
  document.getElementById("climb-hud").hidden = true;
  const npnBox = document.getElementById("npn-box");
  if (npnBox) npnBox.hidden = true;
  setStartBtn(false);
  await saveClimb();
  applyClimbRoute(); // 라이브 트랙 지우고 코스 색 복원
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

// 트랙 고도 통계 — 이동평균(창 5)으로 GPS 고도 잡음을 누른 뒤 누적 상승/하강 계산.
// 고도 샘플이 10개 미만이거나 전체 점의 절반 미만이면 신뢰 불가 → null(코스 계획값 사용).
// iOS(CoreLocation·기압계 보정)에서도 동일 계산을 쓰면 된다.
function elevStats(track) {
  const seq = track.map((pt) => pt[2]).filter((e) => e != null);
  if (seq.length < 10 || seq.length < track.length / 2) return null;
  const W = 5;
  const smooth = seq.map((_, i) => {
    const s = seq.slice(Math.max(0, i - W + 1), i + 1);
    return s.reduce((a, b) => a + b, 0) / s.length;
  });
  let up = 0, down = 0;
  for (let i = 1; i < smooth.length; i++) {
    const d = smooth[i] - smooth[i - 1];
    if (d > 0) up += d; else down -= d;
  }
  return { min: Math.round(Math.min(...seq)), max: Math.round(Math.max(...seq)),
           ascent: Math.round(up), descent: Math.round(down) };
}

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
  // track jsonb 포맷(네이티브 공용): { points: [[lng,lat,고도|null,unix초]…], elev?: {min,max,ascent,descent} }
  // (구형 기록은 points 가 [lng,lat,unix초] 3원소 — 소비 측에서 길이로 구분)
  const elev = track.length >= 2 ? elevStats(track) : null;
  const rec = {
    user_id: currentUser.id,
    mountain_id: s.park,
    course_name: p.name,
    started_at: s.startedAt.toISOString(),
    ended_at: ended.toISOString(),
    // 실제 걸은 거리만 기록 (코스 계획 거리로 대체하지 않음 — GPS 없으면 0)
    distance_km: +measuredKm.toFixed(2),
    // 상승고도도 같은 원칙 — 실측(고도 샘플 충분)이면 실측, 아니면 코스 계획값
    ascent_m: elev ? elev.ascent : (p.ascent ?? null),
    duration_s: Math.max(1, Math.round((ended - s.startedAt) / 1000)),
    track: track.length >= 2 ? { points: track, ...(elev ? { elev } : {}) } : null
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

// ── 산행 달력 — 기록 있는 날 점 표시, ‹ › 로 월 이동 ──
let calMonth = null; // Date(연, 월, 1) — 표시 중인 달 (기본: 이번 달)
let calRecDays = new Set(); // "YYYY-M-D" (로컬 날짜) — 기록 있는 날
function renderRecCalendar() {
  const box = document.getElementById("rec-cal");
  if (!box) return;
  if (!currentUser) { box.hidden = true; return; }
  box.hidden = false;
  if (!calMonth) { const n = new Date(); calMonth = new Date(n.getFullYear(), n.getMonth(), 1); }
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const today = new Date();
  const first = new Date(y, m, 1).getDay(); // 첫날 요일(일=0)
  const days = new Date(y, m + 1, 0).getDate();

  box.innerHTML = "";
  const head = document.createElement("div");
  head.className = "rc-head";
  const nav = (label, delta) => {
    const b = Object.assign(document.createElement("button"), { textContent: label });
    b.onclick = () => { calMonth = new Date(y, m + delta, 1); renderRecCalendar(); };
    return b;
  };
  head.append(nav("‹", -1),
    Object.assign(document.createElement("span"), { textContent: `${y}.${String(m + 1).padStart(2, "0")}` }),
    nav("›", 1));
  box.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "rc-grid";
  for (const w of ["일", "월", "화", "수", "목", "금", "토"])
    grid.appendChild(Object.assign(document.createElement("span"), { className: "rc-w", textContent: w }));
  for (let i = 0; i < first; i++) grid.appendChild(document.createElement("span"));
  for (let d = 1; d <= days; d++) {
    const cell = document.createElement("span");
    cell.className = "rc-d";
    if (y === today.getFullYear() && m === today.getMonth() && d === today.getDate())
      cell.classList.add("today");
    cell.textContent = d;
    if (calRecDays.has(`${y}-${m + 1}-${d}`)) {
      cell.classList.add("has-rec");
      cell.appendChild(Object.assign(document.createElement("i"), { className: "rc-dot" }));
    }
    grid.appendChild(cell);
  }
  box.appendChild(grid);
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
    renderRecCalendar(); // 로그아웃 → 달력 숨김
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

  // 달력용 기록 날짜 집계 (로컬 날짜 기준) 후 렌더
  calRecDays = new Set(recs.filter((r) => r.started_at).map((r) => {
    const d = new Date(r.started_at);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }));
  renderRecCalendar();

  // 실제 걸은 거리 — 트랙이 있으면 트랙에서 재계산(구형 기록의 코스 계획 거리 교정),
  // 없으면 저장값. 시간(duration_s)은 원래 실측(시작→종료).
  const actualKm = (r) => {
    const pts = r.track?.points;
    if (pts?.length >= 2) {
      let d = 0;
      for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i]);
      return +(d / 1000).toFixed(2);
    }
    return r.distance_km ?? 0;
  };

  let totDist = 0, totGain = 0;
  recs.forEach((r) => {
    const km = actualKm(r);
    totDist += km;
    totGain += r.ascent_m || 0;
    const li = document.createElement("li");
    li.className = "rec-item";
    li.innerHTML = `
      <div class="ri-body">
        <div class="ri-top"><span class="ri-name">${
          // "산 이름 | 코스명" — 산은 카탈로그(PARKS)에서, 없으면 코스명만
          [PARKS[r.mountain_id]?.label, r.course_name].filter(Boolean).join(" | ") || r.mountain_id || "산행"
        }</span><span class="ri-date">${fmtDate(r.started_at)}</span></div>
        <div class="ri-meta"><span>${km} km</span><span>${fmtDur(r.duration_s)}</span>${
          r.track?.elev ? `<span>↑${r.track.elev.ascent}m</span>` : ""
        }${hasTrack(r) ? '<span class="ri-route">루트 ›</span>' : ""}</div>
      </div>
      <button class="ri-del">삭제</button>`;
    wireRecordSwipe(li, r);
    // 트랙 있는 기록 탭 → 지도에 루트 표시 (스와이프 직후·삭제 열림 상태는 무시)
    if (hasTrack(r)) {
      li.querySelector(".ri-body").addEventListener("click", () => {
        if ((li._x || 0) < -1) { li._close(); return; }
        if (li._sup) return;
        openRecordTrack(r);
      });
    }
    ul.appendChild(li);
  });
  setSummary(recs.length, totDist.toFixed(1), totGain);
}

// 기록 트랙 지도 표시 — 저장된 points 를 LineString 으로 그리고 트랙 범위로 이동.
// 점 포맷: 신형 [lng,lat,고도,t] / 구형 [lng,lat,t] — 앞 2개만 좌표로 사용.
const hasTrack = (r) => (r.track?.points?.length || 0) >= 2 && !!PARKS[r.mountain_id];
async function openRecordTrack(r) {
  showTab("tam");
  await loadPark(r.mountain_id); // 산 전환 시 rec-track 이 비워진 뒤 아래서 주입
  const coords = r.track.points.map((pt) => [pt[0], pt[1]]);
  map.getSource("rec-track")?.setData({ type: "Feature", properties: {},
    geometry: { type: "LineString", coordinates: coords } });
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  for (const [x, y] of coords) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  map.fitBounds([[minX, minY], [maxX, maxY]], { padding: fitPadding(), maxZoom: 15.5, duration: 700 });
}

// ── 기록 스와이프 삭제 ──────────────────────────────
// 왼쪽 스와이프 → 삭제 버튼 노출(한 번에 한 행) → 확인 후 영구 삭제.
// 포인터 이벤트(터치·마우스 공용), 세로 제스처는 스크롤에 양보(touch-action: pan-y).
let openRecRow = null; // 삭제 버튼이 열려 있는 행
function wireRecordSwipe(li, rec) {
  const body = li.querySelector(".ri-body");
  const OPEN = -76; // 삭제 버튼 폭만큼 밀림
  let startX = 0, startY = 0, base = 0, dragging = false, axis = null;
  const setX = (x, animate) => {
    body.style.transition = animate ? "transform .18s ease" : "none";
    body.style.transform = `translateX(${x}px)`;
    li.classList.toggle("swiping", x < -1); // 닫힘 상태에선 삭제 버튼 숨김(모서리 비침 방지)
    li._x = x;
  };
  li._close = () => { setX(0, true); if (openRecRow === li) openRecRow = null; };
  body.addEventListener("pointerdown", (e) => {
    dragging = true; axis = null;
    startX = e.clientX; startY = e.clientY; base = li._x || 0;
    if (openRecRow && openRecRow !== li) openRecRow._close(); // 다른 행은 닫기
  });
  body.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!axis) { // 첫 6px 로 가로/세로 판정 — 세로는 목록 스크롤에 양보
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis === "x") body.setPointerCapture(e.pointerId);
    }
    if (axis === "x") setX(Math.max(OPEN, Math.min(0, base + dx)), false);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    if (axis !== "x") return;
    const open = (li._x || 0) < OPEN / 2; // 절반 이상 밀면 열림 유지
    setX(open ? OPEN : 0, true);
    openRecRow = open ? li : (openRecRow === li ? null : openRecRow);
    li._sup = true; // 드래그 직후 click 억제 (루트 열기 오작동 방지)
    setTimeout(() => { li._sup = false; }, 80);
  };
  body.addEventListener("pointerup", end);
  body.addEventListener("pointercancel", end);
  li.querySelector(".ri-del").addEventListener("click", async () => {
    const name = rec.course_name || rec.mountain_id || "산행";
    if (!confirm(`"${name}" 기록을 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) {
      li._close();
      return;
    }
    const { error } = await supabase.from("climb_records").delete().eq("id", rec.id);
    if (error) { alert("삭제 실패: " + error.message); return; }
    renderRecords(); // 목록·상단 합계 갱신
  });
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
  map.setStyle(buildCurrentStyle()); // styledata 핸들러가 오버레이 재부착 (로컬 팩 유지)
}

// ── 기저 모드 토글 (지형 전용 ⇄ OSM) ─────────────────
function applyBaseMode(m) {
  baseMode = m;
  localStorage.setItem(BASEMODE_KEY, m);
  const btn = document.getElementById("base-toggle");
  if (btn) { btn.innerHTML = baseIcon(m); btn.title = baseTitle(m); }
  map.setStyle(buildCurrentStyle()); // styledata 핸들러가 오버레이 재부착 (로컬 팩 유지)
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

// 부팅 병렬화 — 카탈로그·스팟 설정·첫 산 팩 fetch 를 지도 타일 로드와 동시에 시작.
// (map "load" 뒤에서 직렬로 기다리면 부팅 꼬리가 ~2초 늘어난다)
let spotCfgReady = false; // styledata 핸들러의 조기 오버레이 부착 게이트
const spotDisplayReady = loadSpotDisplay().finally(() => { spotCfgReady = true; });
loadPoiDisplay(); // 기저지도 POI 정책 — 초기 스타일은 캐시로 이미 반영, 최신본은 도착 시 재적용
loadCurations(); // 추천 탭 큐레이션 — 도착 시 renderReco 재호출
const catalogReady = loadCatalog().then((codes) => {
  if (codes.length) prefetchPark(codes[0]);
  return codes;
});

map.on("load", async () => {
  await spotDisplayReady; // 스팟 노출 정책 — 레이어(필터) 생성 전에 확보
  ensureOverlays();
  const codes = await catalogReady; // mountains 카탈로그 (오프라인 시 캐시)
  if (codes.length) await loadPark(codes[0]); // 첫 산(sort_order 1위) — 팩은 프리페치와 공유
  renderFamous();
  renderReco();
  renderRecords();
  renderSavedMaps(); // IndexedDB 에 저장된 지도 목록 (등반 탭)
  document.getElementById("loading").classList.add("hidden");
});
map.on("error", (e) => console.error("Map error:", e && e.error));
