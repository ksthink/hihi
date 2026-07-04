#!/usr/bin/env python3
"""OSM 등산로 코스 생성: 능선/계곡 등산로(named highway=path) + 북한산둘레길(route=hiking).
- 능선 등산로: 이름 있는 path/footway 를 이름별로 묶고 sac_scale 로 난이도 산정
- 둘레길: route=hiking 릴레이션의 멤버 way 를 묶음
합쳐서 data/bukhansan-routes.geojson 생성."""
import json, math, sys, collections

def hav(a, b):
    R = 6371000
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp = math.radians(b[1]-a[1]); dl = math.radians(b[0]-a[0])
    x = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(x))

def linelen(pts):
    return sum(hav(pts[i-1], pts[i]) for i in range(1, len(pts)))

SAC = {"hiking": 1, "mountain_hiking": 2, "demanding_mountain_hiking": 3,
       "alpine_hiking": 3, "demanding_alpine_hiking": 3, "difficult_alpine_hiking": 3}
LVL = {1: "초급", 2: "중급", 3: "고급"}

def keep_trail(n):
    if not n or "둘레길" in n or n[0].isdigit() or "Km" in n:
        return False
    if any(b in n for b in ["로", "자전거", "통로", "매표소", "묘역", "제방"]):
        return False
    if n in {"비법정탐방로", "계곡탐방로", "탐방로"}:
        return False
    return any(k in n for k in ["능선", "계곡", "길", "대피소"])

def build_ridges(path):
    d = json.load(open(path, encoding="utf-8"))
    G = collections.defaultdict(lambda: {"lines": [], "len": 0.0, "lvl": 0})
    for e in d["elements"]:
        t = e.get("tags", {}); nm = (t.get("name") or "").strip()
        if not keep_trail(nm) or "geometry" not in e:
            continue
        pts = [[round(p["lon"], 6), round(p["lat"], 6)] for p in e["geometry"]]
        if len(pts) < 2:
            continue
        g = G[nm]; g["lines"].append(pts); g["len"] += linelen(pts)
        g["lvl"] = max(g["lvl"], SAC.get(t.get("sac_scale", ""), 0))
    feats = []
    for nm, g in G.items():
        km = round(g["len"] / 1000, 2)
        if km < 0.2:
            continue
        lvl = g["lvl"] or (2 if "능선" in nm else 1)  # sac 없으면 능선=중급
        feats.append({"type": "Feature", "properties": {
            "name": nm, "difficulty": LVL[lvl], "distance_km": km,
            "time_hr": max(0.3, round(km / 2.5, 1)), "kind": "등산로",
            "desc": f"OSM 등산로 · {km}km", "segments": len(g["lines"])},
            "geometry": {"type": "MultiLineString", "coordinates": g["lines"]}})
    feats.sort(key=lambda f: -f["properties"]["distance_km"])
    return feats

def build_dulle(path):
    d = json.load(open(path, encoding="utf-8"))
    feats = []
    for e in d["elements"]:
        raw = (e.get("tags", {}).get("name") or "").strip()
        if "구간" not in raw:
            continue
        name = raw.replace("[", "").replace("]", "").strip()
        lines, total = [], 0.0
        for m in e.get("members", []):
            if m.get("type") != "way" or "geometry" not in m:
                continue
            pts = [[round(p["lon"], 6), round(p["lat"], 6)] for p in m["geometry"]]
            if len(pts) >= 2:
                lines.append(pts); total += linelen(pts)
        km = round(total / 1000, 2)
        if not lines or km < 0.3:
            continue
        feats.append({"type": "Feature", "properties": {
            "name": name, "difficulty": "초급", "distance_km": km,
            "time_hr": max(0.3, round(km / 3.0, 1)), "kind": "둘레길",
            "surface": "둘레길", "desc": f"북한산둘레길 · {km}km", "segments": len(lines)},
            "geometry": {"type": "MultiLineString", "coordinates": lines}})
    feats.sort(key=lambda f: int("".join(c for c in f["properties"]["name"].split("구간")[0] if c.isdigit()) or 999))
    return feats

def main():
    ridges = build_ridges(sys.argv[1] if len(sys.argv) > 1 else "osm_named_geom.json")
    dulle = build_dulle(sys.argv[2] if len(sys.argv) > 2 else "osm_dulle.json")
    out = sys.argv[3] if len(sys.argv) > 3 else "../data/bukhansan-routes.geojson"
    feats = ridges + dulle
    fc = {"type": "FeatureCollection", "name": "bukhansan-routes",
          "properties": {"source": "OSM highway=path(능선) + route=hiking(둘레길)", "crs": "WGS84"},
          "features": feats}
    json.dump(fc, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    xs = [c[0] for f in feats for l in f["geometry"]["coordinates"] for c in l]
    ys = [c[1] for f in feats for l in f["geometry"]["coordinates"] for c in l]
    print(f"wrote {len(feats)} courses ({len(ridges)} 등산로 + {len(dulle)} 둘레길) -> {out}")
    print(f"center ~ [{(min(xs)+max(xs))/2:.4f}, {(min(ys)+max(ys))/2:.4f}]  lat {min(ys):.4f}~{max(ys):.4f}")
    print("등산로:")
    for f in ridges:
        p = f["properties"]; print(f"  {p['distance_km']:>5}km  {p['difficulty']}  {p['name']}")


if __name__ == "__main__":
    main()
