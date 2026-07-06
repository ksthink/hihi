#!/usr/bin/env python3
"""산림청 등산로 원본(mountain/<산코드>/) → 코스형 routes + spots GeoJSON (비국립공원용).

구간(segment) 데이터를 그래프로 잇고 DEM 으로 정상 노드를 찾아
"들머리 → 정상" 최단경로를 코스로 추출한다 (KNPS 미커버 산의 표준 파이프라인).
- 좌표: EPSG:5186 → WGS84
- 코스명: 경로가 지나는 산림청 구간명(PMNTN_NM, 동네구간) 최빈값 → "문원동 코스" 식.
  없으면 "<산이름> N코스".
- 난이도: DEM 누적상승 기준(<400 초급, <800 중급, 이상 고급)
- 중복 억제: 이미 채택된 코스와 경로(간선) 70% 이상 겹치면 제외

사용: (venv: rasterio, numpy)
  python3 scripts/build_forest_pack.py <산코드> <산이름영문slug> <DEM.tif...> [max_courses]
예:
  python3 scripts/build_forest_pack.py 412900401 cheonggyesan scratchpad/cop_E127.tif 12
출력: data/<slug>-routes.geojson, data/<slug>-spots.geojson (+bbox 출력)
"""
import collections
import glob
import heapq
import json
import math
import os
import sys

import numpy as np
import rasterio
from rasterio.merge import merge

# ── EPSG:5186 → WGS84 (GRS80 TM, 중부원점) ──
A = 6378137.0
F = 1 / 298.257222101
E2 = 2 * F - F * F
EP2 = E2 / (1 - E2)
LAT0, LON0 = math.radians(38.0), math.radians(127.0)
K0, FE, FN = 1.0, 200000.0, 600000.0


def _marc(p):
    return A * ((1 - E2/4 - 3*E2**2/64 - 5*E2**3/256) * p
                - (3*E2/8 + 3*E2**2/32 + 45*E2**3/1024) * math.sin(2*p)
                + (15*E2**2/256 + 45*E2**3/1024) * math.sin(4*p)
                - (35*E2**3/3072) * math.sin(6*p))


M0 = _marc(LAT0)


def tm_to_wgs84(E, N):
    M = M0 + (N - FN) / K0
    mu = M / (A * (1 - E2/4 - 3*E2**2/64 - 5*E2**3/256))
    e1 = (1 - math.sqrt(1 - E2)) / (1 + math.sqrt(1 - E2))
    p1 = (mu + (3*e1/2 - 27*e1**3/32) * math.sin(2*mu)
          + (21*e1**2/16 - 55*e1**4/32) * math.sin(4*mu)
          + (151*e1**3/96) * math.sin(6*mu) + (1097*e1**4/512) * math.sin(8*mu))
    s, c, t = math.sin(p1), math.cos(p1), math.tan(p1)
    C1, T1 = EP2*c*c, t*t
    N1 = A / math.sqrt(1 - E2*s*s)
    R1 = A * (1 - E2) / (1 - E2*s*s)**1.5
    D = (E - FE) / (N1 * K0)
    lat = p1 - (N1*t/R1) * (D**2/2 - (5+3*T1+10*C1-4*C1**2-9*EP2)*D**4/24
                            + (61+90*T1+298*C1+45*T1**2-252*EP2-3*C1**2)*D**6/720)
    lon = LON0 + (D - (1+2*T1+C1)*D**3/6
                  + (5-2*C1+28*T1-3*C1**2+8*EP2+24*T1**2)*D**5/120) / c
    return (round(math.degrees(lon), 6), round(math.degrees(lat), 6))


def hav(a, b):
    R = 6371000
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dla, dlo = la2 - la1, math.radians(b[0] - a[0])
    return 2 * R * math.asin(math.sqrt(math.sin(dla/2)**2 +
                                       math.cos(la1)*math.cos(la2)*math.sin(dlo/2)**2))


snap = lambda p: (round(p[0], 4), round(p[1], 4))  # ≈11m 격자로 노드 스냅
blank = lambda v: not v or not str(v).strip()
DIFF_BY_ASCENT = lambda a: "초급" if a < 400 else ("중급" if a < 800 else "고급")


