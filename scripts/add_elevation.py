#!/usr/bin/env python3
"""bukhansan-routes.geojson 의 각 코스에 SRTM DEM 으로 고도 정보를 추가한다.
properties 에 min_elev/max_elev/ascent/descent/profile(48) 를 넣는다. venv 파이썬."""
import json, sys, math
import numpy as np

def load_hgt(p):
    raw = open(p, "rb").read()
    n = int((len(raw) // 2) ** 0.5)
    return np.frombuffer(raw, dtype=">i2").astype("float32").reshape(n, n)

t126 = load_hgt("N37E126.hgt"); t127 = load_hgt("N37E127.hgt")
MOS = np.hstack([t126[:, :3600], t127])   # lon = 126 + c/3600
MOS[MOS < -1000] = np.nan
RN, CN = MOS.shape

def sample(lons, lats):
    c = (np.asarray(lons) - 126) * 3600.0
    r = (38 - np.asarray(lats)) * 3600.0
    c = np.clip(c, 0, CN - 1.001); r = np.clip(r, 0, RN - 1.001)
    c0 = np.floor(c).astype(int); r0 = np.floor(r).astype(int)
    fc = c - c0; fr = r - r0
    v00 = MOS[r0, c0]; v01 = MOS[r0, c0 + 1]; v10 = MOS[r0 + 1, c0]; v11 = MOS[r0 + 1, c0 + 1]
    top = v00 * (1 - fc) + v01 * fc; bot = v10 * (1 - fc) + v11 * fc
    return top * (1 - fr) + bot * fr

def hav(lon1, lat1, lon2, lat2):
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1); dl = math.radians(lon2 - lon1)
    x = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * R * math.asin(math.sqrt(x))

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "../data/bukhansan-routes.geojson"
    d = json.load(open(path, encoding="utf-8"))
    N = 48
    for f in d["features"]:
        g = f["geometry"]
        parts = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
        cum_d, cum_e, base = [], [], 0.0
        ascent = descent = 0.0
        for part in parts:
            lons = [p[0] for p in part]; lats = [p[1] for p in part]
            ev = sample(lons, lats)
            dif = np.diff(ev)
            ascent += float(dif[dif > 0].sum()); descent += float(-dif[dif < 0].sum())
            dd = 0.0
            for i in range(len(part)):
                if i > 0:
                    dd += hav(part[i-1][0], part[i-1][1], part[i][0], part[i][1])
                cum_d.append(base + dd); cum_e.append(float(ev[i]))
            base += dd
        cum_d = np.array(cum_d); cum_e = np.array(cum_e)
        if base <= 0:
            prof = [int(round(cum_e.mean()))] * N
        else:
            xs = np.linspace(0, base, N)
            prof = [int(round(v)) for v in np.interp(xs, cum_d, cum_e)]
        p = f["properties"]
        p["min_elev"] = int(round(float(np.nanmin(cum_e))))
        p["max_elev"] = int(round(float(np.nanmax(cum_e))))
        p["ascent"] = int(round(ascent))
        p["descent"] = int(round(descent))
        p["profile"] = prof
    json.dump(d, open(path, "w"), ensure_ascii=False)
    print(f"updated {len(d['features'])} courses with elevation")
    for f in sorted(d["features"], key=lambda x: -x["properties"]["max_elev"])[:6]:
        p = f["properties"]
        print(f"  최고 {p['max_elev']:>4}m  상승 {p['ascent']:>4}m  {p['name']}")

if __name__ == "__main__":
    main()
