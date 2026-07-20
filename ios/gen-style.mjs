// buildStyle() (웹과 동일 소스) → 네이티브 번들용 스타일 JSON 2종 생성.
// 웹은 same-origin 상대경로를 쓰지만 네이티브는 절대 URL 이 필요하므로,
// pmtiles/글리프 URL 을 맥 admin_server 프록시(http://localhost:8890)로 절대화한다.
//
//   실행:  cd ios && node gen-style.mjs
//   산출:  HiHeight/Resources/basemap-light.json, basemap-dark.json (gitignore — 재생성)
//
// 계약(§8-2): 스타일 로직의 단일 출처는 basemap-style.js. 이 스크립트는 URL 절대화만 한다.
import { buildStyle } from "../basemap-style.js";
import { writeFileSync, mkdirSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// 타일·팩 소스 절대 URL 베이스 — R2 커스텀 도메인 직결(§8-1). dev/로컬은 env 로 오버라이드.
const BASE = process.env.HIHEIGHT_BASE || "https://hihi.metaphr.dev";
const OUT = new URL("./HiHeight/Resources/", import.meta.url);
mkdirSync(OUT, { recursive: true });

// 지도 글리프 pbf 를 번들 리소스로 복사(../fonts/<fontstack>/ → Resources/glyphs/<fontstack>/).
// 소스는 fonts/ 에 커밋돼 있고 이 복사본은 gitignore(중복 방지). project.yml 이 type:folder 로 번들.
const ROOT = fileURLToPath(new URL("../", import.meta.url));   // 저장소 루트(ios/ 의 상위)
const RES = fileURLToPath(OUT);
for (const stack of ["MonaS12 Regular", "MonaS12 Bold"]) {
  cpSync(join(ROOT, "fonts", stack), join(RES, "glyphs", stack), { recursive: true });
}

function make(theme, baseMode) {
  const style = buildStyle(
    `${BASE}/kr-base.pmtiles`,        // R2 버킷 루트에 객체 존재(프록시의 /pmtiles/ 접두사 없음)
    theme,
    `${BASE}/kr-terrain.pmtiles`,
    null, // poiDisplay 기본값 (스파이크). 본 이식에선 R2 config/poi-display.json 반영.
    baseMode, // "terrain"(지형 전용) | "osm"(전체 basemap) — 앱 지도 컨트롤 토글이 파일명으로 선택.
  );
  // 글리프: 앱 번들 포함(오프라인, §3.2). 번들 상대경로 → MapLibre 가 스타일 URL 기준으로 해석.
  // Resources/glyphs/<fontstack>/<range>.pbf (폴더참조로 구조 보존 — project.yml).
  style.glyphs = "glyphs/{fontstack}/{range}.pbf";

  // ── S1 오버레이 검증: 등고선 3종 (팩 geojson) ──
  // buildStyle() 기저엔 없고 웹은 app.js:463-489 에서 별도 오버레이로 얹는다.
  // 동일 GL 표현식을 스타일 JSON 에 그대로 추가 → Native 가 NSExpression 변환 없이 렌더.
  // 소스 데이터는 admin_server 정적 서빙(data/packs/<코드>/contours.geojson).
  const PACK = "282600201"; // 계양산
  const cc = theme === "dark"
    ? { line: "#3a3a3a", label: "#8a8a8a", halo: "#000000" }
    : { line: "#c4bfb5", label: "#8a857c", halo: "#ffffff" };
  style.sources.contours = {
    type: "geojson",
    data: `${BASE}/packs/${PACK}/contours.geojson`,
  };
  style.layers.push(
    // 50m 보조 등고선
    { id: "contour-line", type: "line", source: "contours", minzoom: 12.5,
      filter: ["==", ["get", "idx"], 0],
      paint: { "line-color": cc.line, "line-width": 0.5, "line-opacity": 0.5 } },
    // 100m 주 등고선
    { id: "contour-index", type: "line", source: "contours", minzoom: 10.5,
      filter: ["==", ["get", "idx"], 1],
      paint: { "line-color": cc.line, "line-width": 1.1, "line-opacity": 0.7 } },
    // 고도 라벨 (주 등고선)
    { id: "contour-label", type: "symbol", source: "contours", minzoom: 13.5,
      filter: ["==", ["get", "idx"], 1],
      layout: {
        "symbol-placement": "line",
        "text-field": ["concat", ["to-string", ["get", "elev"]], "m"],
        "text-font": ["MonaS12 Regular"], "text-size": 8.4, "symbol-spacing": 300,
      },
      paint: { "text-color": cc.label, "text-halo-color": cc.halo, "text-halo-width": 1.4 } },
  );

  // ── 등산로(코스) 오버레이 — app.js:492-513 스펙 그대로 (casing + line, 난이도별 굵기) ──
  const tc = theme === "dark"
    ? { line: "#ffffff", casing: "#000000", faded: "#5c5c5c" }
    : { line: "#111111", casing: "#ffffff", faded: "#b8b8b8" };
  const widthExpr = ["interpolate", ["linear"], ["zoom"],
    11, ["match", ["get", "difficulty"], "초급", 1.6, "중급", 2.4, "고급", 3.4, 2.2],
    16, ["match", ["get", "difficulty"], "초급", 3.5, "중급", 5, "고급", 7, 4.5]];
  style.sources.trails = {
    type: "geojson",
    data: `${BASE}/packs/${PACK}/routes.geojson`,
  };
  // 코스 번호 배지 위치 — 코스당 중점 1개(웹 courseNoFC 대응). MapView 가 런타임에 채운다(course.mid).
  style.sources["course-nos"] = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  style.layers.push(
    { id: "trail-casing", type: "line", source: "trails",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": tc.casing,
               "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4, 16, 10] } },
    // 미선택 코스 선(선택 시 MapView 가 faded 회색으로, 미선택 상태면 tc.line 검정). app.js:542
    { id: "trail-line", type: "line", source: "trails",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": tc.line, "line-width": widthExpr } },
    // 선택 코스 강조(검정) — 회색 선 위에 얹음. 필터는 런타임(MapView.applyTrailSelection)이 선택 코스명으로. app.js:547
    { id: "trail-hl", type: "line", source: "trails",
      filter: ["==", ["get", "name"], "__none__"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": tc.line, "line-width": widthExpr } },
    // 탭 히트 확장 — 얇은 선을 손가락으로 맞추기 위한 넓은 투명선. app.js:554
    { id: "trail-hit", type: "line", source: "trails",
      paint: { "line-color": "#000000", "line-opacity": 0.001,
               "line-width": ["interpolate", ["linear"], ["zoom"], 11, 16, 16, 28] } },
    // 코스 번호 배지 — course-nos 포인트 소스(코스당 1개, 직립). 웹 course-no-badges 대응. app.js:563
    // 아이콘 badge-N(미선택)/badge-N-sel(선택)은 MapView 가 런타임 UIImage 로 등록·교체.
    { id: "course-no-badges", type: "symbol", source: "course-nos", minzoom: 10.5,
      layout: {
        "icon-image": ["concat", "badge-", ["to-string", ["coalesce", ["get", "no"], 1]]],
        "icon-allow-overlap": true, "icon-ignore-placement": true,
      } },
  );

  // ── 스팟 오버레이 (점+라벨+정상) — app.js:582-660 스펙 축약 ──
  // 편의시설(FACILITY_ICON) 아이콘 레이어는 런타임 이미지 생성이 필요 + 현재 데이터 없음 → 이월.
  // DOT_CATS=[분기점,시종점,장소], 줌 게이트는 spot-display.json 기본값(장소14·시종점12·분기점off).
  const DOT_CATS = ["분기점", "시종점", "장소"];
  // coalesce 오버라이드: 스팟별 disp_zoom 이 분류 기본 zoom 을 덮는다(app.js 동일). 분기점 기본 off(99).
  const dotZoomGate = [">=", ["zoom"],
    ["coalesce", ["get", "disp_zoom"], ["match", ["get", "category"], "장소", 14, "시종점", 12, 99]]];
  style.sources.spots = {
    type: "geojson",
    data: `${BASE}/packs/${PACK}/spots.geojson`,
  };
  style.layers.push(
    { id: "spots-dots", type: "circle", source: "spots",
      filter: ["all", ["in", ["get", "category"], ["literal", DOT_CATS]], dotZoomGate],
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.4, 16, 3.8],
               "circle-color": tc.line, "circle-stroke-color": tc.casing, "circle-stroke-width": 1.4 } },
    { id: "spots-labels", type: "symbol", source: "spots",
      filter: ["all", ["in", ["get", "category"], ["literal", DOT_CATS]], ["has", "name"], dotZoomGate],
      layout: { "text-field": ["get", "name"], "text-font": ["MonaS12 Regular"],
                "text-size": ["coalesce", ["get", "disp_size"], 11],   // disp_size 오버라이드
                "text-offset": [0, 0.9], "text-anchor": "top", "text-max-width": 8 },
      paint: { "text-color": tc.line, "text-halo-color": tc.casing, "text-halo-width": 1.4 } },
    // 정상 표식 — ▲(라이트)/△(다크) 텍스트 글리프 (런타임 이미지 불필요)
    { id: "spot-peaks", type: "symbol", source: "spots",
      filter: ["==", ["get", "category"], "정상"],
      layout: { "text-field": ["concat", theme === "dark" ? "△" : "▲", ["coalesce", ["get", "name"], ""]],
                "text-font": ["MonaS12 Regular"], "text-size": 14,
                "text-offset": [0, -0.6], "text-anchor": "bottom" },
      paint: { "text-color": tc.line, "text-halo-color": tc.casing, "text-halo-width": 1.8 } },
  );

  // ── 시종점(course-ends) — 선택 코스 지오메트리 첫/끝 점 (app.js:533-550). ──
  // 데이터는 런타임 파생이라 빈 FC 로 두고, 코스 선택 시 MapView 가 source.shape 로 채운다.
  style.sources["course-ends"] = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  // 보물지도 기호 — 시작:속 빈 동그라미(○), 끝:굵은 X("X marks the spot")
  style.layers.push(
    { id: "course-ends-dots", type: "circle", source: "course-ends",
      filter: ["==", ["get", "kind"], "start"],
      paint: { "circle-radius": 6.5,
               "circle-color": tc.casing,            // 속 빈 링(배경색 채움)
               "circle-stroke-color": tc.line,
               "circle-stroke-width": 2.5 } },
    { id: "course-ends-x", type: "symbol", source: "course-ends",
      filter: ["==", ["get", "kind"], "end"],
      layout: { "text-field": "X", "text-font": ["MonaS12 Bold"],
                "text-size": 20, "text-anchor": "center",
                "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": tc.line, "text-halo-color": tc.casing, "text-halo-width": 2 } },
  );

  // ── 등반 중 "앞으로 갈 루트" — 선택 코스를 회색 점선(검정 테두리)으로. ──
  // 지나온 길은 아래 climb-track(검정 실선)이 이 위에 덮여 자연스럽게 구분된다(그래서 순서상 먼저).
  // dasharray 단위가 선폭 배수라 두 겹의 대시 길이를 맞추려면 폭에 반비례 스케일 → 고정폭 사용.
  // 필터는 런타임(MapView.applyTrailSelection)이 등반 중 선택 코스명으로 지정한다.
  style.layers.push(
    { id: "climb-route-casing", type: "line", source: "trails",
      filter: ["==", ["get", "name"], "__none__"],
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": tc.line, "line-width": 7, "line-dasharray": [1.03, 0.926] } },
    { id: "climb-route", type: "line", source: "trails",
      filter: ["==", ["get", "name"], "__none__"],
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": tc.faded, "line-width": 3.6, "line-dasharray": [2, 1.8] } },
  );

  // ── 기록 루트 보기 — 저장된 기록 트랙(점선). app.js:554-566. ──
  // 빈 FC 로 두고, 기록 탭에서 루트를 탭하면 MapView 가 source.shape 로 채운다.
  style.sources["rec-track"] = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  style.layers.push(
    { id: "rec-track-casing", type: "line", source: "rec-track",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": tc.casing, "line-width": 6 } },
    { id: "rec-track", type: "line", source: "rec-track",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": tc.line, "line-width": 2.6, "line-dasharray": [0.1, 1.8] } },
  );

  // ── 등반 중 라이브 트랙(지나온 곳) — app.js:566-578. ──
  // 빈 FC 로 두고, 등반 세션의 GPS 갱신마다 MapView 가 source.shape 로 채운다(본선색).
  style.sources["climb-track"] = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  style.layers.push(
    { id: "climb-track-casing", type: "line", source: "climb-track",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": tc.casing, "line-width": 6.5 } },
    { id: "climb-track", type: "line", source: "climb-track",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": tc.line, "line-width": 3.4 } },
  );

  // ── 등반 중 현재 위치 마커 — 내장 유저 dot 대신 style 레이어(줌 시 트랙과 완벽 동기). ──
  // MapView 가 트랙 마지막 점을 climb-pos 소스에 주입한다(내장 dot 은 등반 중 숨김).
  style.sources["climb-pos"] = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  style.layers.push(
    { id: "climb-pos-ring", type: "circle", source: "climb-pos",
      paint: { "circle-radius": 8.5, "circle-color": tc.casing,
               "circle-stroke-color": tc.line, "circle-stroke-width": 2.5 } },
    { id: "climb-pos-dot", type: "circle", source: "climb-pos",
      paint: { "circle-radius": 4.5, "circle-color": tc.line } },
  );

  return JSON.stringify(style, null, 2);
}

// 테마 2 × 모드 2 = 4벌. 지형 전용은 접미사 없음(기본), OSM 은 "-osm".
// 앱(ExploreView)이 scheme·baseMode 로 basemap-{theme}[-osm].json 리소스를 고른다.
for (const theme of ["light", "dark"]) {
  for (const mode of ["terrain", "osm"]) {
    const suffix = mode === "osm" ? "-osm" : "";
    const file = new URL(`basemap-${theme}${suffix}.json`, OUT);
    writeFileSync(file, make(theme, mode));
    console.log("wrote", file.pathname);
  }
}
