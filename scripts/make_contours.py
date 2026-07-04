#!/usr/bin/env python3
"""SRTM DEM(N37E126/127) → 북한산 영역 등고선 GeoJSON.
venv 파이썬(numpy, contourpy)으로 실행."""
import json, sys
import numpy as np
import contourpy

def load_hgt(path):
    raw = open(path, "rb").read()
    n = int((len(raw) // 2) ** 0.5)
    return np.frombuffer(raw, dtype=">i2").astype("float32").reshape(n, n)  # row0=north

def blur(a):
    b = a.copy()
    b[1:-1, 1:-1] = (a[1:-1, 1:-1] + a[:-2, 1:-1] + a[2:, 1:-1] + a[1:-1, :-2] + a[1:-1, 2:]) / 5.0
    return b

def dp(pts, tol):
    # Douglas-Peucker (경위도 단순화)
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ab = b - a
    L2 = ab.dot(ab)
    if L2 == 0:
        d = np.hypot(*(pts - a).T)
    else:
        t = np.clip(((pts - a) @ ab) / L2, 0, 1)
        proj = a + t[:, None] * ab
        d = np.hypot(*(pts - proj).T)
    i = int(d.argmax())
    if d[i] > tol:
        left = dp(pts[:i + 1], tol)
        right = dp(pts[i:], tol)
        return np.vstack([left[:-1], right])
    return np.vstack([a, b])

def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "../data/bukhansan-contours.geojson"
    t126 = load_hgt("N37E126.hgt")
    t127 = load_hgt("N37E127.hgt")
    mos = np.hstack([t126[:, :3600], t127])  # lon 126 + c/3600, c=0..7199

    lon0, lon1, lat0, lat1 = 126.90, 127.08, 37.58, 37.76
    c0, c1 = round((lon0 - 126) * 3600), round((lon1 - 126) * 3600)
    r0, r1 = round((38 - lat1) * 3600), round((38 - lat0) * 3600)  # r0=north
    Z = mos[r0:r1, c0:c1].astype("float32")
    Z[Z < -1000] = np.nan
    Z = Z[::-1]                                   # 위도 오름차순
    Z = blur(blur(Z))                             # 노이즈 완화
    lons = 126 + np.arange(c0, c1) / 3600.0
    lats = (38 - np.arange(r0, r1) / 3600.0)[::-1]

    cg = contourpy.contour_generator(x=lons, y=lats, z=Z)
    zmin, zmax = np.nanmin(Z), np.nanmax(Z)
    step = 50
    levels = list(range(int(np.ceil(zmin / step)) * step, int(zmax) + 1, step))

    feats = []
    for lev in levels:
        for line in cg.lines(float(lev)):
            if len(line) < 2:
                continue
            s = dp(np.asarray(line, float), 0.00008)
            if len(s) < 2:
                continue
            coords = [[round(float(x), 5), round(float(y), 5)] for x, y in s]
            feats.append({"type": "Feature",
                          "properties": {"elev": int(lev), "idx": 1 if lev % 100 == 0 else 0},
                          "geometry": {"type": "LineString", "coordinates": coords}})

    fc = {"type": "FeatureCollection", "name": "bukhansan-contours",
          "properties": {"source": "SRTM 1-arcsec", "interval_m": step,
                         "bbox": [lon0, lat0, lon1, lat1]},
          "features": feats}
    json.dump(fc, open(out, "w"), ensure_ascii=False)
    print(f"levels {levels[0]}~{levels[-1]}m ({len(levels)}) | features {len(feats)} | "
          f"elev range {zmin:.0f}~{zmax:.0f}m")
    import os
    print("size:", os.path.getsize(out), "bytes")

if __name__ == "__main__":
    main()
