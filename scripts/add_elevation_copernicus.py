#!/usr/bin/env python3
"""등산로 GeoJSON 코스에 고도 정보 주입 (Copernicus GLO-30 DEM 샘플링).

각 코스(MultiLineString)를 거리순으로 이어 48지점 고도 프로파일 + min/max/ascent/descent 계산.
등반 카드·목록 미니그래프(app.js profileSVG/updateClimb)가 이 값을 사용.

사용: (venv: rasterio, numpy)
  python3 scripts/add_elevation_copernicus.py <routes.geojson> <tif...>
"""
import json
import math
import sys

import numpy as np
import rasterio
from rasterio.merge import merge

N = 48


def hav(a, b):
    R = 6371000
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dla, dlo = la2 - la1, math.radians(b[0] - a[0])
    return 2 * R * math.asin(math.sqrt(math.sin(dla / 2) ** 2 +
                                       math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2))


def main():
    path = sys.argv[1]
    tifs = sys.argv[2:]
    srcs = [rasterio.open(t) for t in tifs]
    Z, tf = merge(srcs)
    Z = Z[0].astype("float64")
    h, w = Z.shape

    def elev(lon, lat):
        col = (lon - tf.c) / tf.a
        row = (lat - tf.f) / tf.e
        r0, c0 = int(math.floor(row)), int(math.floor(col))
        if r0 < 0 or c0 < 0 or r0 >= h - 1 or c0 >= w - 1:
            return None
        fr, fc = row - r0, col - c0
        v = (Z[r0, c0] * (1 - fr) * (1 - fc) + Z[r0, c0 + 1] * (1 - fr) * fc +
             Z[r0 + 1, c0] * fr * (1 - fc) + Z[r0 + 1, c0 + 1] * fr * fc)
        return v if v > -1000 else None

    fc = json.load(open(path, encoding="utf-8"))
    for f in fc["features"]:
        # MultiLineString 파트를 순서대로 이어 하나의 경로로
        pts = [p for part in f["geometry"]["coordinates"] for p in part]
        if len(pts) < 2:
            continue
        # 누적거리
        cum = [0.0]
        for a, b in zip(pts, pts[1:]):
            cum.append(cum[-1] + hav(a, b))
        total = cum[-1] or 1
        # 48 등간격 지점 고도 샘플
        prof = []
        j = 0
        for i in range(N):
            d = total * i / (N - 1)
            while j < len(cum) - 1 and cum[j + 1] < d:
                j += 1
            e = elev(*pts[min(j, len(pts) - 1)])
            prof.append(int(round(e)) if e is not None else (prof[-1] if prof else 0))
        asc = sum(max(0, prof[i + 1] - prof[i]) for i in range(N - 1))
        desc = sum(max(0, prof[i] - prof[i + 1]) for i in range(N - 1))
        p = f["properties"]
        p["profile"] = prof
        p["min_elev"] = min(prof)
        p["max_elev"] = max(prof)
        p["ascent"] = int(asc)
        p["descent"] = int(desc)

    json.dump(fc, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"고도 주입 완료: {len(fc['features'])}개 코스 → {path}")
    for f in fc["features"][:5]:
        p = f["properties"]
        print(f"  {p['name'][:26]:26} {p['min_elev']}~{p['max_elev']}m ↑{p['ascent']}m")
    for s in srcs:
        s.close()


if __name__ == "__main__":
    main()
