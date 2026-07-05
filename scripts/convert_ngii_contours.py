#!/usr/bin/env python3
"""국토지리정보원 수치지형도 등고선(N3L_F0010000, Shapefile EPSG:5179 UTM-K)
→ 특정 산 bbox 로 클립 + WGS84 GeoJSON 변환.

출력 스키마(기존 등고선과 호환): properties { elev, idx }
  idx 2 = 주곡선/index (100m 배수) — 굵게 + 라벨
  idx 1 = 계곡선 (25m 배수)       — 중간
  idx 0 = 주곡선 세부 (그 외 5m)  — 가늘게, 고배율에서만

CONT = 등고선 고도(m), 5m 간격. DIVI(CTD001/002)는 참고만.

사용: (venv 에 pyshp 필요)
  python3 scripts/convert_ngii_contours.py <shp> <out.geojson> <minLon,minLat,maxLon,maxLat> [min_interval_m]
예:
  python3 scripts/convert_ngii_contours.py "N3L_F0010000_서울/N3L_F0010000_11.shp" \
    data/bukhansan-contours.geojson 126.90,37.59,127.06,37.75 5
"""
import glob
import json
import math
import os
import sys

import shapefile  # pyshp

# EPSG:5179 (Korea 2000 / Unified, UTM-K): lat0=38 lon0=127.5 k0=0.9996 FE=1e6 FN=2e6, GRS80
A = 6378137.0
F = 1 / 298.257222101
E2 = 2 * F - F * F
EP2 = E2 / (1 - E2)
LAT0, LON0 = math.radians(38.0), math.radians(127.5)
K0, FE, FN = 0.9996, 1_000_000.0, 2_000_000.0


def _marc(p):
    return A * ((1 - E2/4 - 3*E2**2/64 - 5*E2**3/256) * p
                - (3*E2/8 + 3*E2**2/32 + 45*E2**3/1024) * math.sin(2*p)
                + (15*E2**2/256 + 45*E2**3/1024) * math.sin(4*p)
                - (35*E2**3/3072) * math.sin(6*p))


M0 = _marc(LAT0)


def to_wgs84(E, N):
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
    return [round(math.degrees(lon), 6), round(math.degrees(lat), 6)]


def simplify(pts, tol):
    """Douglas-Peucker 단순화 (경위도 degree 단위 tol). 등고선 정점 과밀 제거."""
    if len(pts) < 3:
        return pts
    dmax, idx = 0.0, 0
    x1, y1 = pts[0]
    x2, y2 = pts[-1]
    dx, dy = x2 - x1, y2 - y1
    denom = math.hypot(dx, dy) or 1e-12
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        d = abs(dy * px - dx * py + x2 * y1 - y2 * x1) / denom
        if d > dmax:
            dmax, idx = d, i
    if dmax > tol:
        return simplify(pts[:idx + 1], tol)[:-1] + simplify(pts[idx:], tol)
    return [pts[0], pts[-1]]


def idx_of(elev):
    e = int(round(elev))
    if e % 100 == 0:
        return 2
    if e % 25 == 0:
        return 1
    return 0


def main():
    shp = sys.argv[1]
    out = sys.argv[2]
    minlon, minlat, maxlon, maxlat = map(float, sys.argv[3].split(","))
    min_iv = int(sys.argv[4]) if len(sys.argv) > 4 else 5
    tol = float(sys.argv[5]) if len(sys.argv) > 5 else 0.00004  # ≈4m 단순화
    inside = lambda p: minlon <= p[0] <= maxlon and minlat <= p[1] <= maxlat
    prec = lambda p: [round(p[0], 5), round(p[1], 5)]

    r = shapefile.Reader(shp, encoding="cp949")
    flds = [f[0] for f in r.fields[1:]]
    ci = flds.index("CONT")

    feats = 0
    kept = 0
    out_feats = []
    for sr in r.iterShapeRecords():
        elev = sr.record[ci]
        if not isinstance(elev, (int, float)):
            continue
        if int(round(elev)) % min_iv != 0:
            continue
        feats += 1
        sh = sr.shape
        parts = list(sh.parts) + [len(sh.points)]
        idx = idx_of(elev)
        runs = []
        for a, b in zip(parts, parts[1:]):
            wgs = [to_wgs84(x, y) for x, y in sh.points[a:b]]
            # bbox 안쪽 연속 구간만 추출 (경계 밖은 잘라냄)
            run = []
            for pt in wgs:
                if inside(pt):
                    run.append(pt)
                elif len(run) >= 2:
                    runs.append(run); run = []
                else:
                    run = []
            if len(run) >= 2:
                runs.append(run)
        # 단순화 + 좌표 정밀도 축소
        runs = [[prec(p) for p in simplify(run, tol)] for run in runs]
        runs = [run for run in runs if len(run) >= 2]
        if runs:
            kept += 1
            out_feats.append({
                "type": "Feature",
                "geometry": {"type": "MultiLineString", "coordinates": runs},
                "properties": {"elev": int(round(elev)), "idx": idx},
            })

    json.dump({"type": "FeatureCollection", "features": out_feats},
              open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    sz = os.path.getsize(out)
    print(f"입력 {len(r)}개 → 간격 {min_iv}m 통과 {feats}개 → bbox 클립 {kept}개")
    print(f"출력 {out}  {sz//1024}KB")
    from collections import Counter
    print("idx 분포:", dict(Counter(f['properties']['idx'] for f in out_feats)))
    elevs = [f['properties']['elev'] for f in out_feats]
    if elevs:
        print(f"고도 범위: {min(elevs)}~{max(elevs)}m")


if __name__ == "__main__":
    main()
