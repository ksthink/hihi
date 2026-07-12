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
  전철역: { zoom: 12, icon: true, size: 10.1, bold: false },
  버스정류장: { zoom: 14.5, icon: true, size: 8.4, bold: false },
  사찰: { zoom: 13.5, icon: true, size: 9.7, bold: false },
  편의시설: { zoom: 14, icon: true, size: 8.4, bold: false },
  학교: { zoom: 14, icon: false, size: 9.2, bold: false },
  관공서: { zoom: 14.5, icon: false, size: 9.2, bold: false },
  병원: { zoom: 13.5, icon: false, size: 9.2, bold: false },
  아파트단지: { zoom: 14, icon: false, size: 9.2, bold: false },
  공원: { zoom: 14, icon: false, size: 9.2, bold: false },
  "마트·쇼핑": { zoom: 15, icon: false, size: 9.2, bold: false },
  "문화·체육": { zoom: 15, icon: false, size: 9.2, bold: false },
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
const FONT = (bold) => [bold ? "Nanum Gothic Coding Bold" : "Nanum Gothic Coding Regular"];

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

export function buildStyle(pmtilesUrl, theme = "light", terrainUrl = null, poiDisplay = null) {
  // 카테고리 설정 (정규화 완료 형태). 설정 변경 반영 = buildStyle 재호출(setStyle).
  const P = normPoiDisplay(poiDisplay);
  // 도시 POI(poi-urban) — 켜진 카테고리 중 최저 줌이 레이어 minzoom, 나머지는 필터 게이트
  const urbanZooms = Object.keys(URBAN_KINDS).map((c) => P[c].zoom ?? 99);
  const urbanMin = Math.min(...urbanZooms);
  const dark = theme === "dark";
  // 흑백 가독성 원칙: 색이 없으므로 "명도 계단"이 유일한 분리 수단.
  // 지표 클래스마다 뚜렷한 밝기 단계를 배정 — 라이트: 시가지(밝음) > 풀 > 공원 > 물(어두움).
  // 산지·지형 표현은 hillshade(음영기복)가 전담한다. OSM 숲 폴리곤은 한국에서 경계가
  // 조악하고 줌별 일반화로 형태가 널뛰어 지형과 무관한 얼룩으로 보임 → 표시하지 않음.
  const C = dark
    ? {
        bg: "#000000", earth: "#0d0d0d", grass: "#131313",
        park: "#232323", water: "#303030", roadCasing: "#000000", road: "#424242",
        hw: "#585858", path: "#a3a3a3", building: "#171717", boundary: "#4a4a4a",
        label: "#d9d9d9", halo: "#000000"
      }
    : {
        bg: "#ffffff", earth: "#f4f4f4", grass: "#ececec",
        park: "#e3e3e3", water: "#c9c9c9", roadCasing: "#c2c2c2", road: "#ffffff",
        hw: "#e0e0e0", path: "#3f3f3f", building: "#e4e4e4", boundary: "#b5b5b5",
        label: "#2b2b2b", halo: "#ffffff"
      };

  return {
    version: 8,
    // 자체 호스팅 글리프(same-origin 정적). 한글/CJK 는 localIdeographFontFamily(Nanum)로
    // 기기/번들 폰트 렌더 → 여기엔 Nanum Gothic Coding 의 라틴·기호 범위만 필요.
    glyphs: "/fonts/{fontstack}/{range}.pbf",
    sources: {
      protomaps: {
        type: "vector",
        url: "pmtiles://" + pmtilesUrl,
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>'
      },
      ...(terrainUrl ? {
        dem: {
          type: "raster-dem", url: "pmtiles://" + terrainUrl,
          encoding: "mapbox", tileSize: 256, maxzoom: 12,
          attribution: '© <a href="https://spacedata.copernicus.eu">Copernicus DEM</a>'
        }
      } : {})
    },
    layers: [
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
      // DEM 이 30m(타일 z12까지)라 고줌에선 오버줌으로 뭉개진 얼룩이 됨 →
      // z13 부터 서서히 빼고 z16 에서 완전히 끔 (등산 줌 11~14 는 지형감 유지).
      ...(terrainUrl ? [{
        id: "hillshade", type: "hillshade", source: "dem", maxzoom: 16,
        paint: dark
          ? { "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 13, 0.4, 15, 0.18, 16, 0],
              "hillshade-shadow-color": "#000000",
              "hillshade-highlight-color": "#3d3d3d", "hillshade-accent-color": "#000000" }
          : { "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 13, 0.35, 15, 0.15, 16, 0],
              "hillshade-shadow-color": "#6e6e6e",
              "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#909090" }
      }] : []),
      { id: "water", type: "fill", source: "protomaps", "source-layer": "water", paint: { "fill-color": C.water } },
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
        paint: {
          "line-color": ["match", ["get", "kind"], "highway", C.hw, C.road],
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 16, 5]
        }
      },
      {
        id: "paths", type: "line", source: "protomaps", "source-layer": "roads",
        filter: ["in", "kind", "path", "footway", "track"],
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
      {
        // 도로명 (고줌)
        id: "road-names", type: "symbol", source: "protomaps", "source-layer": "roads",
        minzoom: 14.5, filter: ["in", "kind", "major_road", "minor_road"],
        layout: {
          "symbol-placement": "line",
          "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
          "text-font": ["Nanum Gothic Coding Regular"], "text-size": 8.9, "symbol-spacing": 400
        },
        paint: { "text-color": C.path, "text-halo-color": C.halo, "text-halo-width": 1.3 }
      },
      {
        // 계곡·하천 이름 — 등산 중 위치 확인용
        id: "water-names", type: "symbol", source: "protomaps", "source-layer": "water",
        minzoom: 13, filter: ["has", "name"],
        layout: {
          "symbol-placement": "line",
          "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
          "text-font": ["Nanum Gothic Coding Regular"], "text-size": 9.2, "symbol-spacing": 350
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
          "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
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
          ...(P.편의시설.icon ? {
            "icon-image": ["concat", "poi-", ["get", "kind"]],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 14, 0.6, 17, 0.95],
          } : {}),
          "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
          "text-font": FONT(P.편의시설.bold),
          // 아이콘이 있으면 이름은 설정 줌+1.5 부터(아이콘 먼저), 없으면 즉시
          "text-size": P.편의시설.icon
            ? ["step", ["zoom"], 0, (P.편의시설.zoom ?? 0) + 1.5, P.편의시설.size]
            : P.편의시설.size,
          ...(P.편의시설.icon ? { "text-offset": [0, 1.1], "text-anchor": "top" } : {}),
          "text-max-width": 8,
          "text-optional": true
        },
        paint: { "text-color": C.path, "text-halo-color": C.halo, "text-halo-width": 1.3 }
      },
      {
        // 버스정류장: 아이콘 + 이름(아이콘 뒤 +1 줌부터)
        id: "bus-stops", type: "symbol", source: "protomaps", "source-layer": "pois",
        minzoom: P.버스정류장.zoom ?? 0, filter: ["==", "kind", "bus_stop"],
        layout: {
          visibility: P.버스정류장.zoom != null ? "visible" : "none",
          ...(P.버스정류장.icon ? {
            "icon-image": "poi-bus_stop",
            "icon-size": ["interpolate", ["linear"], ["zoom"], 14.5, 0.55, 17, 0.9],
          } : {}),
          "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
          "text-font": FONT(P.버스정류장.bold),
          "text-size": P.버스정류장.icon
            ? ["step", ["zoom"], 0, (P.버스정류장.zoom ?? 0) + 1, P.버스정류장.size]
            : P.버스정류장.size,
          ...(P.버스정류장.icon ? { "text-offset": [0, 1], "text-anchor": "top" } : {}),
          "text-max-width": 9,
          "text-optional": true
        },
        paint: { "text-color": C.path, "text-halo-color": C.halo, "text-halo-width": 1.3 }
      },
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
          ...(P.사찰.icon ? {
            "icon-image": "poi-place_of_worship",
            "icon-size": ["interpolate", ["linear"], ["zoom"], 13.5, 0.6, 17, 0.9],
            "text-offset": [0, 1.1], "text-anchor": "top",
          } : {}),
          "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
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
          ...(P.전철역.icon ? {
            "icon-image": "poi-station",
            "icon-size": ["interpolate", ["linear"], ["zoom"], 12, 0.7, 16, 1],
          } : {}),
          "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
          "text-font": FONT(P.전철역.bold),
          "text-size": P.전철역.icon
            ? ["step", ["zoom"], 0, (P.전철역.zoom ?? 0) + 0.5, P.전철역.size]
            : P.전철역.size,
          ...(P.전철역.icon ? { "text-offset": [0, 1.2], "text-anchor": "top" } : {}),
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
          "text-font": ["Nanum Gothic Coding Regular"],
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
          "text-font": ["Nanum Gothic Coding Regular"], "text-size": 9.2, "text-max-width": 7
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
          "text-font": ["Nanum Gothic Coding Regular"],
          // 대도시(population_rank≥12)는 크게, 그 외 9.6px — 정상(주봉 14.4)이 여전히 최상위
          "text-size": ["interpolate", ["linear"], ["zoom"],
            6, ["case", [">=", ["get", "population_rank"], 12], 11, 9.6],
            12, ["case", [">=", ["get", "population_rank"], 12], 13, 9.6]],
          "text-max-width": 6
        },
        // 헤일로를 넉넉히 — 흑백에서 라벨과 선형이 겹칠 때 분리력은 헤일로가 좌우
        paint: { "text-color": C.label, "text-halo-color": C.halo, "text-halo-width": 1.8 }
      }
    ]
  };
}
