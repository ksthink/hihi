#!/usr/bin/env python3
"""북한산 백운대 등산로 Esri Polyline JSON(EPSG:5186) → WGS84 GeoJSON.
MNTN_ID(등산로) 단위로 묶어 들머리 지역명으로 라벨링한 6개 코스(MultiLineString)로 만든다."""
import json, math, sys, collections

A = 6378137.0
F = 1 / 298.257222101
E2 = 2 * F - F * F
EP2 = E2 / (1 - E2)
LAT0, LON0 = math.radians(38.0), math.radians(127.0)
FE, FN = 200000.0, 600000.0

def marc(phi):
    return A * ((1 - E2/4 - 3*E2**2/64 - 5*E2**3/256) * phi
        - (3*E2/8 + 3*E2**2/32 + 45*E2**3/1024) * math.sin(2*phi)
        + (15*E2**2/256 + 45*E2**3/1024) * math.sin(4*phi)
        - (35*E2**3/3072) * math.sin(6*phi))
M0 = marc(LAT0)

def tm(E, N):
    M = M0 + (N - FN)
    mu = M / (A * (1 - E2/4 - 3*E2**2/64 - 5*E2**3/256))
    e1 = (1 - math.sqrt(1 - E2)) / (1 + math.sqrt(1 - E2))
    p1 = (mu + (3*e1/2 - 27*e1**3/32)*math.sin(2*mu) + (21*e1**2/16 - 55*e1**4/32)*math.sin(4*mu)
        + (151*e1**3/96)*math.sin(6*mu) + (1097*e1**4/512)*math.sin(8*mu))
    s, cs, tn = math.sin(p1), math.cos(p1), math.tan(p1)
    C1, T1 = EP2*cs**2, tn**2
    N1 = A/math.sqrt(1 - E2*s**2); R1 = A*(1 - E2)/(1 - E2*s**2)**1.5; D = (E - FE)/N1
    lat = p1 - (N1*tn/R1)*(D**2/2 - (5+3*T1+10*C1-4*C1**2-9*EP2)*D**4/24
        + (61+90*T1+298*C1+45*T1**2-252*EP2-3*C1**2)*D**6/720)
    lon = LON0 + (D - (1+2*T1+C1)*D**3/6 + (5-2*C1+28*T1-3*C1**2+8*EP2+24*T1**2)*D**5/120)/cs
    return [round(math.degrees(lon), 6), round(math.degrees(lat), 6)]

DIFF = {"쉬움": 1, "중간": 2, "어려움": 3}
LVL = {1: "초급", 2: "중급", 3: "고급"}

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "dl3.bin"
    out = sys.argv[2] if len(sys.argv) > 2 else "../data/bukhansan-routes.geojson"
    d = json.load(open(src, encoding="utf-8"))

    G = collections.defaultdict(lambda: {"lines": [], "len": 0.0, "lvl": 1,
                                         "names": collections.Counter(), "mat": collections.Counter()})
    for f in d["features"]:
        a = f["attributes"]; g = G[a["MNTN_ID"]]
        for path in f["geometry"]["paths"]:
            g["lines"].append([tm(x, y) for x, y in path])
        g["len"] += a.get("PMNTN_LT", 0) or 0
        g["lvl"] = max(g["lvl"], DIFF.get((a.get("PMNTN_DFFL") or "").strip(), 1))
        nm = (a.get("PMNTN_NM") or "").strip()
        if nm:
            g["names"][nm] += 1
        mt = (a.get("PMNTN_MTRQ") or "").strip()
        if mt:
            g["mat"][mt] += 1

    feats = []
    for mid, g in G.items():
        areas = [(n[:-2] if n.endswith("구간") else n) for n, _ in g["names"].most_common()]
        label = "백운대 · " + "/".join(areas[:2]) + " 방면" if areas else f"백운대 코스 {mid}"
        dist = round(g["len"], 2)
        seg = len(g["lines"])
        surface = g["mat"].most_common(1)[0][0] if g["mat"] else ""
        feats.append({
            "type": "Feature",
            "properties": {
                "name": label, "difficulty": LVL[g["lvl"]], "distance_km": dist,
                "surface": surface, "segments": seg, "mntn_id": mid,
                "desc": f"{seg}개 구간 · 총 {dist}km 등산로망" + (f" · {surface}" if surface else ""),
            },
            "geometry": {"type": "MultiLineString", "coordinates": g["lines"]},
        })
    feats.sort(key=lambda f: -f["properties"]["distance_km"])

    fc = {"type": "FeatureCollection", "name": "bukhansan-routes",
          "properties": {"source": "북한산_백운대", "crs_from": "EPSG:5186"}, "features": feats}
    json.dump(fc, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"wrote {len(feats)} courses -> {out}")
    for f in feats:
        p = f["properties"]
        print(f"  {p['distance_km']:>6}km  {p['difficulty']}  {p['segments']:>3}구간  {p['name']}")


if __name__ == "__main__":
    main()
