#!/usr/bin/env python3
"""로컬 Copernicus DEM(cache/dem) → 전국 terrain-RGB PMTiles (음영기복용).

산출: data/tiles/kr-terrain.pmtiles (raster-dem, mapbox 인코딩, z5~12, 256px PNG)
  - MapLibre hillshade 레이어의 소스. z12(≈38m/px)까지면 30m DEM 해상도에 부합,
    그 위 줌은 오버줌으로 자연스럽게 부드러워진다.
  - 바다는 고도 0 평면 → 음영 없음. DEM 타일이 아예 없는 해상 타일은 생략.

파이프라인: 타일별 (4326 모자이크 → 3857 재투영 256×256) → terrain-RGB PNG
  → MBTiles(sqlite) → tools/pmtiles convert → kr-terrain.pmtiles

실행: PYTHONPATH=scripts .venv/bin/python scripts/build_terrain.py
  (전국 z5~12 ≈ 9천 타일, 수 분 소요. 재실행 시 MBTiles 부터 다시 만든다)
"""
import io
import math
import os
import sqlite3
import subprocess
import sys
import time

import numpy as np
import rasterio
from rasterio.merge import merge
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEM_DIR = os.path.join(ROOT, "cache", "dem")
OUT_MB = os.path.join(ROOT, "cache", "kr-terrain.mbtiles")
OUT_PM = os.path.join(ROOT, "data", "tiles", "kr-terrain.pmtiles")
BBOX = (124.5, 33.0, 131.95, 38.7)   # 백령도~독도, 제주~접경
ZMIN, ZMAX = 5, 12
R_MERC = 6378137.0
MERC_MAX = math.pi * R_MERC


def tile_bounds_merc(z, x, y):
    n = 2 ** z
    size = 2 * MERC_MAX / n
    return (-MERC_MAX + x * size, MERC_MAX - (y + 1) * size,
            -MERC_MAX + (x + 1) * size, MERC_MAX - y * size)


def merc_to_lonlat(mx, my):
    lon = mx / MERC_MAX * 180.0
    lat = math.degrees(2 * math.atan(math.exp(my / R_MERC)) - math.pi / 2)
    return lon, lat


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def encode_rgb(elev):
    """mapbox terrain-rgb: elev = -10000 + v*0.1"""
    v = np.clip((elev + 10000.0) / 0.1, 0, 2 ** 24 - 1).astype(np.uint32)
    return np.dstack(((v >> 16) & 255, (v >> 8) & 255, v & 255)).astype(np.uint8)


def main():
    srcs = []
    for fn in sorted(os.listdir(DEM_DIR)):
        if fn.endswith(".tif"):
            ds = rasterio.open(os.path.join(DEM_DIR, fn))
            srcs.append((ds.bounds, ds))
    if not srcs:
        sys.exit("cache/dem 이 비어 있음 — dem_cache.py 프리페치 먼저")
    print(f"DEM 소스 {len(srcs)}개")

    if os.path.exists(OUT_MB):
        os.remove(OUT_MB)
    db = sqlite3.connect(OUT_MB)
    db.executescript("""
      CREATE TABLE metadata (name TEXT, value TEXT);
      CREATE TABLE tiles (zoom_level INT, tile_column INT, tile_row INT, tile_data BLOB);
      CREATE UNIQUE INDEX t ON tiles (zoom_level, tile_column, tile_row);
    """)
    for k, v in {"name": "kr-terrain", "format": "png", "type": "baselayer",
                 "encoding": "mapbox",
                 "minzoom": str(ZMIN), "maxzoom": str(ZMAX),
                 "bounds": ",".join(map(str, BBOX)),
                 "description": "Korea terrain-RGB from Copernicus GLO-30"}.items():
        db.execute("INSERT INTO metadata VALUES (?, ?)", (k, v))

    total = written = 0
    t0 = time.time()
    for z in range(ZMIN, ZMAX + 1):
        x0, y0 = lonlat_to_tile(BBOX[0], BBOX[3], z)   # 좌상
        x1, y1 = lonlat_to_tile(BBOX[2], BBOX[1], z)   # 우하
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                total += 1
                w, s, e, n = tile_bounds_merc(z, x, y)
                lon0, lat0 = merc_to_lonlat(w, s)
                lon1, lat1 = merc_to_lonlat(e, n)
                pad = (lon1 - lon0) / 256 * 2           # 경계 보간 여유 2px
                gb = (lon0 - pad, lat0 - pad, lon1 + pad, lat1 + pad)
                hit = [ds for b, ds in srcs
                       if b.left < gb[2] and b.right > gb[0] and b.bottom < gb[3] and b.top > gb[1]]
                if not hit:
                    continue                             # DEM 없는 해상 타일
                res = (lon1 - lon0) / 256                # 타일 해상도에 맞춰 COG 오버뷰 활용
                try:
                    mosaic, tf = merge(hit, bounds=gb, res=res, nodata=0.0)
                except Exception:
                    continue
                src_arr = mosaic[0].astype("float32")
                dst = np.zeros((256, 256), dtype="float32")
                reproject(src_arr, dst,
                          src_transform=tf, src_crs="EPSG:4326",
                          dst_transform=from_bounds(w, s, e, n, 256, 256),
                          dst_crs="EPSG:3857", resampling=Resampling.bilinear,
                          src_nodata=None, dst_nodata=0.0)
                buf = io.BytesIO()
                Image.fromarray(encode_rgb(dst), "RGB").save(buf, "PNG", optimize=False)
                db.execute("INSERT INTO tiles VALUES (?, ?, ?, ?)",
                           (z, x, (2 ** z - 1) - y, buf.getvalue()))  # TMS y-flip
                written += 1
        db.commit()
        print(f"z{z} 완료 — 누적 {written}/{total} 타일 ({time.time()-t0:.0f}s)")
    db.commit(); db.close()

    os.makedirs(os.path.dirname(OUT_PM), exist_ok=True)
    if os.path.exists(OUT_PM):
        os.remove(OUT_PM)
    subprocess.run([os.path.join(ROOT, "tools", "pmtiles"), "convert", OUT_MB, OUT_PM], check=True)
    print(f"완료: {OUT_PM} ({os.path.getsize(OUT_PM)//1024//1024}MB, 타일 {written}개)")


if __name__ == "__main__":
    main()