def main():
    code = sys.argv[1]
    slug = sys.argv[2]
    tifs = [a for a in sys.argv[3:] if a.endswith(".tif")]
    max_courses = int(sys.argv[-1]) if sys.argv[-1].isdigit() else 12

    ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src_dir = os.path.join(ROOT, "mountain", code)
    route_f = [f for f in glob.glob(os.path.join(src_dir, "PMNTN_*.json")) if "SPOT" not in f][0]
    spot_f = glob.glob(os.path.join(src_dir, "PMNTN_SPOT_*.json"))
    mntn_nm = os.path.basename(route_f).split("_")[1]

    # ── DEM ──
    srcs = [rasterio.open(t) for t in tifs]
    Z, tf = merge(srcs)
    Z = Z[0].astype("float64")
    H, W = Z.shape

    def elev(lon, lat):
        col = (lon - tf.c) / tf.a
        row = (lat - tf.f) / tf.e
        r0, c0 = int(row), int(col)
        if r0 < 0 or c0 < 0 or r0 >= H-1 or c0 >= W-1:
            return 0.0
        fr, fc = row - r0, col - c0
        v = (Z[r0, c0]*(1-fr)*(1-fc) + Z[r0, c0+1]*(1-fr)*fc +
             Z[r0+1, c0]*fr*(1-fc) + Z[r0+1, c0+1]*fr*fc)
        return float(v) if v > -1000 else 0.0

    # ── 그래프 구축 ──
    d = json.load(open(route_f, encoding="utf-8"))
    adj = collections.defaultdict(list)   # node -> [(nbr, 길이m, 구간geom, 구간명, 상행분)]
    for f in d["features"]:
        a = f["attributes"]
        nm = (a.get("PMNTN_NM") or "").strip()
        up = a.get("PMNTN_UPPL") or 0
        for path in f["geometry"]["paths"]:
            pts = [tm_to_wgs84(x, y) for x, y in path]
            if len(pts) < 2:
                continue
            u, v = snap(pts[0]), snap(pts[-1])
            L = sum(hav(p, q) for p, q in zip(pts, pts[1:]))
            adj[u].append((v, L, pts, nm, up))
            adj[v].append((u, L, list(reversed(pts)), nm, up))

    # 최대 연결성분
    seen, comps = set(), []
    for start in adj:
        if start in seen:
            continue
        comp, stack = set(), [start]
        while stack:
            n = stack.pop()
            if n in comp:
                continue
            comp.add(n)
            stack += [nb for nb, *_ in adj[n] if nb not in comp]
        seen |= comp
        comps.append(comp)
    comp = max(comps, key=lambda c: sum(w for n in c for _, w, *_ in adj[n]))

    node_elev = {n: elev(*n) for n in comp}
    summit = max(comp, key=node_elev.get)
    print(f"{mntn_nm}: 노드 {len(comp)} · 정상 {node_elev[summit]:.0f}m @ {summit}")

    # ── 들머리 후보: 차수1 + 정상보다 200m 이상 낮음 + 정상에서 1km 이상 ──
    ends = [n for n in comp if len(adj[n]) == 1
            and node_elev[n] < node_elev[summit] - 200 and hav(n, summit) > 1000]
    ends.sort(key=lambda n: node_elev[n])
    heads = []
    for n in ends:  # 700m 간격 확보
        if all(hav(n, h) > 700 for h in heads):
            heads.append(n)

    # ── Dijkstra (정상 기준 1회) ──
    dist = {summit: 0.0}
    prev = {}
    pq = [(0.0, summit)]
    while pq:
        dd, u = heapq.heappop(pq)
        if dd > dist.get(u, 1e18):
            continue
        for v, w, geom, nm, up in adj[u]:
            nd = dd + w
            if nd < dist.get(v, 1e18):
                dist[v] = nd
                prev[v] = (u, geom, nm, up, w)
                heapq.heappush(pq, (nd, v))

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
            edges.add((snap(seg[0]), snap(seg[-1])))
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
        # 고도 프로파일 (48pt)
        cum = [0.0]
        for p, q in zip(coords, coords[1:]):
            cum.append(cum[-1] + hav(p, q))
        prof = []
        j = 0
        for i in range(48):
            dd = cum[-1] * i / 47
            while j < len(cum)-1 and cum[j+1] < dd:
                j += 1
            prof.append(int(round(elev(*coords[min(j, len(coords)-1)]))))
        asc = sum(max(0, prof[i+1]-prof[i]) for i in range(47))
        feats.append({
            "type": "Feature",
            "geometry": {"type": "MultiLineString",
                         "coordinates": [[[round(x, 5), round(y, 5)] for x, y in coords]]},
            "properties": {
                "name": name, "difficulty": DIFF_BY_ASCENT(asc),
                "distance_km": round(km, 2),
                "time_hr": round(sum(ups) / 60, 1) or None,
                "kind": "산림청 등산로(코스 추출)", "desc": f"들머리 → {mntn_nm} 정상",
                "profile": prof, "min_elev": min(prof), "max_elev": max(prof),
                "ascent": int(asc),
                "descent": int(sum(max(0, prof[i]-prof[i+1]) for i in range(47))),
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
    out_r = os.path.join(ROOT, "data", f"{slug}-routes.geojson")
    json.dump({"type": "FeatureCollection", "features": feats},
              open(out_r, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    # ── 스팟 ──
    n_sp = 0
    if spot_f:
        sd = json.load(open(spot_f[0], encoding="utf-8"))
        sp = []
        KEEP = ("분기점", "시종점", "정상", "조망점", "음수대", "화장실", "정자", "주차장", "헬기장")
        for f in sd["features"]:
            a, g = f["attributes"], f.get("geometry")
            if not g:
                continue
            cat = (a.get("MANAGE_SP2") or "").strip()
            if cat not in KEEP:
                continue
            sp.append({"type": "Feature",
                       "geometry": {"type": "Point", "coordinates": list(tm_to_wgs84(g["x"], g["y"]))},
                       "properties": {"id": a.get("PMNTN_SPOT"), "category": cat,
                                      "detail": None if blank(a.get("DETAIL_SPO")) else a["DETAIL_SPO"].strip(),
                                      "etc": None if blank(a.get("ETC_MATTER")) else a["ETC_MATTER"].strip()}})
        n_sp = len(sp)
        out_s = os.path.join(ROOT, "data", f"{slug}-spots.geojson")
        json.dump({"type": "FeatureCollection", "features": sp},
                  open(out_s, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    xs = [c[0] for f in feats for pr in f["geometry"]["coordinates"] for c in pr]
    ys = [c[1] for f in feats for pr in f["geometry"]["coordinates"] for c in pr]
    print(f"코스 {len(feats)}개 · 스팟 {n_sp}개")
    print(f"bbox: [{min(xs)-0.01:.2f}, {min(ys)-0.01:.2f}, {max(xs)+0.01:.2f}, {max(ys)+0.01:.2f}]")
    for f in feats:
        p = f["properties"]
        print(f"  {p['name']:16} {p['difficulty']} {p['distance_km']}km ↑{p['ascent']}m {p['min_elev']}~{p['max_elev']}m")
    for s in srcs:
        s.close()


if __name__ == "__main__":
    main()
