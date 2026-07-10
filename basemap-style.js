// Protomaps v4 벡터 스키마용 흑백(모노크롬) MapLibre 스타일.
// 등산 앱: 색상 배제 · 배터리 절약 다크 모드(순수 검정 배경).
// terrainUrl(선택): terrain-RGB PMTiles → 음영기복(hillshade). 흑백 지도의 지형 입체감 핵심.
//   오프라인 로컬 팩 열람 시엔 넘기지 않음(원격 전용) — 레이어 자체가 빠져 콘솔 오류 없음.
export function buildStyle(pmtilesUrl, theme = "light", terrainUrl = null) {
  const dark = theme === "dark";
  // 흑백 가독성 원칙: 색이 없으므로 "명도 계단"이 유일한 분리 수단.
  // 지표 클래스마다 6~8% 간격의 뚜렷한 밝기 단계를 배정한다 —
  // 라이트: 시가지(밝음) > 풀 > 공원 > 숲 > 물(제일 어두움) / 다크는 역방향.
  const C = dark
    ? {
        bg: "#000000", earth: "#0d0d0d", forest: "#1d1d1d", grass: "#131313",
        park: "#232323", water: "#303030", roadCasing: "#000000", road: "#424242",
        hw: "#585858", path: "#a3a3a3", building: "#171717", boundary: "#4a4a4a",
        label: "#d9d9d9", halo: "#000000"
      }
    : {
        bg: "#ffffff", earth: "#f4f4f4", forest: "#dcdcdc", grass: "#ececec",
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
        id: "landcover-forest", type: "fill", source: "protomaps", "source-layer": "landcover",
        filter: ["in", "kind", "forest", "wood", "scrub"],
        paint: { "fill-color": C.forest }
      },
      {
        id: "landcover-grass", type: "fill", source: "protomaps", "source-layer": "landcover",
        filter: ["in", "kind", "grassland", "farmland", "barren"],
        paint: { "fill-color": C.grass }
      },
      {
        // 공원/보호구역: 불투명 + 미세한 톤 차이만.
        // 반투명(0.6)이면 국립공원 같은 거대 폴리곤이 산 전체를 음영으로 덮고,
        // 겹치는 폴리곤(공원∩보호구역)끼리 알파가 누적돼 얼룩처럼 진해진다.
        id: "landuse-park", type: "fill", source: "protomaps", "source-layer": "landuse",
        filter: ["in", "kind", "park", "national_park", "nature_reserve", "recreation_ground"],
        paint: { "fill-color": C.park }
      },
      {
        // 숲(산지): z8+ 에선 landcover 레이어가 없고 landuse 의 wood/forest 로 들어옴 —
        // 이 레이어가 없으면 실사용 줌에서 산 전체가 earth 색 백지가 된다.
        id: "landuse-forest", type: "fill", source: "protomaps", "source-layer": "landuse",
        filter: ["in", "kind", "forest", "wood", "scrub"],
        paint: { "fill-color": C.forest }
      },
      {
        id: "landuse-farm", type: "fill", source: "protomaps", "source-layer": "landuse",
        filter: ["in", "kind", "farmland", "grass", "orchard"],
        paint: { "fill-color": C.grass }
      },
      // 음영기복 — 지표 채움 위, 물·선·라벨 아래. 흑백에서 능선·계곡을 입체로 읽게 하는 층.
      ...(terrainUrl ? [{
        id: "hillshade", type: "hillshade", source: "dem",
        paint: dark
          ? { "hillshade-exaggeration": 0.4, "hillshade-shadow-color": "#000000",
              "hillshade-highlight-color": "#3d3d3d", "hillshade-accent-color": "#000000" }
          : { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#6e6e6e",
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
        // 편의시설: 아이콘 + 이름(최고줌부터, text-size step) — 한 레이어라 자기 라벨과 충돌 안 함
        id: "poi-amenities", type: "symbol", source: "protomaps", "source-layer": "pois",
        minzoom: 14, filter: ["in", "kind", "toilets", "drinking_water", "parking", "information"],
        layout: {
          "icon-image": ["concat", "poi-", ["get", "kind"]],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 14, 0.6, 17, 0.95],
          "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
          "text-font": ["Nanum Gothic Coding Regular"],
          "text-size": ["step", ["zoom"], 0, 15.5, 8.4],
          "text-offset": [0, 1.1], "text-anchor": "top", "text-max-width": 8,
          "text-optional": true
        },
        paint: { "text-color": C.path, "text-halo-color": C.halo, "text-halo-width": 1.3 }
      },
      {
        // 버스정류장: 아이콘 + 이름(z15.5+)
        id: "bus-stops", type: "symbol", source: "protomaps", "source-layer": "pois",
        minzoom: 14.5, filter: ["==", "kind", "bus_stop"],
        layout: {
          "icon-image": "poi-bus_stop",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 14.5, 0.55, 17, 0.9],
          "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
          "text-font": ["Nanum Gothic Coding Regular"],
          "text-size": ["step", ["zoom"], 0, 15.5, 8.4],
          "text-offset": [0, 1], "text-anchor": "top", "text-max-width": 9,
          "text-optional": true
        },
        paint: { "text-color": C.path, "text-halo-color": C.halo, "text-halo-width": 1.3 }
      },
      {
        // 사찰·암자 — 卍 아이콘 + 이름 (한국 산행 랜드마크)
        // OSM kind=place_of_worship 은 종교 통합 분류라 교회·성당까지 걸림 →
        // 한국어 라벨 휴리스틱으로 비사찰 계열 이름을 제외 (사찰은 …사/…암 등이라 안 걸림)
        id: "temple-names", type: "symbol", source: "protomaps", "source-layer": "pois",
        minzoom: 13.5,
        filter: ["all",
          ["==", ["get", "kind"], "place_of_worship"], ["has", "name"],
          ["!", ["any",
            ...["교회", "성당", "채플", "예배", "기도원", "교당", "모스크", "회당", "선교"]
              .map((k) => ["in", k, ["coalesce", ["get", "name:ko"], ["get", "name"], ""]])
          ]]
        ],
        layout: {
          "icon-image": "poi-place_of_worship",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 13.5, 0.6, 17, 0.9],
          "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
          "text-font": ["Nanum Gothic Coding Regular"], "text-size": 9.7, "text-max-width": 8,
          "text-offset": [0, 1.1], "text-anchor": "top",
          "text-optional": true
        },
        paint: { "text-color": C.label, "text-halo-color": C.halo, "text-halo-width": 1.4 }
      },
      {
        // 전철역: 아이콘 + 이름(z12.5+) — 한 레이어(자기 라벨과 충돌 방지)
        id: "stations", type: "symbol", source: "protomaps", "source-layer": "pois",
        minzoom: 12, filter: ["==", "kind", "station"],
        layout: {
          "icon-image": "poi-station",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 12, 0.7, 16, 1],
          "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
          "text-font": ["Nanum Gothic Coding Regular"],
          "text-size": ["step", ["zoom"], 0, 12.5, 10.1],
          "text-offset": [0, 1.2], "text-anchor": "top", "text-max-width": 8,
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
