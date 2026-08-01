#!/usr/bin/env python3
"""전국 버스정류장(공공데이터 CSV) → 산별 팩 스팟 주입.

원본: data/bus_stops.csv.gz — 컬럼 정류장명,위도,경도 (약 22.7만 개, UTF-8 변환본).
기저 타일(kr-base, z14까지)에는 bus_stop POI 가 아예 없어(원본이 고줌 전용) 이 경로로 보완한다.

발행 때 그 산의 "들머리 접근" 정류장만 골라 spots.geojson 에 '버스정류장' 분류로 추가한다
— 전국 22.7만 개를 앱에 내리지 않는다(README P1). 선정 규칙:
  ready 코스의 각 파트 시·종점에서 radius_m(기본 500m) 이내 → 가까운 순 cap(기본 20)개,
  같은 이름+좌표(1e-4°≈11m) 중복 제거. detail 에 "들머리 Nm" 표기.
"""
import csv
import gzip
import os

import pack_lib as pl

PATH = os.path.join(pl.ROOT, "data", "bus_stops.csv.gz")
_rows = None


def _load():
    global _rows
    if _rows is None:
        _rows = []
        if os.path.exists(PATH):
            with gzip.open(PATH, "rt", encoding="utf-8") as f:
                for r in csv.DictReader(f):
                    try:
                        _rows.append((r["정류장명"].strip(),
                                      float(r["위도"]), float(r["경도"])))
                    except (KeyError, ValueError, TypeError):
                        continue
    return _rows


def near_course_endpoints(routes_fc, radius_m=500.0, cap=20, log=print):
    """ready 코스 시·종점 근처 정류장 → 스팟 Feature 목록 (없으면 빈 리스트)."""
    rows = _load()
    if not rows:
        log("버스정류장 원본(data/bus_stops.csv.gz) 없음 — 건너뜀")
        return []
    ends = []
    for f in routes_fc["features"]:
        for part in f["geometry"]["coordinates"]:
            if len(part) >= 2:
                ends += [part[0], part[-1]]
    if not ends:
        return []
    # 시종점 범위 + 반경 여유의 사각 프리필터 → 하버사인 정밀 판정
    pad = radius_m / 111320.0 * 1.5
    lo0 = min(e[0] for e in ends) - pad
    lo1 = max(e[0] for e in ends) + pad
    la0 = min(e[1] for e in ends) - pad
    la1 = max(e[1] for e in ends) + pad
    hits = []
    for name, la, lo in rows:
        if not (lo0 <= lo <= lo1 and la0 <= la <= la1):
            continue
        d = min(pl.hav((lo, la), (e[0], e[1])) for e in ends)
        if d <= radius_m:
            hits.append((d, name, la, lo))
    hits.sort()
    feats, seen = [], set()
    for d, name, la, lo in hits:
        key = (name, round(la, 4), round(lo, 4))
        if key in seen:
            continue
        seen.add(key)
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lo, 6), round(la, 6)]},
            "properties": {"id": f"bus-{round(la * 1e5)}-{round(lo * 1e5)}",
                           "category": "버스정류장", "name": name,
                           "detail": f"들머리 {int(round(d))}m"},
        })
        if len(feats) >= cap:
            break
    log(f"버스정류장 {len(feats)}개 포함 (들머리 {int(radius_m)}m 이내 후보 {len(hits)}개)")
    return feats
