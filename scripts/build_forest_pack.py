#!/usr/bin/env python3
"""산림청 등산로 원본(mountain/<산코드>/) → 코스형 routes + spots GeoJSON (비국립공원용).

구간(segment) 데이터를 그래프로 잇고 DEM 으로 정상 노드를 찾아
"들머리 → 정상" 최단경로를 코스로 추출한다 (KNPS 미커버 산의 표준 파이프라인).
핵심 로직은 scripts/pack_lib.py 공용 라이브러리에 있고 이 파일은 CLI 래퍼다.
- 코스명: 경로가 지나는 산림청 구간명(PMNTN_NM, 동네구간) 최빈값 → "문원동 코스" 식.
  없으면 "<산이름> N코스".
- 난이도: DEM 누적상승 기준(<400 초급, <800 중급, 이상 고급)
- 중복 억제: 이미 채택된 코스와 경로(간선) 70% 이상 겹치면 제외

사용: (.venv: rasterio, numpy)
  python3 scripts/build_forest_pack.py <산코드> <산이름영문slug> <DEM.tif...> [max_courses]
  DEM.tif 를 생략하면 cache/dem 에서 bbox 커버 타일을 자동 확보(dem_cache).
예:
  python3 scripts/build_forest_pack.py 412900401 cheonggyesan 12
출력: data/<slug>-routes.geojson, data/<slug>-spots.geojson (+bbox 출력)
"""
import collections
import json
import os
import sys

import pack_lib as pl


def extract_courses(code, dem, max_courses=12, log=print):
    """코스 추출 코어 — CLI 와 admin_server 가 공유. → (feats, mntn_nm)"""
    segs, mntn_nm = pl.load_forest_segments(code)
    adj = pl.build_graph(segs)
    comp = pl.largest_component(adj)

    node_elev = {n: dem.elev(*n) for n in comp}
    summit = max(comp, key=node_elev.get)
    log(f"{mntn_nm}: 노드 {len(comp)} · 정상 {node_elev[summit]:.0f}m @ {summit}")

    # 들머리 후보: 차수1 + 정상보다 200m 이상 낮음 + 정상에서 1km 이상, 700m 간격
    ends = [n for n in comp if len(adj[n]) == 1
            and node_elev[n] < node_elev[summit] - 200 and pl.hav(n, summit) > 1000]
    ends.sort(key=lambda n: node_elev[n])
    heads = []
    for n in ends:
        if all(pl.hav(n, h) > 700 for h in heads):
            heads.append(n)

    dist, prev = pl.dijkstra(adj, summit)

    feats, used_edges = [], []
    n_auto = 0
    for h in heads:
        if h not in prev and h != summit:
            continue
        # 경로 복원 (들머리→정상)
        coords, names, ups, edges = [], [], [], set()
        cur = h
        while cur != summit:
            u, geom, nm, up, w = prev[cur]
            seg = list(reversed(geom))  # geom 은 u→cur 방향
            coords += seg if not coords else seg[1:]
            if nm:
                names.append(nm)
            ups.append(up or 0)
            edges.add((pl.snap(seg[0]), pl.snap(seg[-1])))
            cur = u
        km = dist[h] / 1000
        if km < 1.2:
            continue
        # 중복 억제: 기존 코스와 간선 70%+ 겹치면 제외
        if any(len(edges & e2) / max(1, len(edges)) > 0.7 for e2 in used_edges):
            continue
        used_edges.append(edges)
        # 코스명
        cnt = collections.Counter(names)
        if cnt:
            base = cnt.most_common(1)[0][0].replace("구간", "").strip()
            name = f"{base} 코스"
        else:
            n_auto += 1
            name = f"{mntn_nm} {n_auto}코스"
        prof = pl.profile48(coords, dem.elev)
        asc, desc = pl.ascent_descent(prof)
        feats.append({
            "type": "Feature",
            "geometry": {"type": "MultiLineString",
                         "coordinates": [[[round(x, 5), round(y, 5)] for x, y in coords]]},
            "properties": {
                "name": name, "difficulty": pl.DIFF_BY_ASCENT(asc),
                "distance_km": round(km, 2),
                "time_hr": round(sum(ups) / 60, 1) or None,
                "kind": "산림청 등산로(코스 추출)", "desc": f"들머리 → {mntn_nm} 정상",
                "profile": prof, "min_elev": min(prof), "max_elev": max(prof),
                "ascent": asc, "descent": desc,
            },
        })
        if len(feats) >= max_courses:
            break

    # 이름 중복 정리 (같은 동네 코스 여러 개면 번호)
    cnt = collections.Counter(f["properties"]["name"] for f in feats)
    seen_nm = collections.Counter()
    for f in feats:
        nm = f["properties"]["name"]
        if cnt[nm] > 1:
            seen_nm[nm] += 1
            f["properties"]["name"] = f"{nm} {seen_nm[nm]}"

    feats.sort(key=lambda f: -f["properties"]["distance_km"])
    return feats, mntn_nm


def main():
    code = sys.argv[1]
    slug = sys.argv[2]
    tifs = [a for a in sys.argv[3:] if a.endswith(".tif")]
    max_courses = int(sys.argv[-1]) if sys.argv[-1].isdigit() else 12

    if not tifs:  # bbox 기반 자동 확보
        import dem_cache
        segs, _ = pl.load_forest_segments(code)
        xs = [p[0] for s in segs for p in s["pts"]]
        ys = [p[1] for s in segs for p in s["pts"]]
        tifs = dem_cache.ensure([min(xs), min(ys), max(xs), max(ys)])

    dem = pl.Dem(tifs)
    feats, mntn_nm = extract_courses(code, dem, max_courses)

    out_r = os.path.join(pl.ROOT, "data", f"{slug}-routes.geojson")
    json.dump({"type": "FeatureCollection", "features": feats},
              open(out_r, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    sp = pl.load_forest_spots(code)
    if sp:
        out_s = os.path.join(pl.ROOT, "data", f"{slug}-spots.geojson")
        json.dump({"type": "FeatureCollection", "features": sp},
                  open(out_s, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    xs = [c[0] for f in feats for pr in f["geometry"]["coordinates"] for c in pr]
    ys = [c[1] for f in feats for pr in f["geometry"]["coordinates"] for c in pr]
    print(f"코스 {len(feats)}개 · 스팟 {len(sp)}개")
    print(f"bbox: [{min(xs)-0.01:.2f}, {min(ys)-0.01:.2f}, {max(xs)+0.01:.2f}, {max(ys)+0.01:.2f}]")
    for f in feats:
        p = f["properties"]
        print(f"  {p['name']:16} {p['difficulty']} {p['distance_km']}km ↑{p['ascent']}m {p['min_elev']}~{p['max_elev']}m")


if __name__ == "__main__":
    main()
