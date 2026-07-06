#!/usr/bin/env python3
"""Copernicus GLO-30 DEM 타일 캐시 (cache/dem/, gitignored).

bbox 가 걸치는 1°×1° 타일을 계산해 없으면 AWS Open Data(무인증)에서 내려받는다.
  https://copernicus-dem-30m.s3.amazonaws.com/<타일명>/<타일명>.tif
바다 전용 타일은 존재하지 않음(404) → 건너뜀.

사용:
  from dem_cache import ensure
  tifs = ensure([126.98, 37.36, 127.09, 37.47])   # 로컬 경로 목록
CLI:
  .venv/bin/python scripts/dem_cache.py 126.98,37.36,127.09,37.47
"""
import math
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "cache", "dem")
S3 = "https://copernicus-dem-30m.s3.amazonaws.com"


def tile_name(lat, lon):
    ns = f"N{lat:02d}" if lat >= 0 else f"S{-lat:02d}"
    ew = f"E{lon:03d}" if lon >= 0 else f"W{-lon:03d}"
    return f"Copernicus_DSM_COG_10_{ns}_00_{ew}_00_DEM"


def tiles_for_bbox(bbox):
    """bbox [minLon, minLat, maxLon, maxLat] → [(lat, lon)] 1° 타일 목록."""
    minlon, minlat, maxlon, maxlat = bbox
    return [(la, lo)
            for la in range(math.floor(minlat), math.floor(maxlat) + 1)
            for lo in range(math.floor(minlon), math.floor(maxlon) + 1)]


def ensure(bbox, log=print):
    """bbox 커버 타일을 캐시 확보 후 로컬 경로 목록 반환."""
    os.makedirs(CACHE, exist_ok=True)
    paths = []
    for lat, lon in tiles_for_bbox(bbox):
        name = tile_name(lat, lon)
        path = os.path.join(CACHE, name + ".tif")
        if not os.path.exists(path):
            url = f"{S3}/{name}/{name}.tif"
            log(f"DEM 다운로드: {name}")
            try:
                tmp = path + ".part"
                urllib.request.urlretrieve(url, tmp)
                os.replace(tmp, path)
            except urllib.error.HTTPError as e:
                if e.code == 404:  # 바다 타일
                    log(f"  (해상 타일 없음 — 건너뜀: {name})")
                    continue
                raise
        paths.append(path)
    if not paths:
        raise RuntimeError(f"bbox {bbox} 를 커버하는 DEM 타일이 없음")
    return paths


if __name__ == "__main__":
    bbox = list(map(float, sys.argv[1].split(",")))
    for p in ensure(bbox):
        print(p)
