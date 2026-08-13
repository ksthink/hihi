// buildStyle() (웹과 동일 소스) → 네이티브 번들용 스타일 JSON 2종 생성.
// 웹은 same-origin 상대경로를 쓰지만 네이티브는 절대 URL 이 필요하므로,
// pmtiles/글리프 URL 을 맥 admin_server 프록시(http://localhost:8890)로 절대화한다.
//
//   실행:  cd ios && node gen-style.mjs
//   산출:  HiHeight/Resources/basemap-light.json, basemap-dark.json (gitignore — 재생성)
//
// 계약(§8-2): 스타일 로직의 단일 출처는 basemap-style.js. 이 스크립트는 URL 절대화만 한다.
import { buildStyle, symChar } from "../basemap-style.js";
import { writeFileSync, mkdirSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// 타일·팩 소스 절대 URL 베이스 — R2 커스텀 도메인 직결(§8-1). dev/로컬은 env 로 오버라이드.
const BASE = process.env.HIHEIGHT_BASE || "https://hihi.metaphr.dev";
const OUT = new URL("./HiHeight/Resources/", import.meta.url);
mkdirSync(OUT, { recursive: true });

// 지도 글리프 pbf 를 번들 리소스로 복사(../fonts/<fontstack>/ → Resources/glyphs/<fontstack>/).
// 소스는 fonts/ 에 커밋돼 있고 이 복사본은 gitignore(중복 방지). project.yml 이 type:folder 로 번들.
//
// ⚠️ 용량 최적화 여지 (2026-07-20 정밀 분석, 지금은 의도적으로 미적용)
//   글리프 44MB = 앱 설치크기 58MB 의 76%. 두 가지 낭비가 확인됨:
//   1) Bold 16.5MB 를 **어느 레이어도 쓰지 않는다**(생성된 스타일 4종 전부 0건).
//      한때 시종점 X 마커가 유일한 Bold 사용처였으나 출발/도착 텍스트로 되돌리면서
//      그마저 사라졌다. 웹은 이 라벨에 Bold 를 쓰지만 한글은 localIdeographFontFamily
//      가 기기 폰트로 그리므로 글리프가 필요 없다. → Bold 를 통째로 빼면 -16.5MB.
//   2) Regular 의 가나·키릴·아랍 등 -2.6MB 도 렌더 대상이 아니다. 기저지도 MVT 에
//      name:ja/name:zh 가 들어 있지만 스타일이 읽는 키는 name:ko / name 뿐이다.
//      (전국 104개 타일 표본에서 렌더 문자는 한글 664종·ASCII 69종·한자 3종(道林里)뿐)
//   미적용 이유: 압축 전송되므로 **다운로드는 9.7MB→7.8MB 로 1.9MB 밖에 안 준다**
//   (pbf 압축률이 매우 높음). 얻는 건 기기 설치 19MB 절감뿐인데 오프라인 팩이 그보다
//   크고, 실수하면 희귀 한자 지명이 □ 로 조용히 깨진다. 손익이 맞지 않아 보류.
//   착수 적기: poi-display 볼드 설정 반영 작업 / 용량 민원 발생 / App Store 정식 출시.
const ROOT = fileURLToPath(new URL("../", import.meta.url));   // 저장소 루트(ios/ 의 상위)
const RES = fileURLToPath(OUT);
// 글리프 폴더는 **공백 없는 이름**으로 번들한다(MonaS12Regular). fontstack 에 공백이 있으면
// file:// 글리프 URL 이 깨질 수 있다. 스타일의 text-font 도 아래에서 공백 없는 이름으로 바꾼다.
// (⚠️ 글리프 URL 은 MapView.runtimeStyle 이 런타임에 번들 절대 file:// 로 재작성한다 — 상대경로는
//  MapLibre Native 가 resolve 못 해 "unsupported URL"로 라벨이 통째로 안 그려진다, 2026-07-25.)
const GLYPH_STACKS = [["MonaS12 Regular", "MonaS12Regular"], ["MonaS12 Bold", "MonaS12Bold"]];
for (const [src, dst] of GLYPH_STACKS) {
  cpSync(join(ROOT, "fonts", src), join(RES, "glyphs", dst), { recursive: true });
}

// ── 관리자 표시 설정 (R2 config/*.json) — 웹과 같은 소스를 빌드 시점에 구워 넣는다. ──
// 웹은 이 설정을 런타임에 fetch 하지만, 네이티브 스타일은 빌드 산출물이라 여기서 한 번
// 읽어 반영한다. 따라서 각 빌드가 그 시점의 관리자 설정과 일치한다.
//   ⚠️ 관리자에서 설정을 바꾸면 재빌드·재배포해야 앱에 반영된다(네이티브의 다른 모든
//      빌드 산출물과 동일). 실시간 반영이 필요하면 런타임 fetch 로 전환해야 한다.
// 스팟 분류 기본값 — fetch 실패(오프라인 빌드) 시 폴백. admin_server SPOT_DISPLAY_DEFAULT 와 일치.
const SPOT_DEFAULT = {
  정상: { zoom: 0, icon: true, size: 14, bold: true },
  장소: { zoom: 14, icon: true, size: 8, bold: false },
  조망점: { zoom: 18, icon: true, size: 8, bold: false },
  화장실: { zoom: 18, icon: true, size: 8, bold: false },
  정자: { zoom: 18, icon: true, size: 8, bold: false },
  헬기장: { zoom: 18, icon: true, size: 8, bold: false },
  음수대: { zoom: 18, icon: true, size: 8, bold: false },
  주차장: { zoom: null, icon: true, size: 8, bold: false },
  분기점: { zoom: null, icon: true, size: 8, bold: false },
  시종점: { zoom: null, icon: true, size: 8, bold: false },
};
async function fetchCfg(name) {
  try {
    const r = await fetch(`${BASE}/config/${name}`, { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!j?.categories) throw new Error("no categories");
    console.log(`config: ${name} 반영`);
    return j.categories;
  } catch (e) {
    console.warn(`config: ${name} 실패(${e.message}) — 기본값 사용`);
    return null;
  }
}
const poiCfg = await fetchCfg("poi-display.json");                 // null → buildStyle 이 기본값
const spotRaw = await fetchCfg("spot-display.json");
// 누락 분류는 기본값으로 채워 항상 완전 객체 (웹 normSpotDisplay 대응)
const spotCfg = Object.fromEntries(Object.keys(SPOT_DEFAULT)
  .map((c) => [c, { ...SPOT_DEFAULT[c], ...(spotRaw?.[c] || {}) }]));

// ── 스팟 GL 표현식 (app.js 310-323 미러) — 우선순위: 스팟별 오버라이드(disp_*) > 분류 전역 ──
const SPOT_FONT = (b) => [b ? "MonaS12 Bold" : "MonaS12 Regular"];
const spotZoomGate = (cats) => [">=", ["zoom"], ["coalesce", ["get", "disp_zoom"],
  ["match", ["get", "category"], ...cats.flatMap((c) => [c, spotCfg[c].zoom ?? 99]), 99]]];
const spotSize = (cats) => ["coalesce", ["get", "disp_size"],
  ["match", ["get", "category"], ...cats.flatMap((c) => [c, spotCfg[c].size]), 8.9]];
const spotFont = (cats) => ["match", ["to-string", ["get", "disp_bold"]],
  "true", ["literal", SPOT_FONT(true)], "false", ["literal", SPOT_FONT(false)],
  ["match", ["get", "category"], ...cats.flatMap((c) => [c, ["literal", SPOT_FONT(spotCfg[c].bold)]]),
    ["literal", SPOT_FONT(false)]]];
const spotIconGate = (cats) => ["to-boolean", ["coalesce", ["get", "disp_icon"],
  ["match", ["get", "category"], ...cats.flatMap((c) => [c, spotCfg[c].icon]), false]]];

function make(theme, baseMode) {
  const style = buildStyle(
    `${BASE}/kr-base.pmtiles`,        // R2 버킷 루트에 객체 존재(프록시의 /pmtiles/ 접두사 없음)
    theme,
    `${BASE}/kr-terrain.pmtiles`,
    // R2 config/poi-display.json (위에서 fetch). null 이면 buildStyle 이 기본값 사용.
    //   Bold 참고: 전철역 등 bold:true 분류는 MonaS12 Bold 를 쓴다. Bold 글리프는 번들에
    //   포함(위 cpSync)되므로 안전하다. Bold 글리프를 줄이려면 그 전에 "Bold 실사용 시 빌드
    //   실패" 가드를 넣을 것(위 글리프 주석 참조).
    poiCfg,
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
  // 두께는 난이도와 무관하게 통일한다(2026-07-29). 예전에는 난이도별로 굵기를 나눴는데
  // (초급 1.6/3.5 · 중급 2.4/5 · 고급 3.4/7 · 기본 2.2/4.5), 산 대부분이 초급 단일 코스라
  // "난이도 인코딩"으로 읽히지 않고 "산마다 두께가 제각각"으로만 체감됐다.
  // 값은 가장 굵던 고급 기준 — 얇은 선은 손가락·야외 시인성에서 불리하다.
  // (난이도는 등반 카드의 3막대 미터와 코스 목록 배지가 표시한다.)
  const widthExpr = ["interpolate", ["linear"], ["zoom"], 11, 3.4, 16, 7];
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

  // ── 스팟 오버레이 (점+라벨+편의시설+정상) — app.js:579-651 미러 ──
  // 분류별 노출 줌·크기·기호·볼드는 R2 config/spot-display.json(위 spotCfg)이 관리한다.
  // 스팟별 오버라이드(disp_zoom·disp_size·disp_icon·disp_bold)는 팩 properties 로 와서
  // 위 표현식(spotZoomGate 등)이 coalesce/match 로 분류 전역보다 우선 반영한다.
  const DOT_CATS = ["분기점", "시종점", "장소"];
  // 편의시설 — 아이콘 이미지는 MapView.registerPOIIcons 가 런타임 등록(이름 웹과 동일).
  const FACILITY_ICON = {
    조망점: "poi-viewpoint", 화장실: "poi-toilets", 정자: "poi-shelter",
    헬기장: "poi-helipad", 음수대: "poi-drinking_water", 주차장: "poi-parking",
  };
  const FAC_CATS = Object.keys(FACILITY_ICON);
  const pk = spotCfg["정상"];
  // 정상 크기 — 주봉=설정값, 부봉(main:false)=11/14.4 축소, 스팟별 disp_size 최우선.
  const peakSize = ["coalesce", ["get", "disp_size"],
    ["case", ["==", ["get", "main"], false],
      Math.round(pk.size * (11 / 14.4) * 10) / 10, pk.size]];
  style.sources.spots = {
    type: "geojson",
    data: `${BASE}/packs/${PACK}/spots.geojson`,
  };
  style.layers.push(
    // 점(분기점·시종점·장소) — 기호(점) on/off + 노출 줌 게이트
    { id: "spots-dots", type: "circle", source: "spots",
      filter: ["all", ["in", ["get", "category"], ["literal", DOT_CATS]],
               spotIconGate(DOT_CATS), spotZoomGate(DOT_CATS)],
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.4, 16, 3.8],
               "circle-color": tc.line, "circle-stroke-color": tc.casing, "circle-stroke-width": 1.4 } },
    { id: "spots-labels", type: "symbol", source: "spots",
      filter: ["all", ["in", ["get", "category"], ["literal", DOT_CATS]], ["has", "name"],
               spotZoomGate(DOT_CATS)],
      layout: { "text-field": ["get", "name"], "text-font": spotFont(DOT_CATS),
                "text-size": spotSize(DOT_CATS),
                "text-offset": [0, 0.9], "text-anchor": "top", "text-max-width": 8 },
      paint: { "text-color": tc.line, "text-halo-color": tc.casing, "text-halo-width": 1.4 } },
    // 편의시설(조망점·화장실·정자·헬기장·음수대·주차장) — 기호 on 이면 아이콘, 아니면 이름만.
    { id: "spots-facilities", type: "symbol", source: "spots",
      filter: ["all", ["in", ["get", "category"], ["literal", FAC_CATS]], spotZoomGate(FAC_CATS)],
      layout: {
        "icon-image": ["case", spotIconGate(FAC_CATS),
          ["match", ["get", "category"], ...Object.entries(FACILITY_ICON).flat(), ""], ""],
        "icon-optional": true, "text-optional": true,
        "text-field": ["coalesce", ["get", "name"], ""],
        "text-font": spotFont(FAC_CATS),
        "text-size": spotSize(FAC_CATS),
        "text-offset": [0, 1.05], "text-anchor": "top", "text-max-width": 8,
      },
      paint: { "text-color": tc.line, "text-halo-color": tc.casing, "text-halo-width": 1.4 } },
    // 정상 — ▲ 마크는 **좌표에 고정**(중앙 앵커), 이름은 그 위로 분리(웹 app.js 동일 구조).
    // 예전엔 "▲+이름" 한 텍스트라 앵커(문자열 가운데-아래) 기준으로 ▲가 픽셀 단위로 비껴,
    // 줌마다 지상 오프셋이 달라져 마커가 미끄러져 보였다(2026-07-26 용왕산).
    // 부봉(main:false)은 주봉 대비 11/14.4 축소. disp_size 최우선.
    { id: "spot-peak-marks", type: "symbol", source: "spots",
      filter: ["all", ["==", ["get", "category"], "정상"],
               ["to-boolean", ["coalesce", ["get", "disp_icon"], pk.icon]],
               [">=", ["zoom"], ["coalesce", ["get", "disp_zoom"], pk.zoom ?? 99]]],
      layout: {
        "text-field": symChar(pk.icon) ?? (theme === "dark" ? "△" : "▲"),
        "text-font": spotFont(["정상"]),
        "text-size": peakSize,
        "text-allow-overlap": true, "text-ignore-placement": true,   // 마크 = 핀, 충돌로 안 사라지게
        "text-anchor": "center", "text-offset": [0, 0] },
      paint: { "text-color": tc.line, "text-halo-color": tc.casing, "text-halo-width": 1.8 } },
    { id: "spot-peaks", type: "symbol", source: "spots",
      filter: ["all", ["==", ["get", "category"], "정상"],
               [">=", ["zoom"], ["coalesce", ["get", "disp_zoom"], pk.zoom ?? 99]]],
      layout: {
        "text-field": ["coalesce", ["get", "name"], ""],
        "text-font": spotFont(["정상"]),
        "text-size": peakSize,
        "text-offset": [0, -0.75], "text-anchor": "bottom" },   // 마크 바로 위
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
      layout: { "text-field": ["get", "label"], "text-font": ["MonaS12 Regular"],
                "text-size": 12, "text-offset": [0, 1.1], "text-anchor": "top" },
      paint: { "text-color": tc.line, "text-halo-color": tc.casing, "text-halo-width": 1.6 } },
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
  // 내가 걸었던 루트 — 굵은 실선(정규 코스 점 점선과 구분).
  style.layers.push(
    { id: "rec-track-casing", type: "line", source: "rec-track",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": tc.casing, "line-width": 9.6 } },
    { id: "rec-track", type: "line", source: "rec-track",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": tc.line, "line-width": 6.8 } },
  );
  // ── 루트 보기 정규 코스 — 원형 점(dot) 점선. 걸었던 루트(실선) 위에 얹어 비교. ──
  // 기본 숨김, MapView 토글이 켠다(round cap + 짧은 대시 = 원 나열. 탐험 trail-* 는 그대로).
  style.layers.push(
    { id: "route-trails-casing", type: "line", source: "trails",
      layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
      paint: { "line-color": tc.casing, "line-width": 9.6 } },
    { id: "route-trails", type: "line", source: "trails",
      layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
      paint: { "line-color": tc.line, "line-width": 6.8, "line-dasharray": [0.1, 1.8] } },
  );
  // ── 겹침 반전 구간 — 걸었던 루트 중 정규 코스와 겹치는 부분(런타임 계산·RouteOverlap). ──
  // 걸은 실선(본선색) 위에서 코스 점이 반전색 원으로 보여 "코스 위를 걸었다"가 한눈에 구분된다.
  style.sources["rec-track-inv"] = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  style.layers.push(
    { id: "rec-track-inv-casing", type: "line", source: "rec-track-inv",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": tc.line, "line-width": 9.6 } },
    { id: "rec-track-inv", type: "line", source: "rec-track-inv",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": tc.casing, "line-width": 6.8, "line-dasharray": [0.1, 1.8] } },
  );
  // 기록 트랙의 시작·도착 — 선택 코스(course-ends)와 동일한 모양. 트랙 선 위에 얹는다.
  // 빈 FC 로 두고 MapView.applyRecordTrack 이 트랙 첫/끝 점으로 채운다.
  style.sources["rec-ends"] = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  style.layers.push(
    { id: "rec-ends-dots", type: "circle", source: "rec-ends",
      paint: { "circle-radius": 5.5,
               "circle-color": ["case", ["==", ["get", "kind"], "start"], tc.line, tc.casing],
               "circle-stroke-color": ["case", ["==", ["get", "kind"], "start"], tc.casing, tc.line],
               "circle-stroke-width": 2 } },
    { id: "rec-ends-labels", type: "symbol", source: "rec-ends",
      layout: { "text-field": ["get", "label"], "text-font": ["MonaS12 Regular"],
                "text-size": 12, "text-offset": [0, 1.1], "text-anchor": "top" },
      paint: { "text-color": tc.line, "text-halo-color": tc.casing, "text-halo-width": 1.6 } },
  );
  // 고도 프로필에서 고른 지점 — 루트 위 강조 마커(비어 있음, MapView.setRouteCursor 가 채움). 시종점 위에 얹는다.
  style.sources["rec-cursor"] = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  style.layers.push(
    { id: "rec-cursor", type: "circle", source: "rec-cursor",
      paint: { "circle-radius": 6.5, "circle-color": tc.casing,
               "circle-stroke-color": tc.line, "circle-stroke-width": 3 } },
  );

  // ── 대기질 측정소 — 지금 값을 준 **한 곳만**. (웹 app.js showAirStation) ──
  // 전국 673곳을 다 깔면 등산 지도가 아니게 된다. 하나면 "이 값이 어디서 왔나"라는
  // 실제 궁금증만 해결한다 — 산에서 20km 떨어진 측정소일 수도 있어 거리 숫자만으론 부족하다.
  // 비어 있고, ExploreView 가 받은 좌표를 MapView 가 채운다.
  style.sources["air-station"] = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  style.layers.push(
    { id: "air-station", type: "circle", source: "air-station",
      paint: { "circle-radius": 9, "circle-color": tc.casing,
               "circle-stroke-color": tc.line, "circle-stroke-width": 1.8 } },
    { id: "air-station-mark", type: "symbol", source: "air-station",
      // ⚠️ 기호는 **번들 글리프에 있는 문자만** 쓸 수 있다. ㎛(U+339B)는 MonaS12 에 없어
      //    두부가 된다 — ㎍(U+338D)는 있고, ㎍/㎥ 라는 단위와도 맞는다.
      layout: { "text-field": "㎍", "text-font": ["MonaS12 Bold"], "text-size": 9,
                "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": tc.line } },
    { id: "air-station-label", type: "symbol", source: "air-station",
      layout: { "text-field": ["get", "label"], "text-font": ["MonaS12 Regular"],
                "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top" },
      paint: { "text-color": tc.line, "text-halo-color": tc.casing, "text-halo-width": 1.6 } },
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
    // 그림은 런타임에 등록한다(HereIcon.image → style.setImage "here") — 웹 here-icon.js 와 같은 격자.
    // ⚠️ viewport 정렬 — 나침반 모드에선 지도가 회전하므로, 없으면 인물이 물구나무를 선다.
    { id: "climb-pos", type: "symbol", source: "climb-pos",
      layout: { "icon-image": "here", "icon-allow-overlap": true, "icon-ignore-placement": true,
                "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport" } },
  );

  // text-font 의 폰트 스택 이름을 공백 없는 이름으로(위 글리프 폴더명과 일치). 네이티브 전용.
  return JSON.stringify(style, null, 2)
    .replaceAll("MonaS12 Regular", "MonaS12Regular")
    .replaceAll("MonaS12 Bold", "MonaS12Bold");
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
