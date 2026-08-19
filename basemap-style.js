// Protomaps v4 벡터 스키마용 흑백(모노크롬) MapLibre 스타일.
// 등산 앱: 색상 배제 · 배터리 절약 다크 모드(순수 검정 배경).
// terrainUrl(선택): terrain-RGB PMTiles → 음영기복(hillshade). 흑백 지도의 지형 입체감 핵심.
//   오프라인 로컬 팩 열람 시엔 넘기지 않음(원격 전용) — 레이어 자체가 빠져 콘솔 오류 없음.

// ── 기저지도 POI 표시 정책 (admin 에서 편집 · R2 config/poi-display.json) ──
// 값 = { zoom: 표시 시작 줌(null=끔), icon: 기호 표시, size: 글자 px, bold: 볼드 }.
// 레거시 형식(값이 숫자|null)은 normPoiDisplay 가 zoom 으로 승격시켜 하위호환.
// 도시 POI 는 들머리 접근·하산 복귀 때 위치 앵커 역할만 — 산 위 랜드마크(사찰·정자·
// 조망점)보다 시각적으로 튀지 않게 텍스트 위주로 억제한다.
// iOS 도 동일 JSON 을 소비 (데이터 주도 정책). admin_server.py 기본값과 일치 유지.
export const POI_DISPLAY_DEFAULT = {
  전철역: { zoom: 12, icon: true, size: 10, bold: false },
  버스정류장: { zoom: 14, icon: true, size: 8, bold: false },
  // 약수터 — 전국 자체 타일(kr-spring). 버스정류장과 같은 z14.
  // ⚠️ 처음엔 z15 로 뒀는데, 계양산(395m) 같은 산은 전체를 z13~14 로 보므로 **산을 보는
  //    동안에는 끝내 안 나왔다**(2026-08-07). 표시하지 않는 것과 다름없어 한 단계 내렸다.
  약수터: { zoom: 14, icon: true, size: 8, bold: false },
  사찰: { zoom: 14, icon: true, size: 10, bold: false },
  편의시설: { zoom: 14, icon: true, size: 8, bold: false },
  학교: { zoom: 14, icon: false, size: 10, bold: false },
  관공서: { zoom: 14, icon: false, size: 10, bold: false },
  병원: { zoom: 14, icon: false, size: 10, bold: false },
  아파트단지: { zoom: 14, icon: false, size: 10, bold: false },
  공원: { zoom: 14, icon: false, size: 10, bold: false },
  "마트·쇼핑": { zoom: 15, icon: false, size: 10, bold: false },
  "문화·체육": { zoom: 15, icon: false, size: 10, bold: false },
};

// 설정 정규화: 카테고리 누락·레거시 숫자값을 기본값 위에 병합해 항상 완전한 객체로.
export function normPoiDisplay(raw) {
  const out = {};
  for (const [k, def] of Object.entries(POI_DISPLAY_DEFAULT)) {
    const v = raw?.[k];
    out[k] = v === undefined ? { ...def }
      : (v === null || typeof v === "number") ? { ...def, zoom: v }
      : { ...def, ...v };
  }
  return out;
}

// 글꼴 선택 (볼드 글리프도 전 범위 자체 호스팅됨)
const FONT = (bold) => [bold ? "MonaS12 Bold" : "MonaS12 Regular"];

// POI 이름 (한글 우선)
const NAME = ["coalesce", ["get", "name:ko"], ["get", "name"]];

// ── 기호 설정 3상 ──
//   false/없음 = 기호 없음 · true = 기본 아이콘(캔버스 생성, poi-icons.js) · 문자열 = 그 글자
// 문자 기호는 스팟 정상의 "▲" 와 같은 방식 — 이름 앞에 붙여 라벨 하나로 그린다.
// ⚠️ BMP(U+0000–FFFF) 문자만 쓸 수 있다. 자체 호스팅 글리프 PBF 가 65535 에서 끝나므로
//    이모지(U+1F300~ 등)는 웹·네이티브 모두 아무 경고 없이 안 그려진다 (admin 에서 막는다).
export const symChar = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
export const useIcon = (v) => v === true;
// 이름 앞에 문자 기호를 붙인 text-field
const nameField = (v) => (symChar(v) ? ["concat", symChar(v), NAME] : NAME);

