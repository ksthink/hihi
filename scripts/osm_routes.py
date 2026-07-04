#!/usr/bin/env python3
"""OSM route=hiking 릴레이션(북한산둘레길) → 앱 코스 GeoJSON.
OSM은 이미 WGS84라 좌표 변환 불필요. 릴레이션당 멤버 way를 MultiLineString으로 묶는다."""
import json, math, sys

def hav(a, b):
    R = 6371000
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp = math.radians(b[1]-a[1]); dl = math.radians(b[0]-a[0])
    x = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(x))

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "osm_dulle.json"
    out = sys.argv[2] if len(sys.argv) > 2 else "../data/bukhansan-routes.geojson"
    d = json.load(open(src, encoding="utf-8"))

    feats = []
    for e in d["elements"]:
        t = e.get("tags", {})
        raw = (t.get("name") or "").strip()
        if "구간" not in raw:  # 상위(전체) 릴레이션은 건너뜀
            continue
        name = raw.replace("[", "").replace("]", "").strip()
        lines, total = [], 0.0
        for m in e.get("members", []):
            if m.get("type") != "way" or "geometry" not in m:
                continue
            pts = [[round(p["lon"], 6), round(p["lat"], 6)] for p in m["geometry"]]
            if len(pts) < 2:
                continue
            lines.append(pts)
            total += sum(hav(pts[i-1], pts[i]) for i in range(1, len(pts)))
        if not lines:
            continue
        km = round(total / 1000, 2)
        if km < 0.3:  # 잘린 스텁 릴레이션 제외
            continue
        feats.append({
            "type": "Feature",
            "properties": {
                "name": name, "difficulty": "초급", "distance_km": km,
                "time_hr": max(0.3, round(km / 3.0, 1)),
                "surface": "둘레길", "segments": len(lines),
                "desc": f"북한산둘레길 · {km}km · OSM 데이터",
            },
            "geometry": {"type": "MultiLineString", "coordinates": lines},
        })

    # 구간 번호 순 정렬
    def sortkey(f):
        n = f["properties"]["name"]
        num = "".join(ch for ch in n.split("구간")[0] if ch.isdigit())
        return int(num) if num else 999
    feats.sort(key=sortkey)

    fc = {"type": "FeatureCollection", "name": "bukhansan-routes",
          "properties": {"source": "OSM route=hiking 북한산둘레길", "crs": "WGS84"},
          "features": feats}
    json.dump(fc, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"wrote {len(feats)} courses -> {out}")
    xs = [c[0] for f in feats for l in f["geometry"]["coordinates"] for c in l]
    ys = [c[1] for f in feats for l in f["geometry"]["coordinates"] for c in l]
    print(f"extent lon {min(xs):.4f}~{max(xs):.4f}  lat {min(ys):.4f}~{max(ys):.4f}")
    print(f"center ~ [{(min(xs)+max(xs))/2:.4f}, {(min(ys)+max(ys))/2:.4f}]")
    for f in feats:
        p = f["properties"]
        print(f"  {p['distance_km']:>5}km  {p['name']}")


if __name__ == "__main__":
    main()
