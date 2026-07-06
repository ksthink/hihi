// Protomaps v4 벡터 스키마용 흑백(모노크롬) MapLibre 스타일.
// 등산 앱: 색상 배제 · 배터리 절약 다크 모드(순수 검정 배경).
export function buildStyle(pmtilesUrl, theme = "light") {
  const dark = theme === "dark";
  const C = dark
    ? {
        bg: "#000000", earth: "#0d0d0d", forest: "#191919", grass: "#131313",
        park: "#1f1f1f", water: "#242424", roadCasing: "#000000", road: "#3a3a3a",
        hw: "#4d4d4d", path: "#8f8f8f", building: "#171717", boundary: "#3a3a3a",
        label: "#cfcfcf", halo: "#000000"
      }
    : {
        bg: "#ffffff", earth: "#f2f2f2", forest: "#e2e2e2", grass: "#ececec",
        park: "#e6e6e6", water: "#d8d8d8", roadCasing: "#cfcfcf", road: "#ffffff",
        hw: "#eaeaea", path: "#555555", building: "#e4e4e4", boundary: "#c6c6c6",
        label: "#333333", halo: "#ffffff"
      };

  return {
    version: 8,
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sources: {
      protomaps: {
        type: "vector",
        url: "pmtiles://" + pmtilesUrl,
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>'
      }
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
        filter: ["in", "kind", "park", "national_park", "nature_reserve", "forest", "recreation_ground"],
        paint: { "fill-color": dark ? "#141414" : "#eeeeee" }
      },
      { id: "water", type: "fill", source: "protomaps", "source-layer": "water", paint: { "fill-color": C.water } },
      {
        id: "rivers", type: "line", source: "protomaps", "source-layer": "physical_line",
        filter: ["in", "kind", "river", "stream"],
        paint: { "line-color": C.water, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 16, 2.4] }
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
        paint: {
          "line-color": C.path,
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.6, 17, 2],
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
          "text-font": ["Noto Sans Regular"], "text-size": 10.5, "symbol-spacing": 400
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
          "text-font": ["Noto Sans Regular"], "text-size": 11, "symbol-spacing": 350
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
          "text-font": ["Noto Sans Regular"],
          "text-size": ["step", ["zoom"], 0, 15.5, 10],
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
          "text-font": ["Noto Sans Regular"],
          "text-size": ["step", ["zoom"], 0, 15.5, 10],
          "text-offset": [0, 1], "text-anchor": "top", "text-max-width": 9,
          "text-optional": true
        },
        paint: { "text-color": C.path, "text-halo-color": C.halo, "text-halo-width": 1.3 }
      },
      {
        // 사찰·암자 — 卍 아이콘 + 이름 (한국 산행 랜드마크)
        id: "temple-names", type: "symbol", source: "protomaps", "source-layer": "pois",
        minzoom: 13.5, filter: ["all", ["==", "kind", "place_of_worship"], ["has", "name"]],
        layout: {
          "icon-image": "poi-place_of_worship",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 13.5, 0.6, 17, 0.9],
          "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"], "text-size": 11.5, "text-max-width": 8,
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
          "text-font": ["Noto Sans Regular"],
          "text-size": ["step", ["zoom"], 0, 12.5, 12],
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
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 12, 11, 16, 13],
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
          "text-font": ["Noto Sans Regular"], "text-size": 11, "text-max-width": 7
        },
        paint: { "text-color": C.path, "text-halo-color": C.halo, "text-halo-width": 1.4 }
      },
      {
        id: "places-labels", type: "symbol", source: "protomaps", "source-layer": "places",
        filter: ["in", "kind", "locality", "region", "country"],
        layout: {
          "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 6, 11, 12, 16],
          "text-max-width": 6
        },
        paint: { "text-color": C.label, "text-halo-color": C.halo, "text-halo-width": 1.5 }
      }
    ]
  };
}