// 도시 POI(텍스트 전용 poi-urban 레이어) 카테고리 → pois kind 매핑.
// 카테고리 간 kind 중복 금지 (match 표현식 라벨 유일성).
const URBAN_KINDS = {
  학교: ["school", "university", "college"],
  관공서: ["townhall", "government", "police", "fire_station", "post_office", "courthouse"],
  병원: ["hospital"],
  아파트단지: ["residential"],
  공원: ["park", "garden"],
  "마트·쇼핑": ["supermarket", "mall", "department_store", "marketplace"],
  "문화·체육": ["museum", "library", "stadium", "arts_centre", "theatre", "sports_centre"],
};

// `paths` 레이어에서 **등산로가 아닌 것**. Protomaps 는 인도·횡단보도·자전거도로를
// 등산로와 같은 kind("path")로 묶어 보내므로, kind_detail 로 갈라야 구분된다.
// 실측(2026-08-19): 한성대입구역 z14 타일의 path 48개 중 등산로(path/path)는 3개뿐이고
// 나머지는 인도 19·계단 10·footway 6·보행자도로 5·자전거 3·횡단보도 2 였다. 반대로
// 북한산 z14 타일은 path 12개가 전부 등산로·계단이고 아래 목록은 **하나도 없다** —
// 그래서 이 분리는 산 화면을 픽셀 하나 바꾸지 않는다.
const CITY_PATH = ["sidewalk", "crossing", "cycleway", "pedestrian"];

// 전국 버스정류장 자체 타일 URL — 기저(kr-base) 경로에서 파일명만 치환해 파생.
// 로컬 팩 기저("local-<산코드>" 등)는 해당 없음 → null (소스·레이어 모두 생략).
const BUS_URL = (base) =>
  /kr-base\.pmtiles$/.test(base) ? base.replace(/kr-base\.pmtiles$/, "kr-bus.pmtiles") : null;

// 전국 약수터 자체 타일 URL — 버스와 같은 방식(기저 경로에서 파일명 치환).
// 산림청 등산로 스팟의 "음수대" 834개(scripts/build_spring_tiles.py).
const SPRING_URL = (base) =>
  /kr-base\.pmtiles$/.test(base) ? base.replace(/kr-base\.pmtiles$/, "kr-spring.pmtiles") : null;

