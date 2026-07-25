#!/usr/bin/env python3
"""하이하잇 팩 파이프라인 공용 라이브러리.

build_forest_pack.py 에서 추출한 재사용 함수들 — 관리자 콘솔(admin_server)과
CLI 스크립트가 함께 사용한다. 수치 동작은 기존 build_forest_pack 과 동일해야 한다
(청계산 재빌드 diff 무변화가 회귀 기준).

- 좌표: EPSG:5186(GRS80 TM 중부원점) → WGS84
- 산림청 원본: mountain/<산코드>/PMNTN_*.json (구간), PMNTN_SPOT_*.json (스팟)
"""
import collections
import glob
import heapq
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── EPSG:5186 → WGS84 (GRS80 TM, 중부원점) ──
A = 6378137.0
F = 1 / 298.257222101
E2 = 2 * F - F * F
EP2 = E2 / (1 - E2)
LAT0, LON0 = math.radians(38.0), math.radians(127.0)
K0, FE, FN = 1.0, 200000.0, 600000.0


def _marc(p):
    return A * ((1 - E2/4 - 3*E2**2/64 - 5*E2**3/256) * p
                - (3*E2/8 + 3*E2**2/32 + 45*E2**3/1024) * math.sin(2*p)
                + (15*E2**2/256 + 45*E2**3/1024) * math.sin(4*p)
                - (35*E2**3/3072) * math.sin(6*p))


M0 = _marc(LAT0)


def tm_to_wgs84(E, N):
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
    return (round(math.degrees(lon), 6), round(math.degrees(lat), 6))


def hav(a, b):
    R = 6371000
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dla, dlo = la2 - la1, math.radians(b[0] - a[0])
    return 2 * R * math.asin(math.sqrt(math.sin(dla/2)**2 +
                                       math.cos(la1)*math.cos(la2)*math.sin(dlo/2)**2))


snap = lambda p: (round(p[0], 4), round(p[1], 4))  # ≈11m 격자로 노드 스냅
blank = lambda v: not v or not str(v).strip()
DIFF_BY_ASCENT = lambda a: "초급" if a < 400 else ("중급" if a < 800 else "고급")

# 스팟 채택 분류 (산림청 MANAGE_SP2)
SPOT_KEEP = ("분기점", "시종점", "정상", "조망점", "음수대", "화장실", "정자", "주차장", "헬기장")


def naismith_time(km, ascent_m):
    """네이스미스 법칙: 4km/h + 상승 600m 당 1h. (산림청 상행시간이 없을 때 폴백)"""
    return round(km / 4 + ascent_m / 600, 1)


# ── 산림청 원본 ──

def forest_files(code):
    """mountain/<산코드>/ 의 (구간 json, 스팟 json 목록, 산이름). 원본 없으면 (None, [], None)."""
    src_dir = os.path.join(ROOT, "mountain", code)
    routes = [f for f in glob.glob(os.path.join(src_dir, "PMNTN_*.json")) if "SPOT" not in f]
    spots = glob.glob(os.path.join(src_dir, "PMNTN_SPOT_*.json"))
    if not routes:
        return None, spots, None
    return routes[0], spots, os.path.basename(routes[0]).split("_")[1]


def load_forest_segments(code):
    """산림청 구간 원본 → [{pts(WGS84), name, up, godn, dffl, sn}]. 코스합성 이전의 raw 구간."""
    route_f, _, mntn_nm = forest_files(code)
    if not route_f:
        raise FileNotFoundError(f"mountain/{code}/ 에 PMNTN 구간 json 없음")
    d = json.load(open(route_f, encoding="utf-8"))
    segs = []
    for f in d["features"]:
        a = f["attributes"]
        for path in f["geometry"]["paths"]:
            pts = [tm_to_wgs84(x, y) for x, y in path]
            if len(pts) < 2:
                continue
            segs.append({
                "pts": pts,
                "name": (a.get("PMNTN_NM") or "").strip(),
                "up": a.get("PMNTN_UPPL") or 0,
                "godn": a.get("PMNTN_GODN") or 0,
                "dffl": (a.get("PMNTN_DFFL") or "").strip(),
                "sn": a.get("PMNTN_SN"),
            })
    return segs, mntn_nm


