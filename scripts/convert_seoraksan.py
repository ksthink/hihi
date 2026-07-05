#!/usr/bin/env python3
"""설악산 대청봉(428302602) 산림청 Esri JSON(EPSG:5186) → WGS84 GeoJSON 변환.

입력(428302602_geojson/):
  PMNTN_설악산_대청봉_428302602.json      등산로 57구간 (esriGeometryPolyline)
  PMNTN_SPOT_설악산_대청봉_428302602.json  스팟 45개 (esriGeometryPoint)
출력:
  data/seoraksan-routes.geojson  (MultiLineString, 구간별 — 변환만, 큐레이션 없음)
  data/seoraksan-spots.geojson   (Point, category/detail/etc — 북한산 스팟과 동일 스키마)

좌표계 EPSG:5186 역투영은 convert_spots.py 와 동일(GRS80 TM, lat0=38 lon0=127 k0=1 FE/FN=200000/600000).
난이도: 쉬움→초급, 중간/보통→중급, 어려움/매우어려움→고급.  time_hr = 상행소요(분)/60.
"""
import collections
import json
import math
import os

A = 6378137.0
F = 1 / 298.257222101
E2 = 2 * F - F * F
EP2 = E2 / (1 - E2)
LAT0, LON0 = math.radians(38.0), math.radians(127.0)
K0, FE, FN = 1.0, 200000.0, 600000.0


def _meridian_arc(phi):
    return A * (
        (1 - E2/4 - 3*E2**2/64 - 5*E2**3/256) * phi
        - (3*E2/8 + 3*E2**2/32 + 45*E2**3/1024) * math.sin(2*phi)
        + (15*E2**2/256 + 45*E2**3/1024) * math.sin(4*phi)
        - (35*E2**3/3072) * math.sin(6*phi))


M0 = _meridian_arc(LAT0)


def tm_to_wgs84(E, N):
    M = M0 + (N - FN) / K0
    mu = M / (A * (1 - E2/4 - 3*E2**2/64 - 5*E2**3/256))
    e1 = (1 - math.sqrt(1 - E2)) / (1 + math.sqrt(1 - E2))
    phi1 = (mu
        + (3*e1/2 - 27*e1**3/32) * math.sin(2*mu)
        + (21*e1**2/16 - 55*e1**4/32) * math.sin(4*mu)
        + (151*e1**3/96) * math.sin(6*mu)
        + (1097*e1**4/512) * math.sin(8*mu))
    sin1, cos1, tan1 = math.sin(phi1), math.cos(phi1), math.tan(phi1)
    C1, T1 = EP2 * cos1**2, tan1**2
    N1 = A / math.sqrt(1 - E2 * sin1**2)
    R1 = A * (1 - E2) / (1 - E2 * sin1**2)**1.5
    D = (E - FE) / (N1 * K0)
    lat = phi1 - (N1 * tan1 / R1) * (
        D**2/2
        - (5 + 3*T1 + 10*C1 - 4*C1**2 - 9*EP2) * D**4/24
        + (61 + 90*T1 + 298*C1 + 45*T1**2 - 252*EP2 - 3*C1**2) * D**6/720)
    lon = LON0 + (
        D - (1 + 2*T1 + C1) * D**3/6
        + (5 - 2*C1 + 28*T1 - 3*C1**2 + 8*EP2 + 24*T1**2) * D**5/120) / cos1
    return [round(math.degrees(lon), 6), round(math.degrees(lat), 6)]


DIFF = {"쉬움": "초급", "보통": "중급", "중간": "중급", "어려움": "고급", "매우어려움": "고급"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "428302602_geojson")
blank = lambda v: not v or not str(v).strip()


def convert_routes():
    d = json.load(open(os.path.join(SRC, "PMNTN_설악산_대청봉_428302602.json"), encoding="utf-8"))
    feats, names = [], collections.Counter()
    for f in d["features"]:
        a = f["attributes"]
        grp = a.get("PMNTN_NM", "").strip() or "설악산 대청봉 구간"
        names[grp] += 1
        name = f"{grp} {names[grp]}"
        up = a.get("PMNTN_UPPL") or 0
        coords = [[tm_to_wgs84(*pt) for pt in path] for path in f["geometry"]["paths"]]
        feats.append({
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": coords},
            "properties": {
                "name": name,
                "difficulty": DIFF.get(a.get("PMNTN_DFFL", "").strip(), "초급"),
                "distance_km": round(a.get("PMNTN_LT", 0) or 0, 2),
                "time_hr": round(up / 60, 1) if up else None,
                "kind": "산림청 구간",
                "desc": "산림청 등산로 구간 데이터(미큐레이션)",
            },
        })
    return feats


def convert_spots():
    d = json.load(open(os.path.join(SRC, "PMNTN_SPOT_설악산_대청봉_428302602.json"), encoding="utf-8"))
    feats, cats = [], collections.Counter()
    for f in d["features"]:
        a, g = f["attributes"], f.get("geometry")
        if not g:
            continue
        cat = a.get("MANAGE_SP2", "").strip()
        cats[cat] += 1
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": tm_to_wgs84(g["x"], g["y"])},
            "properties": {
                "id": a.get("PMNTN_SPOT"),
                "category": cat,
                "detail": None if blank(a.get("DETAIL_SPO")) else a["DETAIL_SPO"].strip(),
                "etc": None if blank(a.get("ETC_MATTER")) else a["ETC_MATTER"].strip(),
            },
        })
    return feats, cats


def main():
    routes = convert_routes()
    spots, cats = convert_spots()
    for name, feats in [("seoraksan-routes", routes), ("seoraksan-spots", spots)]:
        path = os.path.join(ROOT, "data", name + ".geojson")
        json.dump({"type": "FeatureCollection", "features": feats},
                  open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"{name}: {len(feats)}개 → {path}")
    # bbox 확인
    xs = [c[0] for f in routes for p in f["geometry"]["coordinates"] for c in p]
    ys = [c[1] for f in routes for p in f["geometry"]["coordinates"] for c in p]
    print(f"bbox: [{min(xs):.4f}, {min(ys):.4f}, {max(xs):.4f}, {max(ys):.4f}]")
    print(f"스팟 종류: {dict(cats)}")


if __name__ == "__main__":
    main()