// baseMode: "terrain"(기본) = 지형 전용 — OSM 벡터 채움/도시POI/건물/경계를 걷어내고
//   배경 + 음영기복 + 최소 오리엔테이션(물길·이름, 얇은 도로, 지명·사찰 라벨, 등산 편의시설)만.
//   저데이터·저배터리 취지: 드로우콜을 줄이고 지형(음영+등고선)을 주 정보로 읽게 한다.
//   "osm" = 종전 전체 basemap (들머리 접근 등 도로 맥락 필요 시 토글).
export function buildStyle(pmtilesUrl, theme = "light", terrainUrl = null, poiDisplay = null, baseMode = "terrain") {
  // 카테고리 설정 (정규화 완료 형태). 설정 변경 반영 = buildStyle 재호출(setStyle).
  const P = normPoiDisplay(poiDisplay);
  // 도시 POI(poi-urban) — 켜진 카테고리 중 최저 줌이 레이어 minzoom, 나머지는 필터 게이트
  const urbanZooms = Object.keys(URBAN_KINDS).map((c) => P[c].zoom ?? 99);
  const urbanMin = Math.min(...urbanZooms);
  const dark = theme === "dark";
  const terrain = baseMode === "terrain";
  // 음영기복 사용 여부. 2026-07-22 얼룩 폴리곤을 쫓다 잠시 껐다가 되돌림 —
  // 원인은 음영이 아니라 water fill 이 하천 중심선까지 채우던 것이었다(아래 water 레이어).
  // 흑백 지도에서 능선·계곡을 읽게 하는 유일한 층이라 유지한다. 끄려면 false.
  const HILLSHADE = true;
  const useTerrainRaster = HILLSHADE && !!terrainUrl;
  // 흑백 가독성 원칙: 색이 없으므로 "명도 계단"이 유일한 분리 수단.
  // 지표 클래스마다 뚜렷한 밝기 단계를 배정 — 라이트: 시가지(밝음) > 풀 > 공원 > 물(어두움).
  // 산지·지형 표현은 hillshade(음영기복)가 전담한다. OSM 숲 폴리곤은 한국에서 경계가
  // 조악하고 줌별 일반화로 형태가 널뛰어 지형과 무관한 얼룩으로 보임 → 표시하지 않음.
  const C = dark
    ? {
        bg: "#000000", earth: "#0d0d0d", grass: "#131313",
        park: "#232323", water: "#303030", roadCasing: "#000000", road: "#424242",
        hw: "#585858", path: "#a3a3a3", building: "#171717", boundary: "#4a4a4a",
        // 케이싱 없는 이면도로 · 도심 인도류 — 아래 CITY_PATH 주석 참조
        roadMinor: "#424242", pathCity: "#4d4d4d",
        label: "#d9d9d9", halo: "#000000",
        // 지형 전용 도로선(케이싱 없이 단선) — 검정 배경 위 은은한 회색 오리엔테이션
        troad: "#3a3a3a", troadHw: "#4f4f4f"
      }
    : {
        bg: "#ffffff", earth: "#f4f4f4", grass: "#ececec",
        park: "#e3e3e3", water: "#c9c9c9", roadCasing: "#c2c2c2", road: "#ffffff",
        hw: "#e0e0e0", path: "#3f3f3f", building: "#e4e4e4", boundary: "#b5b5b5",
        // 케이싱 없는 이면도로 · 도심 인도류 — 아래 CITY_PATH 주석 참조
        roadMinor: "#dadada", pathCity: "#cfcfcf",
        label: "#2b2b2b", halo: "#ffffff",
        // 지형 전용 도로선(케이싱 없이 단선) — 흰 배경 위 은은한 회색 오리엔테이션
        troad: "#d0d0d0", troadHw: "#bcbcbc"
      };

  // 지형 전용에서 제거하는 OSM 벡터 레이어 — 채움(earth/landcover/landuse)·건물·경계·
  // 도시POI·도로 케이싱·부가 라벨. 남기는 것: 음영·물(면+선+이름)·얇은 도로·등산로(paths)·
  // 편의시설(화장실·식수·주차·안내)·사찰·동네/지명 라벨. (등고선·루트·스팟은 app.js 오버레이)
  // POI 류(전철역·버스정류장·도시 POI·지명 라벨)는 지형 모드에서도 표시한다 —
  // "기저지도 POI 는 지도 전체에서 보이게" (2026-08-02 결정). 끄기는 표시 설정(zoom=끔)으로.
  const TERRAIN_DROP = new Set([
    "earth", "landcover-grass", "landuse-park", "landuse-farm", "roads-casing",
    "rail", "buildings", "boundaries"
  ]);
  const dropTerrain = (arr) => terrain ? arr.filter((l) => !TERRAIN_DROP.has(l.id)) : arr;

  return {
    version: 8,
    // 자체 호스팅 글리프(same-origin 정적, fonts/MonaS12 {Regular,Bold}/*.pbf — fontnik SDF).
    // 웹은 한글/CJK 를 localIdeographFontFamily(MonaS12)로 기기 렌더, PBF 는 라틴·기호에 사용.
    // 네이티브(localIdeograph 없음)는 한글까지 PBF 글리프로 렌더 → PBF 전 BMP 범위 생성.
    glyphs: "/fonts/{fontstack}/{range}.pbf",
    sources: {
      protomaps: {
        type: "vector",
        url: "pmtiles://" + pmtilesUrl,
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>'
      },
      // 전국 버스정류장 자체 타일(kr-bus, 공공데이터) — 기저 소스와 같은 위치에서 파일명만
      // 치환해 파생(웹 프록시·R2 직결 모두 성립). 로컬 팩 기저(오프라인)에는 없음 → 소스 생략.
      ...(BUS_URL(pmtilesUrl) ? {
        bus: { type: "vector", url: "pmtiles://" + BUS_URL(pmtilesUrl) }
      } : {}),
      // 전국 약수터 자체 타일(kr-spring, 산림청 등산로 스팟) — 버스와 같은 파생 규칙.
      ...(SPRING_URL(pmtilesUrl) ? {
        spring: { type: "vector", url: "pmtiles://" + SPRING_URL(pmtilesUrl) }
      } : {}),
      ...(useTerrainRaster ? {
        dem: {
          type: "raster-dem", url: "pmtiles://" + terrainUrl,
          encoding: "mapbox", tileSize: 256, maxzoom: 12,
          attribution: '© <a href="https://spacedata.copernicus.eu">Copernicus DEM</a>'
        }
      } : {})
    },
    layers: dropTerrain([
      { id: "background", type: "background", paint: { "background-color": C.bg } },
      { id: "earth", type: "fill", source: "protomaps", "source-layer": "earth", paint: { "fill-color": C.earth } },
      {
        id: "landcover-grass", type: "fill", source: "protomaps", "source-layer": "landcover",
        filter: ["in", "kind", "grassland", "farmland", "barren"],
        paint: { "fill-color": C.grass }
      },
      {
        // 공원 채움은 z13+ 근거리 전용 (동네 공원 참고용).
        // 이 타일셋은 국립공원 같은 대형 보호구역도 kind=park 라, 중·저줌에 켜면
        // 산 전체를 덮는 연회색 폴리곤이 줌별 일반화로 형태가 널뛰며 얼룩처럼 보인다
        // (지형 표현은 hillshade 전담). 불투명 유지 — 반투명이면 겹침 알파가 누적됨.
        id: "landuse-park", type: "fill", source: "protomaps", "source-layer": "landuse",
        minzoom: 13,
        filter: ["in", "kind", "park", "national_park", "nature_reserve", "recreation_ground"],
        paint: { "fill-color": C.park }
      },
      {
        id: "landuse-farm", type: "fill", source: "protomaps", "source-layer": "landuse",
        filter: ["in", "kind", "farmland", "grass", "orchard"],
        paint: { "fill-color": C.grass }
      },
      // 음영기복 — 지표 채움 위, 물·선·라벨 아래. 흑백에서 능선·계곡을 입체로 읽게 하는 층.
      // ⚠️ maxzoom 14 = DEM 오버줌 한계선 (2026-07-23).
      //   DEM 은 30m·타일 z12 까지다. 그 이상은 없는 정보를 늘려 그리는 것이라 원래도
      //   뭉개졌지만, **MapLibre Native 에서는 오버줌 구간에 타일 경계를 따라 직선 이음매**
      //   가 생긴다(한쪽만 하이라이트가 덧칠돼 뿌옇게 씻긴 모양). 지리적으로 고정되고,
      //   어느 지역에서나, 500m 이하로 확대할 때만 나타나며, 웹(GL JS)에서는 안 보인다
      //   — 두 렌더러의 raster-dem 오버줌 처리 차이. 그래서 오버줌 전에 끊는다.
      //   z12(원본 해상도)까지 온전히 쓰고 z14 에서 0 으로 사라진다. 접근 축척(3km~1km)의
      //   지형감은 유지되고, 근접 축척은 어차피 DEM 정보가 없으므로 등고선이 대신한다.
      ...(useTerrainRaster ? [{
        id: "hillshade", type: "hillshade", source: "dem", maxzoom: 14,
        // 색은 2026-07-20 이전 원본 그대로(얼룩을 쫓다 두 차례 약화시켰던 것을 되돌림).
        paint: dark
          ? { "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 12, 0.4, 13, 0.28, 14, 0],
              "hillshade-shadow-color": "#000000",
              "hillshade-highlight-color": "#3d3d3d", "hillshade-accent-color": "#000000" }
          : { "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 12, 0.35, 13, 0.24, 14, 0],
              "hillshade-shadow-color": "#6e6e6e",
              "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#909090" }
      }] : []),
      {
        // ⚠️ "얼룩 폴리곤"의 진짜 원인 (2026-07-10 최초 보고 → 07-22 규명).
        // water 소스레이어에는 면뿐 아니라 **하천 중심선(LineString)과 점이 섞여 있다**
        // (실측 z12~14: 면 32 · 선 52 · 점 4). 기하 타입을 가리지 않으면 fill 레이어가
        // 열린 선을 삼각분할해 지도 곳곳에 쐐기·삼각형 얼룩이 생긴다. 줌마다 선의
        // 단순화 결과가 달라져 얼룩 모양도 바뀌던 것이 이 때문.
        // 하천 선 표현은 아래 rivers 레이어(physical_line)가 이미 담당한다.
        id: "water", type: "fill", source: "protomaps", "source-layer": "water",
        filter: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
        paint: { "fill-color": C.water }
      },
      {
        id: "rivers", type: "line", source: "protomaps", "source-layer": "physical_line",
        filter: ["in", "kind", "river", "stream"],
        // 산행에서 계곡·하천은 주요 지형 단서 — 굵기를 한 단계 올려 존재감 부여
        paint: { "line-color": C.water, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 16, 3.2] }
      },
      {
        id: "roads-casing", type: "line", source: "protomaps", "source-layer": "roads",
        filter: ["in", "kind", "highway", "major_road", "medium_road"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": C.roadCasing, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 16, 8] }
      },
      {
        id: "roads", type: "line", source: "protomaps", "source-layer": "roads",
        filter: ["in", "kind", "highway", "major_road", "medium_road", "minor_road"],
        layout: { "line-cap": "round", "line-join": "round" },
        // 지형 전용: 케이싱 레이어를 빼므로 단선이 스스로 보여야 함 — 흰 배경에 묻히는
        // C.road(흰색) 대신 은은한 회색(troad)으로, 폭도 얇게 낮춰 배경 오리엔테이션에 머문다.
        paint: {
          "line-color": terrain
            ? ["match", ["get", "kind"], "highway", C.troadHw, C.troad]
            : ["match", ["get", "kind"], "highway", C.hw, "minor_road", C.roadMinor, C.road],
          "line-width": terrain
            ? ["interpolate", ["linear"], ["zoom"], 10, 0.5, 16, 2.4]
            : ["interpolate", ["linear"], ["zoom"], 10, 0.8, 16, 5]
        }
      },
      {
        // 도심 인도류 — 등산로와 같은 굵기·명도로 그리면 도심에서 위계가 뒤집힌다.
        // 차도(minor_road)는 케이싱이 없어 옅은데 그 옆 인도가 제일 진해져, 인도가
        // 길처럼 읽히고 차도는 사라졌다(2026-08-19 사용자 보고: 버스정류장이 길에서 떨어져 보임).
        // OSM 은 인도를 차도와 별개 선으로 5~10m 옆에 그리므로 어긋남이 그대로 눈에 띈다.
        id: "paths-urban", type: "line", source: "protomaps", "source-layer": "roads",
        filter: ["all",
          ["match", ["get", "kind"], ["path", "footway", "track"], true, false],
          ["match", ["get", "kind_detail"], CITY_PATH, true, false]],
        paint: {
          "line-color": C.pathCity,
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 17, 1.3],
          "line-dasharray": [2, 2]
        }
      },
      {
        id: "paths", type: "line", source: "protomaps", "source-layer": "roads",
        // kind_detail 이 비어 있으면 등산로 쪽에 남긴다 — 산에서 길이 사라지는 쪽이 더 위험하다.
        filter: ["all",
          ["match", ["get", "kind"], ["path", "footway", "track"], true, false],
          ["match", ["get", "kind_detail"], CITY_PATH, false, true]],
        // 등산로(OSM 소로)는 이 앱의 주인공 — 더 진하고 약간 굵게 (팩 코스 선 아래 배경 맥락)
        paint: {
          "line-color": C.path,
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.9, 17, 2.6],
          "line-dasharray": [2, 2]
        }
      },
      {
        id: "rail", type: "line", source: "protomaps", "source-layer": "roads",
        minzoom: 11, filter: ["==", "kind", "rail"],
        paint: {
          "line-color": C.path,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.8, 16, 2.2],
          "line-dasharray": [5, 2]
        }
      },
      {
        id: "buildings", type: "fill", source: "protomaps", "source-layer": "buildings",
        minzoom: 14, paint: { "fill-color": C.building, "fill-opacity": 0.8 }
      },
      {
        id: "boundaries", type: "line", source: "protomaps", "source-layer": "boundaries",
        paint: { "line-color": C.boundary, "line-width": 1, "line-dasharray": [3, 2], "line-opacity": 0.7 }
      },
      // ── 라벨류 (아래 = 우선순위 낮음, places-labels 가 최상위) ──
      // 도로명 라벨(예: 대림로44길)은 그리지 않는다 — 등산앱에서 정보가치 대비 소음이
      // 커서 전 모드 제거(2026-08-02 결정). 필요해지면 이 자리에 road-names 레이어 복원.
      {
        // 계곡·하천 이름 — 등산 중 위치 확인용
        id: "water-names", type: "symbol", source: "protomaps", "source-layer": "water",
        minzoom: 13, filter: ["has", "name"],
        layout: {
          "symbol-placement": "line",
          "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
          "text-font": ["MonaS12 Regular"], "text-size": 9.2, "symbol-spacing": 350
        },
        paint: { "text-color": C.path, "text-halo-color": C.halo, "text-halo-width": 1.4 }
      },
      {
        // 도시 POI (텍스트 전용) — 들머리 접근·복귀 때 위치 앵커(학교·관공서·아파트단지 등).
        // 아이콘 없이 중간 명도 텍스트로 억제: 흑백 지도에서 등산로·산 랜드마크가 항상 우선.
        // 노출 줌은 admin poi-display 설정 + 타일 내장 중요도(min_zoom)의 이중 게이트.
        // 크기·볼드는 카테고리(kind 매핑)별 데이터 주도(match) — 레이어 하나로 충돌 풀 공유.
        id: "poi-urban", type: "symbol", source: "protomaps", "source-layer": "pois",
        minzoom: urbanMin < 99 ? urbanMin : 0,
        filter: ["all",
          ["has", "name"],
          // 카테고리 게이트: kind → 표시 시작 줌 (미지정/끔 = 99 = 안 보임)
          [">=", ["zoom"], ["match", ["get", "kind"],
            ...Object.entries(URBAN_KINDS).flatMap(([cat, kinds]) =>
              kinds.flatMap((k) => [k, P[cat].zoom ?? 99])), 99]],
          // 타일 중요도 게이트: 큰 단지(min_zoom 13)→작은 상점(15) 순 시차 노출
          [">=", ["zoom"], ["coalesce", ["get", "min_zoom"], 0]]],
        layout: {
          visibility: urbanMin < 99 ? "visible" : "none",
          // 이 레이어는 분류가 여럿이라 기호도 kind 별로 (아이콘은 원래 없는 레이어 —
          // 문자 기호가 이 분류들에 기호를 줄 수 있는 유일한 수단이다)
          "text-field": ["concat",
            ["match", ["get", "kind"],
              ...Object.entries(URBAN_KINDS).flatMap(([cat, kinds]) =>
                [kinds, symChar(P[cat].icon) ?? ""]), ""],
            NAME],
          "text-font": ["match", ["get", "kind"],
            ...Object.entries(URBAN_KINDS).flatMap(([cat, kinds]) =>
              [kinds, ["literal", FONT(P[cat].bold)]]), ["literal", FONT(false)]],
          "text-size": ["match", ["get", "kind"],
            ...Object.entries(URBAN_KINDS).flatMap(([cat, kinds]) => [kinds, P[cat].size]), 9.2],
          "text-max-width": 7,
          "text-padding": 4
        },
        paint: { "text-color": C.path, "text-halo-color": C.halo, "text-halo-width": 1.3 }
      },
      {
        // 편의시설: 아이콘 + 이름(최고줌부터, text-size step) — 한 레이어라 자기 라벨과 충돌 안 함
        id: "poi-amenities", type: "symbol", source: "protomaps", "source-layer": "pois",
        minzoom: P.편의시설.zoom ?? 0,
        filter: ["in", "kind", "toilets", "drinking_water", "parking", "information"],
        layout: {
          visibility: P.편의시설.zoom != null ? "visible" : "none",
          ...(useIcon(P.편의시설.icon) ? {
            "icon-image": ["concat", "poi-", ["get", "kind"]],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 14, 0.6, 17, 0.95],
          } : {}),
          "text-field": nameField(P.편의시설.icon),
          "text-font": FONT(P.편의시설.bold),
          // 아이콘이 있으면 이름은 설정 줌+1.5 부터(아이콘 먼저), 없으면 즉시
          "text-size": useIcon(P.편의시설.icon)
            ? ["step", ["zoom"], 0, (P.편의시설.zoom ?? 0) + 1.5, P.편의시설.size]
            : P.편의시설.size,
          ...(useIcon(P.편의시설.icon) ? { "text-offset": [0, 1.1], "text-anchor": "top" } : {}),
          "text-max-width": 8,
          "text-optional": true
        },
        paint: { "text-color": C.path, "text-halo-color": C.halo, "text-halo-width": 1.3 }
      },
      ...(BUS_URL(pmtilesUrl) ? [{
        // 버스정류장: 아이콘 + 이름(아이콘 뒤 +1 줌부터).
        // 기저(pois)에는 bus_stop 이 원천 부재(z14 아카이브·Protomaps 는 고줌 전용) →
        // 자체 전국 타일(bus 소스, scripts/build_bus_tiles.py)로 전 지역 표시.
        id: "bus-stops", type: "symbol", source: "bus", "source-layer": "stops",
        minzoom: P.버스정류장.zoom ?? 0,
        layout: {
          visibility: P.버스정류장.zoom != null ? "visible" : "none",
          ...(useIcon(P.버스정류장.icon) ? {
            "icon-image": "poi-bus_stop",
            "icon-size": ["interpolate", ["linear"], ["zoom"], 14.5, 0.55, 17, 0.9],
          } : {}),
          "text-field": nameField(P.버스정류장.icon),
          "text-font": FONT(P.버스정류장.bold),
          "text-size": useIcon(P.버스정류장.icon)
            ? ["step", ["zoom"], 0, (P.버스정류장.zoom ?? 0) + 1, P.버스정류장.size]
            : P.버스정류장.size,
          ...(useIcon(P.버스정류장.icon) ? { "text-offset": [0, 1], "text-anchor": "top" } : {}),
          "text-max-width": 9,
          "text-optional": true
        },
        paint: { "text-color": C.path, "text-halo-color": C.halo, "text-halo-width": 1.3 }
      }] : []),
      ...(SPRING_URL(pmtilesUrl) ? [{
        // 약수터: 물방울 아이콘 + 이름. 기저(pois)의 drinking_water 는 도심 음수대 위주라
        // 산속 약수터가 거의 없다 → 산림청 등산로 스팟에서 만든 자체 전국 타일로 얹는다
        // (scripts/build_spring_tiles.py · 834개). 팩 스팟과 달리 발행하지 않은 산에서도 보인다.
        id: "spring-water", type: "symbol", source: "spring", "source-layer": "springs",
        minzoom: P.약수터.zoom ?? 0,
        layout: {
          visibility: P.약수터.zoom != null ? "visible" : "none",
          ...(useIcon(P.약수터.icon) ? {
            "icon-image": "poi-drinking_water",
            "icon-size": ["interpolate", ["linear"], ["zoom"], 15, 0.6, 17, 0.95],
          } : {}),
          "text-field": nameField(P.약수터.icon),
          "text-font": FONT(P.약수터.bold),
          "text-size": useIcon(P.약수터.icon)
            ? ["step", ["zoom"], 0, (P.약수터.zoom ?? 0) + 1, P.약수터.size]
            : P.약수터.size,
          ...(useIcon(P.약수터.icon) ? { "text-offset": [0, 1], "text-anchor": "top" } : {}),
          "text-max-width": 9,
          "text-optional": true
        },
        paint: { "text-color": C.path, "text-halo-color": C.halo, "text-halo-width": 1.3 }
      }] : []),
      {
        // 사찰·암자 — 卍 아이콘 + 이름 (한국 산행 랜드마크)
        // OSM kind=place_of_worship 은 종교 통합 분류라 교회·성당까지 걸림 →
        // 한국어 라벨 휴리스틱으로 비사찰 계열 이름을 제외 (사찰은 …사/…암 등이라 안 걸림)
        id: "temple-names", type: "symbol", source: "protomaps", "source-layer": "pois",
        minzoom: P.사찰.zoom ?? 0,
        filter: ["all",
          ["==", ["get", "kind"], "place_of_worship"], ["has", "name"],
          ["!", ["any",
            ...["교회", "성당", "채플", "예배", "기도원", "교당", "모스크", "회당", "선교"]
              .map((k) => ["in", k, ["coalesce", ["get", "name:ko"], ["get", "name"], ""]])
          ]]
        ],
        layout: {
          visibility: P.사찰.zoom != null ? "visible" : "none",
          ...(useIcon(P.사찰.icon) ? {
            "icon-image": "poi-place_of_worship",
            "icon-size": ["interpolate", ["linear"], ["zoom"], 13.5, 0.6, 17, 0.9],
            "text-offset": [0, 1.1], "text-anchor": "top",
          } : {}),
          "text-field": nameField(P.사찰.icon),
          "text-font": FONT(P.사찰.bold), "text-size": P.사찰.size, "text-max-width": 8,
          "text-optional": true
        },
        paint: { "text-color": C.label, "text-halo-color": C.halo, "text-halo-width": 1.4 }
      },
      {
        // 전철역: 아이콘 + 이름(아이콘 뒤 +0.5 줌부터) — 한 레이어(자기 라벨과 충돌 방지)
        id: "stations", type: "symbol", source: "protomaps", "source-layer": "pois",
        minzoom: P.전철역.zoom ?? 0, filter: ["==", "kind", "station"],
        layout: {
          visibility: P.전철역.zoom != null ? "visible" : "none",
          ...(useIcon(P.전철역.icon) ? {
            "icon-image": "poi-station",
            "icon-size": ["interpolate", ["linear"], ["zoom"], 12, 0.7, 16, 1],
          } : {}),
          "text-field": nameField(P.전철역.icon),
          "text-font": FONT(P.전철역.bold),
          // 아이콘일 때만 이름을 반 줌 늦춘다(아이콘 먼저). 문자 기호는 라벨과 한 몸이라 즉시.
          "text-size": useIcon(P.전철역.icon)
            ? ["step", ["zoom"], 0, (P.전철역.zoom ?? 0) + 0.5, P.전철역.size]
            : P.전철역.size,
          ...(useIcon(P.전철역.icon) ? { "text-offset": [0, 1.2], "text-anchor": "top" } : {}),
          "text-max-width": 8,
          "text-optional": true
        },
        paint: { "text-color": C.label, "text-halo-color": C.halo, "text-halo-width": 1.5 }
      },
      {
        // 동네(neighbourhood/macrohood) 지명
        id: "neighbourhood-labels", type: "symbol", source: "protomaps", "source-layer": "places",
        minzoom: 12, filter: ["in", "kind", "macrohood", "neighbourhood"],
        layout: {
          "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
          "text-font": ["MonaS12 Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9.2, 16, 10.9],
          "text-max-width": 7
        },
        paint: { "text-color": C.path, "text-halo-color": C.halo, "text-halo-width": 1.5 }
      },
      {
        // 행정동 이름 (pois administrative)
        id: "admin-labels", type: "symbol", source: "protomaps", "source-layer": "pois",
        minzoom: 13, filter: ["==", "kind", "administrative"],
        layout: {
          "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
          "text-font": ["MonaS12 Regular"], "text-size": 9.2, "text-max-width": 7
        },
        paint: { "text-color": C.path, "text-halo-color": C.halo, "text-halo-width": 1.4 }
      },
      // ── 행정구역 라벨 — 줌에 따라 상위→하위 단계 노출 ──
      // 타일의 지명별 min_zoom(중요도: 서울 3 · 광역시 5~6 · 시 7~8 · 읍·면 그 이후)으로
      // 게이트: 최대 축소(z6.4)에선 특별·광역시급만, 확대할수록 하위 지명이 열린다.
      // (이 타일셋엔 도(道)·군 단위 라벨(kind region/county)이 없음 — 전부 locality.)
      // 국가명(country)·외국 성(region)은 표시하지 않음.
      {
        id: "places-labels", type: "symbol", source: "protomaps", "source-layer": "places",
        filter: ["all",
          ["==", ["get", "kind"], "locality"],
          [">=", ["zoom"], ["get", "min_zoom"]]],
        layout: {
          "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
          "text-font": ["MonaS12 Regular"],
          // 대도시(population_rank≥12)는 크게, 그 외 9.6px — 정상(주봉 14.4)이 여전히 최상위
          "text-size": ["interpolate", ["linear"], ["zoom"],
            6, ["case", [">=", ["get", "population_rank"], 12], 11, 9.6],
            12, ["case", [">=", ["get", "population_rank"], 12], 13, 9.6]],
          "text-max-width": 6
        },
        // 헤일로를 넉넉히 — 흑백에서 라벨과 선형이 겹칠 때 분리력은 헤일로가 좌우
        paint: { "text-color": C.label, "text-halo-color": C.halo, "text-halo-width": 1.8 }
      }
    ])
  };
}
