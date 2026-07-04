#!/usr/bin/env python3
"""북한산 스팟 Esri JSON(EPSG:5186 TM) → WGS84 GeoJSON 변환.

의존성 없이 Transverse Mercator 역투영(GRS80)을 직접 계산한다.
EPSG:5186 (Korea 2000 / Central Belt 2010): lat0=38, lon0=127, k0=1, FE=200000, FN=600000
"""
import json, math, sys, os, collections

A = 6378137.0
F = 1 / 298.257222101
E2 = 2 * F - F * F
EP2 = E2 / (1 - E2)
LAT0 = math.radians(38.0)
LON0 = math.radians(127.0)
K0 = 1.0
FE, FN = 200000.0, 600000.0

def meridian_arc(phi):
    return A * (
        (1 - E2/4 - 3*E2**2/64 - 5*E2**3/256) * phi
        - (3*E2/8 + 3*E2**2/32 + 45*E2**3/1024) * math.sin(2*phi)
        + (15*E2**2/256 + 45*E2**3/1024) * math.sin(4*phi)
        - (35*E2**3/3072) * math.sin(6*phi)
    )

M0 = meridian_arc(LAT0)

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
    C1 = EP2 * cos1**2
    T1 = tan1**2
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
    return round(math.degrees(lon), 6), round(math.degrees(lat), 6)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "data/spots_raw.json"
    out = sys.argv[2] if len(sys.argv) > 2 else "data/bukhansan-spots.geojson"
    data = json.load(open(src, encoding="utf-8"))

    feats, cats = [], collections.Counter()
    for f in data["features"]:
        a, g = f["attributes"], f.get("geometry")
        if not g:
            continue
        lon, lat = tm_to_wgs84(g["x"], g["y"])
        cat = (a.get("MANAGE_SP2") or "").strip()
        detail = (a.get("DETAIL_SPO") or "").strip()
        cats[cat] += 1
        feats.append({
            "type": "Feature",
            "properties": {
                "id": a.get("PMNTN_SPOT"),
                "category": cat,
                "detail": detail,
                "etc": (a.get("ETC_MATTER") or "").strip(),
            },
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
        })

    fc = {
        "type": "FeatureCollection",
        "name": "bukhansan-spots",
        "properties": {"source": "PMNTN_SPOT_북한산_114100801", "crs_from": "EPSG:5186"},
        "features": feats,
    }
    json.dump(fc, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"wrote {len(feats)} features -> {out}")
    lons = [f["geometry"]["coordinates"][0] for f in feats]
    lats = [f["geometry"]["coordinates"][1] for f in feats]
    print(f"lon {min(lons):.5f}~{max(lons):.5f}  lat {min(lats):.5f}~{max(lats):.5f}")
    print("sample:", feats[0]["geometry"]["coordinates"], feats[0]["properties"]["detail"])
    print("categories:", dict(cats.most_common()))


if __name__ == "__main__":
    main()
