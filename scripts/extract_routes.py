#!/usr/bin/env python3
"""백운대 등산로 망(296구간) → 실제 단일 코스 추출.
그래프를 만들어 각 들머리 지역(MNTN_ID)의 가장 먼 끝점에서 백운대 정상까지
최단경로(단일 폴리라인)를 뽑아 '진짜 등산로 코스'로 만든다."""
import json, math, collections, heapq, sys

# tm() 및 상수 로드
exec(open("convert_baegundae.py").read().split("def main")[0])

PEAK = (126.9880, 37.6591)  # 백운대
DIFF = {"쉬움": 1, "중간": 2, "어려움": 3}
LVL = {1: "초급", 2: "중급", 3: "고급"}

def snap(lon, lat): return (round(lon, 4), round(lat, 4))
def hav(a, b):
    R = 6371000
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp = math.radians(b[1]-a[1]); dl = math.radians(b[0]-a[0])
    x = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(x))

def plen(pts): return sum(hav(pts[i-1], pts[i]) for i in range(1, len(pts)))

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "baegundae_raw.json"
    out = sys.argv[2] if len(sys.argv) > 2 else "../data/bukhansan-routes.geojson"
    d = json.load(open(src, encoding="utf-8"))
    fs = d["features"]

    adj = collections.defaultdict(list)   # node -> [(nbr, w, geom_node->nbr, lvl)]
    deg = collections.Counter()
    id_nodes = collections.defaultdict(set)   # MNTN_ID -> {nodes}
    id_names = collections.defaultdict(collections.Counter)
    for f in fs:
        a = f["attributes"]; mid = a["MNTN_ID"]
        lvl = DIFF.get((a.get("PMNTN_DFFL") or "").strip(), 1)
        nm = (a.get("PMNTN_NM") or "").strip()
        if nm: id_names[mid][nm[:-2] if nm.endswith("구간") else nm] += 1
        for path in f["geometry"]["paths"]:
            pts = [tm(x, y) for x, y in path]
            u, v = snap(*pts[0]), snap(*pts[-1])
            if u == v: continue
            w = plen(pts)
            adj[u].append((v, w, pts, lvl))
            adj[v].append((u, w, pts[::-1], lvl))
            deg[u] += 1; deg[v] += 1
            id_nodes[mid].add(u); id_nodes[mid].add(v)

    nodes = list(adj)
    summit = min(nodes, key=lambda n: hav(n, PEAK))

    # 정상에서 다익스트라 (경로 복원용 prev + 되돌아가는 geom)
    dist = {summit: 0.0}; prev = {}
    pq = [(0.0, summit)]
    while pq:
        du, u = heapq.heappop(pq)
        if du > dist.get(u, 1e18): continue
        for v, w, geom_uv, lvl in adj[u]:
            nd = du + w
            if nd < dist.get(v, 1e18):
                dist[v] = nd
                prev[v] = (u, geom_uv[::-1], lvl)  # geom oriented v->u (정상쪽)
                heapq.heappush(pq, (nd, v))

    def route_from(t):
        coords, cur, maxlvl = [], t, 1
        while cur != summit and cur in prev:
            u, geom_v2u, lvl = prev[cur]
            maxlvl = max(maxlvl, lvl)
            for p in geom_v2u:
                if not coords or coords[-1] != p: coords.append(p)
            cur = u
        return coords, maxlvl

    feats = []
    used = set()
    for mid, ns in id_nodes.items():
        cands = [n for n in ns if deg[n] == 1 and n in dist]
        if not cands: cands = [n for n in ns if n in dist]
        if not cands: continue
        t = max(cands, key=lambda n: dist[n])      # 정상에서 가장 먼 들머리
        coords, maxlvl = route_from(t)
        if len(coords) < 2: continue
        km = round(dist[t] / 1000, 2)
        areas = [a for a, _ in id_names[mid].most_common()]
        head = "/".join(areas[:2]) if areas else mid
        name = f"{head} → 백운대"
        key = (round(t[0], 3), round(t[1], 3))
        if key in used: continue
        used.add(key)
        feats.append({
            "type": "Feature",
            "properties": {
                "name": name, "difficulty": LVL[maxlvl], "distance_km": km,
                "time_hr": max(0.3, round(km / 2.2, 1)),  # 등산 약 2.2km/h
                "trailhead": head, "peak": "백운대 (836m)",
                "desc": f"{head} 들머리에서 백운대 정상까지 {km}km 단일 코스",
            },
            "geometry": {"type": "LineString", "coordinates": coords},
        })
    feats.sort(key=lambda f: -f["properties"]["distance_km"])

    fc = {"type": "FeatureCollection", "name": "bukhansan-routes",
          "properties": {"source": "북한산_백운대 (라우팅 추출)", "crs_from": "EPSG:5186"},
          "features": feats}
    json.dump(fc, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"summit node: {summit} ({hav(summit, PEAK):.0f}m from 백운대)")
    print(f"wrote {len(feats)} routes -> {out}")
    for f in feats:
        p = f["properties"]
        print(f"  {p['distance_km']:>5}km  {p['difficulty']}  ~{p['time_hr']}h  {p['name']}  ({len(f['geometry']['coordinates'])}pts)")


if __name__ == "__main__":
    main()
