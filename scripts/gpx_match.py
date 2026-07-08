#!/usr/bin/env python3
"""GPX 트랙 → 산림청 구간망 맵매칭 → 코스 후보 (관리자 콘솔 코어).

알고리즘 (draft: tau=25m 스냅 임계, detour=1.6 우회 허용비):
 1. GPX 트랙포인트를 5m 간격으로 리샘플
 2. 공간 그리드(≈100m 셀)로 각 점을 구간망 간선에 최근접 투영 — d≤tau 면 matched
 3. matched/unmatched 런 분할 (3점 미만 요동은 이웃에 흡수)
 4. matched 런 → 투영점 폴리라인(구간망 위를 그대로 따라감, src="graph")
    unmatched 런(갭) → 양끝 투영점의 최근접 노드 간 Dijkstra 경로가
    GPX 갭 길이 × detour 이내면 그래프 경로(src="graph"),
    아니면 GPX 원 좌표 유지(src="gpx") — 산림청 데이터 부실 구간 보완(하이브리드)
 5. 스티칭 + 리포트(매칭률·최대이탈·fallback 목록)
 6. DEM 으로 profile48 / ascent / distance / naismith time / 난이도 초깃값
"""
import math
import os
import uuid
import xml.etree.ElementTree as ET

import dem_cache
import pack_lib as pl

RESAMPLE_M = 5.0
CELL = 0.001          # ≈ 90~110m
MIN_RUN = 3           # 이보다 짧은 런은 이웃에 흡수


# ── GPX 파싱 ──
def parse_gpx(raw):
    """raw bytes → (pts [[lon,lat],...], name|None). 네임스페이스 무시."""
    root = ET.fromstring(raw)
    pts, name = [], None
    for el in root.iter():
        tag = el.tag.rsplit("}", 1)[-1]
        if tag in ("trkpt", "rtept"):
            pts.append((float(el.attrib["lon"]), float(el.attrib["lat"])))
        elif tag == "name" and name is None and el.text and el.text.strip():
            name = el.text.strip()
    if len(pts) < 2:
        raise ValueError("GPX 에 트랙포인트가 2개 미만")
    return pts, name


def resample(pts, step=RESAMPLE_M):
    """5m 간격 리샘플 (정지 잡음·과밀 제거)."""
    out = [pts[0]]
    acc = 0.0
    for p, q in zip(pts, pts[1:]):
        d = pl.hav(p, q)
        if d < 1e-9:
            continue
        while acc + d >= step:
            t = (step - acc) / d
            x = p[0] + (q[0] - p[0]) * t
            y = p[1] + (q[1] - p[1]) * t
            out.append((x, y))
            p = (x, y)          # 남은 거리 재계산을 위해 p 를 이동
            d = pl.hav(p, q)
            acc = 0.0
        acc += d
    if pl.hav(out[-1], pts[-1]) > 1:
        out.append(pts[-1])
    return out


def smooth(pts, win=5):
    """이동평균 — GPS 좌우 요동 억제 (요동이 투영 폴리라인 길이를 부풀리는 것 방지)."""
    if len(pts) <= win:
        return pts
    h = win // 2
    out = []
    for i in range(len(pts)):
        a, b = max(0, i - h), min(len(pts), i + h + 1)
        out.append((sum(p[0] for p in pts[a:b]) / (b - a),
                    sum(p[1] for p in pts[a:b]) / (b - a)))
    return out


# ── 구간망 공간 인덱스 + 최근접 투영 ──
class Network:
    def __init__(self, segments):
        self.edges = [s["pts"] for s in segments]
        lat0 = segments[0]["pts"][0][1]
        self.kx = 111320.0 * math.cos(math.radians(lat0))
        self.ky = 110540.0
        self.grid = {}
        for ei, geom in enumerate(self.edges):
            for si in range(len(geom) - 1):
                (x1, y1), (x2, y2) = geom[si], geom[si + 1]
                for cx in range(int(min(x1, x2) / CELL), int(max(x1, x2) / CELL) + 1):
                    for cy in range(int(min(y1, y2) / CELL), int(max(y1, y2) / CELL) + 1):
                        self.grid.setdefault((cx, cy), []).append((ei, si))

    def _seg_dist(self, p, a, b):
        """점 p ↔ 선분 ab 최단거리(m)와 투영점."""
        px, py = (p[0] - a[0]) * self.kx, (p[1] - a[1]) * self.ky
        vx, vy = (b[0] - a[0]) * self.kx, (b[1] - a[1]) * self.ky
        L2 = vx * vx + vy * vy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, (px * vx + py * vy) / L2))
        qx, qy = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        dx, dy = px - vx * t, py - vy * t
        return math.hypot(dx, dy), (qx, qy)

    def nearest(self, p):
        """→ (dist_m, 투영점, edge_idx). 3×3 셀 탐색 (tau≤100m 커버)."""
        cx, cy = int(p[0] / CELL), int(p[1] / CELL)
        best = (1e18, None, None)
        for gx in range(cx - 1, cx + 2):
            for gy in range(cy - 1, cy + 2):
                for ei, si in self.grid.get((gx, gy), ()):
                    geom = self.edges[ei]
                    d, q = self._seg_dist(p, geom[si], geom[si + 1])
                    if d < best[0]:
                        best = (d, q, ei)
        return best


