#!/usr/bin/env python3
"""전국 버스정류장 포인트 타일 생성 — data/bus_stops.csv.gz → kr-bus.pmtiles.

기저 타일(kr-base)에는 bus_stop POI 가 원천 부재(Protomaps 는 고줌 전용)라,
정류장 22.7만 개를 자체 포인트 벡터타일로 만들어 별도 소스(bus)로 얹는다.
지도 전체(산 부근 한정 아님)에서 z14 부터 표시 — 산별 팩 스팟 방식(폐기)을 대체.

  레이어 "stops" · 속성 {name} · extent 4096 · z12~14 (15+ 는 오버줌)
  산출: data/tiles/kr-bus.pmtiles (+ R2 업로드는 --upload)

사용: .venv/bin/python scripts/build_bus_tiles.py [--upload]
"""
import argparse
import csv
import gzip
import math
import os
import sqlite3
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pack_lib as pl  # noqa: E402

SRC = os.path.join(pl.ROOT, "data", "bus_stops.csv.gz")
OUT = os.path.join(pl.ROOT, "data", "tiles", "kr-bus.pmtiles")
ZOOMS = (12, 13, 14)
EXTENT = 4096


def rows():
    with gzip.open(SRC, "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                yield r["정류장명"].strip(), float(r["위도"]), float(r["경도"])
            except (KeyError, ValueError, TypeError):
                continue


def tile_of(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--upload", action="store_true")
    args = ap.parse_args()
    import mapbox_vector_tile

    pts = list(rows())
    print(f"정류장 {len(pts):,}개")

    # z별로 타일에 버킷팅 → MVT 인코딩 → mbtiles → go-pmtiles convert
    fd, mb = tempfile.mkstemp(suffix=".mbtiles")
    os.close(fd)
    os.unlink(mb)
    db = sqlite3.connect(mb)
    db.executescript(
        "CREATE TABLE metadata (name TEXT, value TEXT);"
        "CREATE TABLE tiles (zoom_level INT, tile_column INT, tile_row INT, tile_data BLOB);"
        "CREATE UNIQUE INDEX t ON tiles (zoom_level, tile_column, tile_row);")
    total = 0
    for z in ZOOMS:
        buckets = {}
        for name, lat, lon in pts:
            fx, fy = tile_of(lon, lat, z)
            tx, ty = int(fx), int(fy)
            px = int((fx - tx) * EXTENT)
            py = int((fy - ty) * EXTENT)
            buckets.setdefault((tx, ty), []).append(
                (name, px, EXTENT - py))         # 인코더는 y 위쪽 기준
        for (tx, ty), feats in buckets.items():
            data = mapbox_vector_tile.encode([{
                "name": "stops",
                "features": [{"geometry": f"POINT({px} {py})",
                              "properties": {"name": nm}} for nm, px, py in feats],
            }], default_options={"extents": EXTENT})
            db.execute("INSERT INTO tiles VALUES (?,?,?,?)",
                       (z, tx, (2 ** z - 1) - ty, gzip.compress(data)))
        total += len(buckets)
        print(f"z{z}: 타일 {len(buckets):,}개")
    meta = {"name": "kr-bus", "format": "pbf", "minzoom": str(min(ZOOMS)),
            "maxzoom": str(max(ZOOMS)), "bounds": "124.5,33.0,132.0,39.5",
            "json": '{"vector_layers":[{"id":"stops","fields":{"name":"String"}}]}'}
    db.executemany("INSERT INTO metadata VALUES (?,?)", meta.items())
    db.commit()
    db.close()

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    if os.path.exists(OUT):
        os.unlink(OUT)
    subprocess.run([os.path.join(pl.ROOT, "tools", "pmtiles"), "convert", mb, OUT], check=True)
    os.unlink(mb)
    print(f"생성: {OUT} ({os.path.getsize(OUT):,}B, 타일 {total:,}개)")

    if args.upload:
        import r2_lib
        r2_lib.upload_file(OUT, "kr-bus.pmtiles")
        print("R2 업로드 완료: kr-bus.pmtiles")


if __name__ == "__main__":
    main()