def build_graph(segments):
    """구간 목록 → 인접리스트 {node: [(nbr, 길이m, 구간geom, 구간명, 상행분)]}."""
    adj = collections.defaultdict(list)
    for s in segments:
        pts = s["pts"]
        u, v = snap(pts[0]), snap(pts[-1])
        L = sum(hav(p, q) for p, q in zip(pts, pts[1:]))
        adj[u].append((v, L, pts, s["name"], s["up"]))
        adj[v].append((u, L, list(reversed(pts)), s["name"], s["up"]))
    return adj


def load_forest_graph(code):
    """산림청 원본 → (adj, 산이름)."""
    segs, mntn_nm = load_forest_segments(code)
    return build_graph(segs), mntn_nm


def network_geojson(segments):
    """구간망 전체를 편집기 배경용 GeoJSON 으로."""
    feats = []
    for s in segments:
        km = sum(hav(p, q) for p, q in zip(s["pts"], s["pts"][1:])) / 1000
        feats.append({
            "type": "Feature",
            "geometry": {"type": "LineString",
                         "coordinates": [[round(x, 5), round(y, 5)] for x, y in s["pts"]]},
            "properties": {"sn": s["sn"], "name": s["name"] or None,
                           "dffl": s["dffl"] or None, "up_min": s["up"] or None,
                           "km": round(km, 2)},
        })
    return {"type": "FeatureCollection", "features": feats}


def largest_component(adj):
    """간선 총연장이 가장 큰 연결성분(노드 집합)."""
    seen, comps = set(), []
    for start in adj:
        if start in seen:
            continue
        comp, stack = set(), [start]
        while stack:
            n = stack.pop()
            if n in comp:
                continue
            comp.add(n)
            stack += [nb for nb, *_ in adj[n] if nb not in comp]
        seen |= comp
        comps.append(comp)
    return max(comps, key=lambda c: sum(w for n in c for _, w, *_ in adj[n]))


def dijkstra(adj, src):
    """src 기준 최단경로. → (dist{node: m}, prev{node: (parent, geom, 구간명, 상행분, w)})"""
    dist = {src: 0.0}
    prev = {}
    pq = [(0.0, src)]
    while pq:
        dd, u = heapq.heappop(pq)
        if dd > dist.get(u, 1e18):
            continue
        for v, w, geom, nm, up in adj[u]:
            nd = dd + w
            if nd < dist.get(v, 1e18):
                dist[v] = nd
                prev[v] = (u, geom, nm, up, w)
                heapq.heappush(pq, (nd, v))
    return dist, prev


def profile48(coords, elev_fn):
    """폴리라인 → 등간격 48pt 고도 프로파일 (기존 build 와 동일 로직)."""
    cum = [0.0]
    for p, q in zip(coords, coords[1:]):
        cum.append(cum[-1] + hav(p, q))
    prof = []
    j = 0
    for i in range(48):
        dd = cum[-1] * i / 47
        while j < len(cum)-1 and cum[j+1] < dd:
            j += 1
        prof.append(int(round(elev_fn(*coords[min(j, len(coords)-1)]))))
    return prof


def ascent_descent(prof):
    asc = sum(max(0, prof[i+1]-prof[i]) for i in range(len(prof)-1))
    desc = sum(max(0, prof[i]-prof[i+1]) for i in range(len(prof)-1))
    return int(asc), int(desc)


def elev_along(coords, elev_fn, step_m=25.0):
    """트랙(이미 조밀 리샘플됨)을 step_m 간격으로 재표본해 고도 시퀀스 반환.
    DEM 격자(~30m)보다 촘촘히 뽑으면 이중선형보간 잔물결이 상승에 누적되므로
    격자 수준으로만 표본한다(과대추정 방지). 양 끝점은 항상 포함."""
    if len(coords) < 2:
        return [elev_fn(*coords[0])] if coords else []
    out = [elev_fn(*coords[0])]
    acc = 0.0
    for p, q in zip(coords, coords[1:]):
        acc += hav(p, q)
        if acc >= step_m:
            out.append(elev_fn(*q))
            acc = 0.0
    if acc > 1e-6:                       # 마지막 자투리 구간의 끝점 보장
        out.append(elev_fn(*coords[-1]))
    return out


