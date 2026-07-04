#!/usr/bin/env python3
"""북한산 등산로 루트 Esri Polyline JSON(EPSG:5186) → WGS84 GeoJSON.
211개 구간을 이름(PMNTN_NM)별로 병합해 22개 명명 등산로(MultiLineString)로 만든다."""
import json, math, sys, collections

A = 6378137.0
F = 1 / 298.257222101
E2 = 2 * F - F * F
EP2 = E2 / (1 - E2)
LAT0, LON0 = math.radians(38.0), math.radians(127.0)
K0, FE, FN = 1.0, 200000.0, 600000.0

def meridian_arc(phi):
    return A * ((1 - E2/4 - 3*E2**2/64 - 5*E2**3/256) * phi
        - (3*E2/8 + 3*E2**2/32 + 45*E2**3/1024) * math.sin(2*phi)
        + (15*E2**2/256 + 45*E2**3/1024) * math.sin(4*phi)
        - (35*E2**3/3072) * math.sin(6*phi))
M0 = meridian_arc(LAT0)

def tm_to_wgs84(E, N):
    M = M0 + (N - FN) / K0
    mu = M / (A * (1 - E2/4 - 3*E2**2/64 - 5*E2**3/256))
    e1 = (1 - math.sqrt(1 - E2)) / (1 + math.sqrt(1 - E2))
    phi1 = (mu + (3*e1/2 - 27*e1**3/32)*math.sin(2*mu) + (21*e1**2/16 - 55*e1**4/32)*math.sin(4*mu)
        + (151*e1**3/96)*math.sin(6*mu) + (1097*e1**4/512)*math.sin(8*mu))
    s, cs, tn = math.sin(phi1), math.cos(phi1), math.tan(phi1)
    C1, T1 = EP2*cs**2, tn**2
    N1 = A / math.sqrt(1 - E2*s**2)
    R1 = A*(1 - E2)/(1 - E2*s**2)**1.5
    D = (E - FE)/(N1*K0)
    lat = phi1 - (N1*tn/R1)*(D**2/2 - (5+3*T1+10*C1-4*C1**2-9*EP2)*D**4/24
        + (61+90*T1+298*C1+45*T1**2-252*EP2-3*C1**2)*D**6/720)
    lon = LON0 + (D - (1+2*T1+C1)*D**3/6 + (5-2*C1+28*T1-3*C1**2+8*EP2+24*T1**2)*D**5/120)/cs
    return [round(math.degrees(lon), 6), round(math.degrees(lat), 6)]

DIFF = {"쉬움": "초급", "중간": "중급", "어려움": "고급"}
LEVEL = {"초급": 1, "중급": 2, "고급": 3}

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "route_raw.json"
    out = sys.argv[2] if len(sys.argv) > 2 else "../data/bukhansan-routes.geojson"
    data = json.load(open(src, encoding="utf-8"))

    groups = collections.OrderedDict()
    for f in data["features"]:
        a = f["attributes"]
        name = (a.get("PMNTN_NM") or "").strip() or "이름없는 구간"
        g = groups.setdefault(name, {"lines": [], "len": 0.0, "lvl": 1, "mat": collections.Counter()})
        for path in f["geometry"]["paths"]:
            g["lines"].append([tm_to_wgs84(x, y) for x, y in path])
        g["len"] += a.get("PMNTN_LT", 0) or 0
        g["lvl"] = max(g["lvl"], LEVEL.get(DIFF.get((a.get("PMNTN_DFFL") or "").strip(), "초급"), 1))
        g["mat"][(a.get("PMNTN_MTRQ") or "").strip() or "토사"] += 1

    # 연결된 단일 등산로망으로 통합 (행정동 이름으로 쪼개지 않음)
    all_lines, total_len, seg_cnt, mats, lvls = [], 0.0, 0, collections.Counter(), []
    for g in groups.values():
        all_lines += g["lines"]
        total_len += g["len"]
        seg_cnt += sum(g["mat"].values())
        mats += g["mat"]
        lvls.append(g["lvl"])
    lvl_name = {1: "초급", 2: "중급", 3: "고급"}
    diff = lvl_name[max(set(lvls), key=lvls.count)]
    dist = round(total_len, 2)
    surface = mats.most_common(1)[0][0]
    feats = [{
        "type": "Feature",
        "properties": {
            "name": "북한산 홍은동 등산로",
            "difficulty": diff, "distance_km": dist,
            "time_hr": max(0.1, round(dist / 2.5, 1)),
            "surface": surface, "segments": seg_cnt,
            "desc": f"홍은동 자락 연결 등산로망 · {seg_cnt}개 구간 · 총 {dist}km",
        },
        "geometry": {"type": "MultiLineString", "coordinates": all_lines},
    }]

    fc = {"type": "FeatureCollection", "name": "bukhansan-routes",
          "properties": {"source": "PMNTN_북한산_114100801", "crs_from": "EPSG:5186"},
          "features": feats}
    json.dump(fc, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"wrote {len(feats)} routes -> {out}")
    for f in feats[:22]:
        p = f["properties"]
        print(f"  {p['distance_km']:>5}km  {p['difficulty']}  {p['name']}")


if __name__ == "__main__":
    main()
