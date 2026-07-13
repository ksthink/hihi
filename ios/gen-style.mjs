// buildStyle() (웹과 동일 소스) → 네이티브 번들용 스타일 JSON 2종 생성.
// 웹은 same-origin 상대경로를 쓰지만 네이티브는 절대 URL 이 필요하므로,
// pmtiles/글리프 URL 을 맥 admin_server 프록시(http://localhost:8890)로 절대화한다.
//
//   실행:  cd ios && node gen-style.mjs
//   산출:  HiHeight/Resources/basemap-light.json, basemap-dark.json (gitignore — 재생성)
//
// 계약(§8-2): 스타일 로직의 단일 출처는 basemap-style.js. 이 스크립트는 URL 절대화만 한다.
import { buildStyle } from "../basemap-style.js";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.HIHEIGHT_BASE || "http://localhost:8890";
const OUT = new URL("./HiHeight/Resources/", import.meta.url);
mkdirSync(OUT, { recursive: true });

function make(theme) {
  const style = buildStyle(
    `${BASE}/pmtiles/kr-base.pmtiles`,
    theme,
    `${BASE}/pmtiles/kr-terrain.pmtiles`,
    null, // poiDisplay 기본값 (스파이크). 본 이식에선 R2 config/poi-display.json 반영.
  );
  // 글리프: 웹의 "/fonts/{fontstack}/{range}.pbf" 상대경로 → 프록시 절대 URL.
  style.glyphs = `${BASE}/fonts/{fontstack}/{range}.pbf`;

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
    data: `${BASE}/data/packs/${PACK}/contours.geojson`,
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
        "text-font": ["Nanum Gothic Coding Regular"], "text-size": 8.4, "symbol-spacing": 300,
      },
      paint: { "text-color": cc.label, "text-halo-color": cc.halo, "text-halo-width": 1.4 } },
  );

  // ── 등산로(코스) 오버레이 — app.js:492-513 스펙 그대로 (casing + line, 난이도별 굵기) ──
  const tc = theme === "dark"
    ? { line: "#ffffff", casing: "#000000" }
    : { line: "#111111", casing: "#ffffff" };
  const widthExpr = ["interpolate", ["linear"], ["zoom"],
    11, ["match", ["get", "difficulty"], "초급", 1.6, "중급", 2.4, "고급", 3.4, 2.2],
    16, ["match", ["get", "difficulty"], "초급", 3.5, "중급", 5, "고급", 7, 4.5]];
  style.sources.trails = {
    type: "geojson",
    data: `${BASE}/data/packs/${PACK}/routes.geojson`,
  };
  style.layers.push(
    { id: "trail-casing", type: "line", source: "trails",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": tc.casing,
               "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4, 16, 10] } },
    { id: "trail-line", type: "line", source: "trails",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": tc.line, "line-width": widthExpr } },
    // 코스 번호 배지 — 라인 중앙에 항상 표시 (app.js:522 course-no-badges).
    // 아이콘 badge-N 은 MapView 가 런타임 UIImage 로 등록(makeBadge).
    { id: "course-no-badges", type: "symbol", source: "trails", minzoom: 10.5,
      layout: {
        "symbol-placement": "line-center",
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
    data: `${BASE}/data/packs/${PACK}/spots.geojson`,
  };
  style.layers.push(
    { id: "spots-dots", type: "circle", source: "spots",
      filter: ["all", ["in", ["get", "category"], ["literal", DOT_CATS]], dotZoomGate],
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.4, 16, 3.8],
               "circle-color": tc.line, "circle-stroke-color": tc.casing, "circle-stroke-width": 1.4 } },
    { id: "spots-labels", type: "symbol", source: "spots",
      filter: ["all", ["in", ["get", "category"], ["literal", DOT_CATS]], ["has", "name"], dotZoomGate],
      layout: { "text-field": ["get", "name"], "text-font": ["Nanum Gothic Coding Regular"],
                "text-size": ["coalesce", ["get", "disp_size"], 11],   // disp_size 오버라이드
                "text-offset": [0, 0.9], "text-anchor": "top", "text-max-width": 8 },
      paint: { "text-color": tc.line, "text-halo-color": tc.casing, "text-halo-width": 1.4 } },
    // 정상 표식 — ▲(라이트)/△(다크) 텍스트 글리프 (런타임 이미지 불필요)
    { id: "spot-peaks", type: "symbol", source: "spots",
      filter: ["==", ["get", "category"], "정상"],
      layout: { "text-field": ["concat", theme === "dark" ? "△" : "▲", ["coalesce", ["get", "name"], ""]],
                "text-font": ["Nanum Gothic Coding Regular"], "text-size": 14,
                "text-offset": [0, -0.6], "text-anchor": "bottom" },
      paint: { "text-color": tc.line, "text-halo-color": tc.casing, "text-halo-width": 1.8 } },
  );

  // ── 시종점(course-ends) — 선택 코스 지오메트리 첫/끝 점 (app.js:533-550). ──
  // 데이터는 런타임 파생이라 빈 FC 로 두고, 코스 선택 시 MapView 가 source.shape 로 채운다.
  style.sources["course-ends"] = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  style.layers.push(
    { id: "course-ends-dots", type: "circle", source: "course-ends",
      paint: { "circle-radius": 5.5,
               "circle-color": ["case", ["==", ["get", "kind"], "start"], tc.line, tc.casing],
               "circle-stroke-color": ["case", ["==", ["get", "kind"], "start"], tc.casing, tc.line],
               "circle-stroke-width": 2 } },
    { id: "course-ends-labels", type: "symbol", source: "course-ends",
      layout: { "text-field": ["get", "label"], "text-font": ["Nanum Gothic Coding Regular"],
                "text-size": 12, "text-offset": [0, 1.1], "text-anchor": "top" },
      paint: { "text-color": tc.line, "text-halo-color": tc.casing, "text-halo-width": 1.6 } },
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

  return JSON.stringify(style, null, 2);
}

for (const theme of ["light", "dark"]) {
  const file = new URL(`basemap-${theme}.json`, OUT);
  writeFileSync(file, make(theme));
  console.log("wrote", file.pathname);
}