def profile_from_track(pts, n=48, smooth_win=5):
    """(lon,lat,ele) 트랙 → 등거리 n점 고도(표시 스파이크용). GPX 자체 고도 사용.
    원 해상도에서 이동평균(smooth_win)으로 GPS 고주파 잡음 완화 — 지도앱 export 처럼
    이미 매끈한 값엔 영향이 거의 없고, 실제 봉우리는 여러 점에 걸쳐 있어 보존된다."""
    eles = smooth_series([p[2] for p in pts], smooth_win)
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + hav(a[:2], b[:2]))
    total = cum[-1] or 1.0
    out, j = [], 0
    for i in range(n):
        dd = total * i / (n - 1)
        while j < len(cum) - 1 and cum[j+1] < dd:
            j += 1
        out.append(int(round(eles[min(j, len(pts)-1)])))
    return out


def ele_series_by_dist(pts, step_m=25.0):
    """(lon,lat,ele) 트랙을 step_m 간격으로 재표본한 고도 시퀀스(누적상승용)."""
    if len(pts) < 2:
        return [pts[0][2]] if pts else []
    out = [pts[0][2]]
    acc = 0.0
    for a, b in zip(pts, pts[1:]):
        acc += hav(a[:2], b[:2])
        if acc >= step_m:
            out.append(b[2])
            acc = 0.0
    if acc > 1e-6:
        out.append(pts[-1][2])
    return out


def smooth_series(xs, win=3):
    """1차원 이동평균 — 실측(기압계/GPS) 고도의 뾰족 잡음 완화."""
    if len(xs) <= win:
        return list(xs)
    h = win // 2
    return [sum(xs[max(0, i-h):min(len(xs), i+h+1)]) / (min(len(xs), i+h+1) - max(0, i-h))
            for i in range(len(xs))]


def cum_gain(elevs, thresh=3.0):
    """소임계값(히스테리시스) 누적 상승/하강 — DEM·GPS 잡음이 상승고도로 새는 것 차단.
    마지막 확정점(ref) 대비 변동이 thresh 초과할 때만 반영하되, 연속 완경사도
    ref 대비 누적이라 정상 집계된다(그냥 전 구간 합산의 과대추정을 막는 표준 기법)."""
    if len(elevs) < 2:
        return 0, 0
    asc = desc = 0.0
    ref = elevs[0]
    for e in elevs[1:]:
        d = e - ref
        if d > thresh:
            asc += d; ref = e
        elif d < -thresh:
            desc += -d; ref = e
    return int(round(asc)), int(round(desc))


def load_forest_spots(code, keep=SPOT_KEEP):
    """산림청 스팟 → Feature 목록. keep=None 이면 전 분류(관리자 편집용)."""
    _, spot_f, _ = forest_files(code)
    if not spot_f:
        return []
    sd = json.load(open(spot_f[0], encoding="utf-8"))
    sp = []
    for f in sd["features"]:
        a, g = f["attributes"], f.get("geometry")
        if not g:
            continue
        cat = (a.get("MANAGE_SP2") or "").strip()
        if keep is not None and cat not in keep:
            continue
        sp.append({"type": "Feature",
                   "geometry": {"type": "Point", "coordinates": list(tm_to_wgs84(g["x"], g["y"]))},
                   "properties": {"id": a.get("PMNTN_SPOT"), "category": cat,
                                  "detail": None if blank(a.get("DETAIL_SPO")) else a["DETAIL_SPO"].strip(),
                                  "etc": None if blank(a.get("ETC_MATTER")) else a["ETC_MATTER"].strip()}})
    return sp


class Dem:
    """Copernicus GLO-30 GeoTIFF 모자이크 + 이중선형보간 고도 조회."""

    def __init__(self, tifs, bounds=None):
        import rasterio
        from rasterio.merge import merge
        srcs = [rasterio.open(t) for t in tifs]
        mosaic, self.tf = merge(srcs, bounds=bounds) if bounds else merge(srcs)
        self.Z = mosaic[0].astype("float64")
        self.H, self.W = self.Z.shape
        for s in srcs:
            s.close()

    def elev(self, lon, lat):
        tf, Z = self.tf, self.Z
        col = (lon - tf.c) / tf.a
        row = (lat - tf.f) / tf.e
        r0, c0 = int(row), int(col)
        if r0 < 0 or c0 < 0 or r0 >= self.H-1 or c0 >= self.W-1:
            return 0.0
        fr, fc = row - r0, col - c0
        v = (Z[r0, c0]*(1-fr)*(1-fc) + Z[r0, c0+1]*(1-fr)*fc +
             Z[r0+1, c0]*fr*(1-fc) + Z[r0+1, c0+1]*fr*fc)
        return float(v) if v > -1000 else 0.0