def _nearest_node(adj, p):
    return min(adj.keys(), key=lambda n: pl.hav(n, p))


def node_path_coords(adj, a, b):
    """a→b 그래프 최단경로 좌표열. 없으면 (None, None). → (coords, 길이m)"""
    dist, prev = pl.dijkstra(adj, a)
    if b not in dist:
        return None, None
    pieces = []
    cur = b
    while cur != a:
        u, geom, nm, up, w = prev[cur]
        pieces.append(geom)  # u→cur 방향
        cur = u
    coords = []
    for geom in reversed(pieces):  # a→b 순서
        coords += geom if not coords else geom[1:]
    return coords, dist[b]


def _polyline_km(coords):
    return sum(pl.hav(p, q) for p, q in zip(coords, coords[1:])) / 1000


def _dedupe(coords):
    out = []
    for c in coords:
        if not out or pl.hav(out[-1], c) > 0.5:
            out.append(c)
    return out


# ── 매칭 본체 ──
def match(code, raw, tau=25.0, detour=1.6):
    """→ dict(lines, segments, report, gpx_name)"""
    gpx_pts, gpx_name = parse_gpx(raw)
    pts = smooth(resample(gpx_pts))
    segments, _ = pl.load_forest_segments(code)
    net = Network(segments)
    adj = pl.build_graph(segments)

    proj = [net.nearest(p) for p in pts]           # (d, q, ei)
    matched = [d <= tau for d, _, _ in proj]

    # 런 분할 + 요동 흡수
    runs = []                                       # (flag, i0, i1)
    i = 0
    while i < len(pts):
        j = i
        while j < len(pts) and matched[j] == matched[i]:
            j += 1
        runs.append([matched[i], i, j])
        i = j
    changed = True
    while changed and len(runs) > 1:
        changed = False
        for k, r in enumerate(runs):
            if r[2] - r[1] < MIN_RUN and len(runs) > 1:
                nb = runs[k - 1] if k > 0 else runs[k + 1]
                nb[1] = min(nb[1], r[1]); nb[2] = max(nb[2], r[2])
                runs.pop(k)
                changed = True
                break
    # 인접 동일 flag 병합
    merged = [runs[0]]
    for r in runs[1:]:
        if r[0] == merged[-1][0]:
            merged[-1][2] = r[2]
        else:
            merged.append(r)
    runs = merged

    # 조각 생성
    pieces = []                                     # (src, coords, gpx_km_pos)
    cum_km = 0.0
    for k, (flag, i0, i1) in enumerate(runs):
        seg_pts = pts[i0:i1]
        gpx_km = _polyline_km(pts[max(0, i0 - 1):i1])
        if flag:
            coords = _dedupe([proj[i][1] for i in range(i0, i1)])
            if len(coords) >= 2:
                pieces.append(("graph", coords, cum_km))
        else:
            # 갭 필: 양옆 matched 투영점 사이 그래프 경로 시도
            fell_back = True
            if 0 < k < len(runs) - 1:
                a_q = proj[i0 - 1][1]
                b_q = proj[i1][1] if i1 < len(pts) else None
                if b_q:
                    na, nb = _nearest_node(adj, a_q), _nearest_node(adj, b_q)
                    coords, dg = node_path_coords(adj, na, nb) if na != nb else ([na], 0.0)
                    if coords is not None:
                        conn = pl.hav(a_q, na) + pl.hav(b_q, nb)
                        total = (dg or 0) + conn
                        gpx_m = max(gpx_km * 1000, 1)
                        # 양방향 조건: 그래프 경로가 GPX 갭과 비슷한 길이일 때만 채택.
                        # 훨씬 짧으면(왕복 조망 스퍼 등 실제 이탈) GPX 원 좌표를 살린다.
                        if gpx_m / detour <= total <= gpx_m * detour:
                            path = _dedupe([a_q] + coords + [b_q])
                            if len(path) >= 2:
                                pieces.append(("graph", path, cum_km))
                            fell_back = False
            if fell_back and len(seg_pts) >= 2:
                pieces.append(("gpx", [tuple(p) for p in seg_pts], cum_km))
        cum_km += gpx_km

    if not pieces:
        raise ValueError("매칭 결과가 비어 있음 (GPX 가 구간망·산 영역과 무관?)")

    # 인접 동일 src 병합 + 전체 스티칭
    stitched = [pieces[0]]
    for src, coords, pos in pieces[1:]:
        psrc, pcoords, ppos = stitched[-1]
        if src == psrc:
            stitched[-1] = (psrc, _dedupe(pcoords + coords), ppos)
        else:
            stitched.append((src, coords, pos))

    full = []
    seg_meta = []
    for src, coords, _ in stitched:
        add = coords if not full else ([full[-1]] + coords)[1:]
        seg_meta.append({"src": src, "n": len(add)})
        full += add
    full = _dedupe(full)

    graph_km = sum(_polyline_km(c) for s, c, _ in stitched if s == "graph")
    total_km = _polyline_km(full)
    fallbacks = [{"km": round(pos, 2), "len_km": round(_polyline_km(c), 2)}
                 for s, c, pos in stitched if s == "gpx"]
    max_dev = max((d for (d, _, _), m in zip(proj, matched) if m), default=0.0)

    return {
        "lines": [[[round(x, 6), round(y, 6)] for x, y in full]],
        "segments": seg_meta,
        "gpx_name": gpx_name,
        "report": {
            "matched_ratio": round(graph_km / total_km, 3) if total_km else 0.0,
            "distance_km": round(total_km, 2),
            "max_dev_m": round(max_dev, 1),
            "fallbacks": fallbacks,
        },
        "preview_raw": {"type": "FeatureCollection", "features": [{
            "type": "Feature", "properties": {},
            "geometry": {"type": "LineString",
                         "coordinates": [[round(x, 6), round(y, 6)] for x, y in pts]}}]},
        "preview_matched": {"type": "FeatureCollection", "features": [{
            "type": "Feature", "properties": {"src": s},
            "geometry": {"type": "LineString",
                         "coordinates": [[round(x, 6), round(y, 6)] for x, y in c]}}
            for s, c, _ in stitched]},
    }


