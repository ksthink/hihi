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
        id: "landuse-park", type: "fill", source: "protomaps", "source-layer": "landuse",
        filter: ["in", "kind", "park", "national_park", "nature_reserve", "forest", "recreation_ground"],
        paint: { "fill-color": C.park, "fill-opacity": 0.6 }
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
        id: "buildings", type: "fill", source: "protomaps", "source-layer": "buildings",
        minzoom: 14, paint: { "fill-color": C.building, "fill-opacity": 0.8 }
      },
      {
        id: "boundaries", type: "line", source: "protomaps", "source-layer": "boundaries",
        paint: { "line-color": C.boundary, "line-width": 1, "line-dasharray": [3, 2], "line-opacity": 0.7 }
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
