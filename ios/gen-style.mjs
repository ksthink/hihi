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
  return JSON.stringify(style, null, 2);
}

for (const theme of ["light", "dark"]) {
  const file = new URL(`basemap-${theme}.json`, OUT);
  writeFileSync(file, make(theme));
  console.log("wrote", file.pathname);
}