# ── DEM 통계 ──
def _dem_for(bboxes):
    xs = [b[0] for b in bboxes] + [b[2] for b in bboxes]
    ys = [b[1] for b in bboxes] + [b[3] for b in bboxes]
    bbox = [min(xs), min(ys), max(xs), max(ys)]
    tifs = dem_cache.ensure(bbox)
    pad = 0.02
    return pl.Dem(tifs, bounds=(bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad))


def _course_bbox(lines):
    xs = [p[0] for ln in lines for p in ln]
    ys = [p[1] for ln in lines for p in ln]
    return [min(xs), min(ys), max(xs), max(ys)]


def compute_stats(lines, dem):
    coords = []
    for ln in lines:
        coords += ln if not coords else ln[1:]
    # 거리는 파트별 합산 — 수작업 코스의 비연결 파트 갭을 직선으로 가산하지 않음 (부록 D)
    km = sum(_polyline_km(ln) for ln in lines)
    prof = pl.profile48(coords, dem.elev)
    asc, desc = pl.ascent_descent(prof)
    return {"distance_km": round(km, 2), "time_hr": pl.naismith_time(km, asc),
            "profile": prof, "min_elev": min(prof), "max_elev": max(prof),
            "ascent": asc, "descent": desc}


# ── admin_server 진입점 ──
def match_gpx_upload(code, draft, raw, tau, detour):
    m = match(code, raw, tau, detour)
    dem = _dem_for([draft["mountain"]["bbox"], _course_bbox(m["lines"])])
    computed = compute_stats(m["lines"], dem)

    # GPX 원본 보존
    gdir = os.path.join(pl.ROOT, "admin_data", code, "gpx")
    os.makedirs(gdir, exist_ok=True)
    fname = f"{uuid.uuid4().hex[:12]}.gpx"
    open(os.path.join(gdir, fname), "wb").write(raw)

    course = {
        "id": f"c-{uuid.uuid4().hex[:12]}",
        "name": m["gpx_name"] or "GPX 코스",
        "difficulty": pl.DIFF_BY_ASCENT(computed["ascent"]),
        "desc": None, "kind": "운영자 큐레이션",
        "status": "draft",
        "source": {"type": "gpx", "gpx_file": f"gpx/{fname}",
                   "matched_ratio": m["report"]["matched_ratio"]},
        "segments": m["segments"],
        "lines": m["lines"],
        "computed": computed,
    }
    report = dict(m["report"], ascent=computed["ascent"])
    return {"course": course, "report": report,
            "preview": {"raw": m["preview_raw"], "matched": m["preview_matched"]}}


def recompute_course(draft, course):
    dem = _dem_for([draft["mountain"]["bbox"], _course_bbox(course["lines"])])
    course["computed"] = compute_stats(course["lines"], dem)
    course["difficulty"] = pl.DIFF_BY_ASCENT(course["computed"]["ascent"])
    return course
