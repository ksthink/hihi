#!/usr/bin/env python3
"""국립공원공단 탐방로 공간데이터 API → 공식 등산코스 GeoJSON.

공원사무소코드로 서버 필터해 해당 국립공원만 받고, 코스ID 로 묶어 코스 선(MultiLineString)을 만든다.
- 정점(vertex) 단위 초고해상도 데이터 → shapely 로 단순화(~5m)
- 코스명 = 탐방코스(한글) (예: '사기막골입구 ~ 백운대'), 난이도 = 난이도(숫자)→초급/중급/고급

사용: (venv: shapely)
  python3 scripts/convert_knps_courses.py <공원사무소코드> <out.geojson> <minLon,minLat,maxLon,maxLat> [min_km]
  # 북한산 1501, 설악산 401 · min_km(기본 3.0): 이 거리 미만의 짧은 연결로/샛길은 제외(주요 코스 큐레이션)
"""
import json
import sys
import time
import urllib.parse
import urllib.request

import math

from shapely.geometry import LineString


def _hav(a, b):
    R = 6371000
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dla, dlo = la2 - la1, math.radians(b[0] - a[0])
    return 2 * R * math.asin(math.sqrt(math.sin(dla / 2) ** 2 +
                                       math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2))


def _split_gaps(pts, gap_m=150):
    """정점 간 거리가 gap_m 초과면 끊어 여러 런으로 분리 (거짓 직선 제거)."""
    runs, run = [], [pts[0]]
    for prev, cur in zip(pts, pts[1:]):
        if _hav(prev, cur) > gap_m:
            if len(run) >= 2:
                runs.append(run)
            run = [cur]
        else:
            run.append(cur)
    if len(run) >= 2:
        runs.append(run)
    return runs

KEY = None
for line in open("/home/ubuntu/hihi/.env"):
    if line.startswith("KNPS_KEY="):
        KEY = line.split("=", 1)[1].strip()
BASE = "https://api.odcloud.kr/api/15003467/v1/uddi:33b2e50e-6039-4649-a9da-8d5b89180b78_201709281349"
PER = 5000
SIMP = 0.00005  # ≈5m


def _get(page, per, cond):
    p = {"page": page, "perPage": per, "serviceKey": KEY, "returnType": "JSON",
         "cond[공원사무소코드::EQ]": cond}
    q = urllib.parse.urlencode(p)
    for a in range(5):
        try:
            with urllib.request.urlopen(BASE + "?" + q, timeout=90) as r:
                d = json.load(r)
            if isinstance(d.get("data"), list):
                return d
        except Exception:
            pass
        time.sleep(1.0 * (a + 1))
    return None


def fetch_park(cond):
    first = _get(1, 1, cond)
    total = first["matchCount"]
    pages = (total + PER - 1) // PER
    print(f"  공원사무소 {cond}: {total}점 · {pages}페이지", flush=True)
    rows = []

    def grab(page, per):
        d = _get(page, per, cond)
        if d is not None:
            return d["data"]
        if per <= 200:
            print(f"    ⚠️ page {page}@{per} 스킵", flush=True)
            return []
        sub = per // 5
        out = []
        for q in range((page - 1) * 5 + 1, page * 5 + 1):
            out += grab(q, sub)
        return out

    for p in range(1, pages + 1):
        rows += grab(p, PER)
        time.sleep(0.1)
    return rows


def diff_label(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return "중급"
    return "초급" if v < 1.8 else "중급" if v < 2.5 else "고급"


def build(rows, bbox, min_km=3.0):
    minlon, minlat, maxlon, maxlat = bbox
    inb = lambda lo, la: minlon <= lo <= maxlon and minlat <= la <= maxlat
    # 코스ID -> 일련번호 -> [ (경도,위도) ...]  (행 순서 = 정점 순서)
    courses = {}
    for r in rows:
        nm = (r.get("탐방코스(한글)") or "").strip()
        cid = r.get("코스ID")
        if not nm or nm == "비매칭코스" or cid in (None, 0, "0"):
            continue
        try:
            lo, la = float(r["경도"]), float(r["위도"])
        except (TypeError, ValueError):
            continue
        c = courses.setdefault(cid, {"name": nm, "segs": {}, "diff": [], "dist": {}, "time": {}})
        seg = r.get("일련번호")
        c["segs"].setdefault(seg, []).append((lo, la))
        c["diff"].append(r.get("난이도"))
        try:
            c["dist"][seg] = float(r.get("GIS 상 거리(m)") or 0)
            c["time"][seg] = float(r.get("가는시간(분)") or 0)
        except (TypeError, ValueError):
            pass

    feats = []
    for cid, c in courses.items():
        parts = []
        for seg in sorted(c["segs"], key=lambda s: int(s) if str(s).isdigit() else 0):
            pts = c["segs"][seg]
            if len(pts) < 2:
                continue
            for run in _split_gaps(pts):  # 큰 점프 지점에서 끊어 거짓 직선 제거
                g = LineString(run).simplify(SIMP)
                coords = [[round(x, 5), round(y, 5)] for x, y in g.coords]
                if len(coords) >= 2:
                    parts.append(coords)
        if not parts:
            continue
        # bbox 교차 코스만 (지도 범위 밖 코스 제외)
        if not any(inb(x, y) for pr in parts for x, y in pr):
            continue
        dist_km = round(sum(c["dist"].values()) / 1000, 2)
        if dist_km < min_km:  # 짧은 연결로/샛길 제외 (주요 코스 큐레이션)
            continue
        diffs = [float(d) for d in c["diff"] if _num(d)]
        time_hr = round(sum(c["time"].values()) / 60, 1)
        feats.append({
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": parts},
            "properties": {
                "name": c["name"],
                "difficulty": diff_label(sum(diffs) / len(diffs) if diffs else None),
                "distance_km": dist_km or None,
                "time_hr": time_hr or None,
                "kind": "국립공원 탐방로",
                "desc": c["name"],
            },
        })
    feats.sort(key=lambda f: -(f["properties"]["distance_km"] or 0))
    return feats


def _num(v):
    try:
        float(v); return True
    except (TypeError, ValueError):
        return False


def main():
    cond = sys.argv[1]
    out = sys.argv[2]
    bbox = list(map(float, sys.argv[3].split(",")))
    min_km = float(sys.argv[4]) if len(sys.argv) > 4 else 3.0
    rows = fetch_park(cond)
    feats = build(rows, bbox, min_km)
    json.dump({"type": "FeatureCollection", "features": feats},
              open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    import os
    print(f"  → 코스 {len(feats)}개 · {os.path.getsize(out)//1024}KB · {out}")
    for f in feats[:15]:
        p = f["properties"]
        print(f"     {p['name'][:32]:32} {p['difficulty']} {p['distance_km']}km")


if __name__ == "__main__":
    main()
