#!/usr/bin/env python3
"""산 3D 모형 자산 생성 — 높이맵(terrain-RGB PNG) + 흑백 텍스처(음영·등고선·코스).

3d.html 뷰어(three.js)가 소비하는 정적 파일 3개를 산별로 굽는다:
  data/3d/<산코드>/height.png   terrain-RGB 인코딩 높이맵 (h = -10000 + rgb*0.1)
  data/3d/<산코드>/texture.png  흑백 텍스처 — 음영기복 + 등고선(50m/250m) + 코스 라인
  data/3d/<산코드>/meta.json    bbox·실거리(m)·고도 범위

캔버스가 16bit PNG 를 8bit 로 뭉개므로 높이는 terrain-RGB(8bit RGB) 인코딩을 쓴다.
텍스처에 음영을 미리 굽고 뷰어는 무조명(MeshBasicMaterial)으로 그린다 — 흑백 카토그래피 유지.

사용: .venv/bin/python scripts/build_3d.py <산코드> [--grid 512] [--tex 1024]
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dem_cache  # noqa: E402
import draft_store  # noqa: E402
import pack_lib as pl  # noqa: E402

ROOT = pl.ROOT


def sample_grid(dem, bbox, n):
    """bbox 를 n×n 격자로 이중선형 샘플 (행 0 = 북쪽)."""
    import numpy as np
    tf, Z = dem.tf, dem.Z
    lons = np.linspace(bbox[0], bbox[2], n)
    lats = np.linspace(bbox[3], bbox[1], n)          # 북→남 (이미지 행 순서)
    col = (lons - tf.c) / tf.a
    row = (lats - tf.f) / tf.e
    c0 = np.clip(col.astype(int), 0, dem.W - 2)
    r0 = np.clip(row.astype(int), 0, dem.H - 2)
    fc = np.clip(col - c0, 0, 1)
    fr = (np.clip(row - r0, 0, 1))[:, None]
    g = (Z[np.ix_(r0, c0)] * (1 - fr) * (1 - fc) + Z[np.ix_(r0, c0 + 1)] * (1 - fr) * fc
         + Z[np.ix_(r0 + 1, c0)] * fr * (1 - fc) + Z[np.ix_(r0 + 1, c0 + 1)] * fr * fc)
    g[g < -1000] = 0.0                                # 보이드 → 해수면
    return g


def terrain_rgb(heights):
    """Mapbox terrain-RGB 인코딩 (0.1m 해상도, 캔버스 안전 8bit RGB)."""
    import numpy as np
    v = np.round((heights + 10000.0) / 0.1).astype(np.uint32)
    rgb = np.dstack([(v >> 16) & 255, (v >> 8) & 255, v & 255]).astype("uint8")
    return rgb


def hillshade(heights, cell_x_m, cell_y_m, azimuth=315.0, altitude=45.0):
    """수치 음영 [0..1] — 앱 hillshade 와 같은 북서광."""
    import numpy as np
    dy, dx = np.gradient(heights, cell_y_m, cell_x_m)
    slope = np.pi / 2 - np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(-dx, dy)
    az, alt = math.radians(azimuth), math.radians(altitude)
    sh = (math.sin(alt) * np.sin(slope)
          + math.cos(alt) * np.cos(slope) * np.cos(az - np.pi / 2 - aspect))
    return np.clip(sh, 0, 1)


def build_texture(heights, bbox, size, routes):
    """흑백 텍스처: 밝은 바탕 × 음영 + 등고선(50/250m) + 코스 검정 라인."""
    import numpy as np
    from PIL import Image, ImageDraw
    import contourpy

    n = heights.shape[0]
    lat_c = (bbox[1] + bbox[3]) / 2
    w_m = 111320.0 * math.cos(math.radians(lat_c)) * (bbox[2] - bbox[0])
    h_m = 110540.0 * (bbox[3] - bbox[1])
    sh = hillshade(heights, w_m / n, h_m / n)
    # 바탕 250 에 음영 승산(0.62~1.0) — 앱 흑백 톤과 유사한 대비
    gray = (250.0 * (0.62 + 0.38 * sh)).astype("uint8")
    img = Image.fromarray(np.dstack([gray, gray, gray]), "RGB").resize((size, size), Image.BILINEAR)
    draw = ImageDraw.Draw(img)

    def px(lon, lat):
        return ((lon - bbox[0]) / (bbox[2] - bbox[0]) * size,
                (bbox[3] - lat) / (bbox[3] - bbox[1]) * size)

    # 등고선 — 격자 좌표계(x=열, y=행)로 생성 후 픽셀로 스케일
    gen = contourpy.contour_generator(z=heights[::-1])  # contourpy 는 y 증가 방향 위쪽
    hmin, hmax = float(heights.min()), float(heights.max())
    scale = size / (n - 1)
    for lev in range(int(hmin // 50 + 1) * 50, int(hmax), 50):
        major = lev % 250 == 0
        col = 150 if major else 196
        for line in gen.lines(lev):
            pts = [(x * scale, (n - 1 - y) * scale) for x, y in line]
            if len(pts) > 1:
                draw.line(pts, fill=(col, col, col), width=2 if major else 1)

    # 코스 — 흰 케이싱 + 검정 본선 (모든 ready 코스)
    for feat in routes:
        for part in feat["geometry"]["coordinates"]:
            pts = [px(lon, lat) for lon, lat, *_ in part]
            if len(pts) < 2:
                continue
            draw.line(pts, fill=(255, 255, 255), width=7, joint="curve")
    for feat in routes:
        for part in feat["geometry"]["coordinates"]:
            pts = [px(lon, lat) for lon, lat, *_ in part]
            if len(pts) < 2:
                continue
            draw.line(pts, fill=(17, 17, 17), width=3, joint="curve")
    return img, w_m, h_m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("code")
    ap.add_argument("--grid", type=int, default=512)
    ap.add_argument("--tex", type=int, default=1024)
    args = ap.parse_args()

    d = draft_store.load(args.code)
    if not d:
        sys.exit(f"draft 없음: {args.code}")
    m = d["mountain"]
    bbox = m["bbox"]
    print(f"{m['name']} ({args.code}) bbox={bbox}")

    tifs = dem_cache.ensure(bbox)
    dem = pl.Dem(tifs, bounds=(bbox[0], bbox[1], bbox[2], bbox[3]))
    heights = sample_grid(dem, bbox, args.grid)
    print(f"고도 {heights.min():.0f}~{heights.max():.0f}m, 격자 {args.grid}²")

    routes_p = os.path.join(ROOT, "data", "packs", args.code, "routes.geojson")
    routes = []
    if os.path.exists(routes_p):
        routes = json.load(open(routes_p, encoding="utf-8"))["features"]
    else:
        fc, _ = draft_store.to_pack(d)                # 발행본 없으면 draft 에서 직접
        routes = fc["features"]
    print(f"코스 {len(routes)}개")

    from PIL import Image
    out = os.path.join(ROOT, "data", "3d", args.code)
    os.makedirs(out, exist_ok=True)
    Image.fromarray(terrain_rgb(heights), "RGB").save(os.path.join(out, "height.png"))
    tex, w_m, h_m = build_texture(heights, bbox, args.tex, routes)
    tex.save(os.path.join(out, "texture.png"))
    meta = {"code": args.code, "name": m["name"], "elev": m.get("elev"),
            "bbox": bbox, "size_m": [round(w_m), round(h_m)], "grid": args.grid,
            "elev_min": round(float(heights.min())), "elev_max": round(float(heights.max()))}
    json.dump(meta, open(os.path.join(out, "meta.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    for f in ("height.png", "texture.png", "meta.json"):
        print(f"  {f}: {os.path.getsize(os.path.join(out, f)):,}B")


if __name__ == "__main__":
    main()
