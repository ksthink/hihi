#!/usr/bin/env python3
"""전국 약수터 포인트 타일 생성 — 산림청 등산로 스팟 원본 → kr-spring.pmtiles.

산림청 `mountain/<코드>/PMNTN_SPOT_*.json` 의 `MANAGE_SP2 == "음수대"` 지점을 모은다
(전국 839개 · 357개 산, 2026-08-03 기준). 좌표는 EPSG:5186 → WGS84 로 변환(pack_lib).

산별 팩 스팟으로도 실을 수 있지만(pack_lib.SPOT_KEEP 에 "음수대" 포함), 그러면 **발행한
산에서만** 보인다. 약수터는 들머리 접근·하산길에서도 찾는 대상이라 버스정류장과 같은
방식으로 전 지역 타일로 얹는다(scripts/build_bus_tiles.py 와 같은 구조).

  레이어 "springs" · 속성 {name} · extent 4096 · z12~14 (15+ 는 오버줌)
  산출: data/tiles/kr-spring.pmtiles (+ R2 업로드는 --upload)

사용: .venv/bin/python scripts/build_spring_tiles.py [--upload]
"""
import argparse
import glob
import gzip
import json
import math
import os
import sqlite3
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pack_lib as pl  # noqa: E402

OUT = os.path.join(pl.ROOT, "data", "tiles", "kr-spring.pmtiles")
ZOOMS = (12, 13, 14)
EXTENT = 4096

# 산림청 시설 분류값. 데이터에는 "음수대" 하나로 들어오고 세부명(DETAIL_SPO)에
# "약수터"·"샘터"·"○○약수터" 등이 담긴다.
CATEGORY = "음수대"


def rows():
    """(이름, 위도, 경도) — 중복 좌표는 한 번만."""
    seen = set()
    for f in glob.glob(os.path.join(pl.ROOT, "mountain", "*", "PMNTN_SPOT_*.json")):
        try:
            with open(f, encoding="utf-8") as fh:
                d = json.load(fh)
        except (OSError, ValueError):
            continue
        for x in d.get("features") or []:
            a = x.get("attributes") or {}
            if a.get("MANAGE_SP2") != CATEGORY:
                continue
            g = x.get("geometry") or {}
            if "x" not in g or "y" not in g:
                continue
            try:
                lon, lat = pl.tm_to_wgs84(float(g["x"]), float(g["y"]))
            except (TypeError, ValueError):
                continue
            # 한국 영역 밖은 원본 오류로 보고 버린다(전량 검사에서는 0건이었다).
            if not (124.0 <= lon <= 132.0 and 33.0 <= lat <= 39.0):
                continue
            key = (round(lon, 6), round(lat, 6))
            if key in seen:
                continue
            seen.add(key)
            # 세부명이 있으면 그것을(예: "천수샘약수터"), 없으면 분류명을 라벨로.
            name = (a.get("DETAIL_SPO") or "").strip() or "약수터"
            # "음수대,안내판" 처럼 시설이 함께 적힌 경우가 있어 첫 항목만 쓴다.
            name = name.split(",")[0].strip() or "약수터"
            yield name, lat, lon


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
    print(f"약수터 {len(pts):,}개")
    if not pts:
        sys.exit("원본에서 약수터를 찾지 못했습니다 — mountain/ 데이터를 확인하세요.")

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
                "name": "springs",
                "features": [{"geometry": f"POINT({px} {py})",
                              "properties": {"name": nm}} for nm, px, py in feats],
            }], default_options={"extents": EXTENT})
            db.execute("INSERT INTO tiles VALUES (?,?,?,?)",
                       (z, tx, (2 ** z - 1) - ty, gzip.compress(data)))
        total += len(buckets)
        print(f"z{z}: 타일 {len(buckets):,}개")
    meta = {"name": "kr-spring", "format": "pbf", "minzoom": str(min(ZOOMS)),
            "maxzoom": str(max(ZOOMS)), "bounds": "124.5,33.0,132.0,39.5",
            "json": '{"vector_layers":[{"id":"springs","fields":{"name":"String"}}]}'}
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
        r2_lib.upload_file(OUT, "kr-spring.pmtiles")
        print("R2 업로드 완료: kr-spring.pmtiles")


if __name__ == "__main__":
    main()
