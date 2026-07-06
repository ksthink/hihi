#!/usr/bin/env python3
"""Copernicus DEM GLO-30 (COG GeoTIFF) → 산 bbox 등고선 GeoJSON.

SRTM 대안: 무료·개방 라이선스(저장·번들 자유), 30m 이지만 void-filled 로 SRTM 보다 정밀·저노이즈.
타일 원천: AWS Open Data  s3://copernicus-dem-30m/ (무인증)

기존 make_contours.py 와 동일 스키마: properties { elev, idx(0=보조 50m, 1=주 100m) }.

사용: (venv 에 rasterio, contourpy, numpy, shapely)
  python3 scripts/make_contours_copernicus.py <out.geojson> <minLon,minLat,maxLon,maxLat> <tif...> [interval] [simplify_deg]
  (simplify_deg 기본 0.00003 ≈ 3m — shapely ring-aware 단순화. 0 이면 단순화 안 함)
"""
import json
import sys

import contourpy
import numpy as np
import rasterio
from rasterio.merge import merge
from shapely.geometry import LineString


def generate(out, bbox, tifs, interval=50, simp=0.00003, log=print):
    """bbox [minLon,minLat,maxLon,maxLat] 등고선 GeoJSON 생성 (publish_pack 에서 재사용)."""
    minlon, minlat, maxlon, maxlat = bbox
    srcs = [rasterio.open(t) for t in tifs]
    mosaic, tf = merge(srcs, bounds=(minlon, minlat, maxlon, maxlat))
    Z = mosaic[0].astype("float64")
    Z[Z < -1000] = np.nan  # nodata
    h, w = Z.shape
    # 픽셀 중심 좌표
    lons = tf.c + tf.a * (np.arange(w) + 0.5)
    lats = tf.f + tf.e * (np.arange(h) + 0.5)  # tf.e 음수(북→남)

    zmin, zmax = np.nanmin(Z), np.nanmax(Z)
    cg = contourpy.contour_generator(x=lons, y=lats, z=Z)

    feats = []
    lev = int(np.floor(zmin / interval) * interval)
    top = int(np.ceil(zmax / interval) * interval)
    while lev <= top:
        if lev > 0:
            for line in cg.lines(lev):
                if len(line) < 2:
                    continue
                g = LineString(line)
                if simp:
                    g = g.simplify(simp)  # ring-aware, 폐곡선 보존
                coords = [[round(x, 5), round(y, 5)] for x, y in g.coords]
                if len(coords) >= 2:
                    feats.append({
                        "type": "Feature",
                        "properties": {"elev": int(lev), "idx": 1 if lev % 100 == 0 else 0},
                        "geometry": {"type": "LineString", "coordinates": coords},
                    })
        lev += interval

    json.dump({"type": "FeatureCollection", "features": feats},
              open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    import os
    log(f"고도 {zmin:.0f}~{zmax:.0f}m · 간격 {interval}m · 단순화 {simp} · 등고선 {len(feats)}개 → {out} "
        f"({os.path.getsize(out)//1024}KB)")
    for s in srcs:
        s.close()
    return len(feats)


def main():
    out = sys.argv[1]
    minlon, minlat, maxlon, maxlat = map(float, sys.argv[2].split(","))
    # 마지막 인자가 숫자면 interval, 나머지는 tif
    args = sys.argv[3:]
    # 꼬리 인자 파싱: [interval(int)] [simplify_deg(float)]
    simp = 0.00003
    interval = 50
    while args and not args[-1].endswith(".tif"):
        v = args.pop()
        if "." in v:
            simp = float(v)
        else:
            interval = int(v)
    tifs = args
    generate(out, [minlon, minlat, maxlon, maxlat], tifs, interval, simp)


if __name__ == "__main__":
    main()
