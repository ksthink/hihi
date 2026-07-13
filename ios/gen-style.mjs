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

  return JSON.stringify(style, null, 2);
}

for (const theme of ["light", "dark"]) {
  const file = new URL(`basemap-${theme}.json`, OUT);
  writeFileSync(file, make(theme));
  console.log("wrote", file.pathname);
}
