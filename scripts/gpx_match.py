#!/usr/bin/env python3
"""GPX 트랙 → 산림청 구간망 맵매칭 → 코스 후보 (관리자 콘솔 코어).

알고리즘 (draft: tau=25m 스냅 임계, detour=1.6 우회 허용비):
 1. GPX 트랙포인트를 5m 간격으로 리샘플
 2. 공간 그리드(≈100m 셀)로 각 점을 구간망 간선에 최근접 투영 — d≤tau 면 matched
 3. matched/unmatched 런 분할 (3점 미만 요동은 이웃에 흡수)
 4. matched 런 → 투영점 폴리라인(구간망 위를 그대로 따라감, src="graph")
    unmatched 런(갭) → 갭이 GAP_FILL_MAX_M 이하이고 양끝 투영점의 최근접 노드 간
    Dijkstra 경로가 GPX 갭 길이 ÷~× detour 범위면 그래프 경로(src="graph"),
    아니면 GPX 원 좌표 유지(src="gpx") — 산림청 데이터 부실 구간 보완(하이브리드)
 5. 스티칭 + 리포트(매칭률·최대이탈·fallback 목록)
 6. DEM 으로 profile48 / ascent / distance / naismith time / 난이도 초깃값
"""
import io
import json
import math
import os
import uuid
import xml.etree.ElementTree as ET
import zipfile

import dem_cache
import pack_lib as pl

RESAMPLE_M = 5.0
CELL = 0.001          # ≈ 90~110m
MIN_RUN = 3           # 이보다 짧은 런은 이웃에 흡수
# 갭 채움(그래프 경로 대체) 허용 최대 갭 길이. 갭 채움은 짧은 GPS 드리프트 보정용 —
# 이보다 긴 미매칭 구간은 구간망에 없는 실제 다른 길(둘레길·마을길 등)이므로 원본을
# 유지한다. (계양산 사례: 서남쪽 3.96km 순환이 우연히 비슷한 길이(비 0.92)의 구간망
# 경로로 바꿔치기됨 — 길이 비만 보는 detour 로는 걸러지지 않음)
GAP_FILL_MAX_M = 1000.0
# 갭 채움 회랑 폭: 대체 그래프 경로의 모든 점이 원본 갭 궤적에서 이 거리 안이어야 함.
# 드리프트 보정이면 대체 경로는 원본을 바짝 따라간다 — 길이만 비슷하고 옆으로 크게
# 벗어나는 경로는 다른 길이다. (계양산 2차 사례: 0.6km 갭이 100m+ 벗어난 0.46km
# 경로로 대체 — 길이 비 0.77 로 밴드 통과, 회랑 검사로만 걸러짐)
GAP_FILL_CORRIDOR_M = 80.0


# ── 업로드 트랙 파싱 (GPX·GeoJSON·Shapefile) ──
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


def _maybe_tm(pts):
    """좌표 크기로 투영계 감지 — 경위도 범위를 벗어나면 EPSG:5186(미터)로 보고 변환.
    (산림청 SHP/GeoJSON 내보내기가 5186 이라 이 폴백이 실제로 쓰인다.)"""
    if pts and (abs(pts[0][0]) > 180 or abs(pts[0][1]) > 90):
        return [tuple(pl.tm_to_wgs84(x, y)) for x, y in pts]
    return pts


def parse_geojson(raw):
    """JSON 계열 업로드 → (pts, name).
    지원: 표준 GeoJSON(LineString·MultiLineString·GeometryCollection, Point 시퀀스 폴백)
    + ESRI JSON(산림청 PMNTN_*.json — features[].geometry.paths, EPSG:5186)."""
    d = json.loads(raw)

    # ESRI JSON (ArcGIS 내보내기): geometry 가 type 대신 paths 를 가짐
    feats_e = d.get("features") if isinstance(d, dict) else None
    if feats_e and any("paths" in (f.get("geometry") or {}) for f in feats_e[:5]):
        pts, name = [], None
        for f in feats_e:
            for path in (f.get("geometry") or {}).get("paths", []):
                pts.extend((float(p[0]), float(p[1])) for p in path)
            if name is None:
                a = f.get("attributes") or {}
                name = (a.get("PMNTN_NM") or a.get("MNTN_NM") or "").strip() or None
        if len(pts) < 2:
            raise ValueError("ESRI JSON 에 폴리라인 좌표가 2개 미만")
        return _maybe_tm(pts), name

    feats = d["features"] if d.get("type") == "FeatureCollection" else [d]
    pts, pt_seq, name, seen = [], [], None, set()

    def eat(g):
        t = g.get("type")
        seen.add(t)
        if t == "LineString":
            pts.extend((float(p[0]), float(p[1])) for p in g["coordinates"])
        elif t == "MultiLineString":
            for part in g["coordinates"]:
                pts.extend((float(p[0]), float(p[1])) for p in part)
        elif t == "GeometryCollection":
            for gg in g.get("geometries", []):
                eat(gg)
        elif t == "Point":  # 트랙을 점 목록으로 내보내는 도구 대응 (등장 순서 = 진행 순서)
            c = g["coordinates"]
            pt_seq.append((float(c[0]), float(c[1])))

    for f in feats:
        eat(f.get("geometry") or f)         # bare geometry 허용
        if name is None:
            name = (f.get("properties") or {}).get("name")
    if len(pts) < 2 and len(pt_seq) >= 2:
        pts = pt_seq                        # 라인이 없으면 Point 시퀀스를 트랙으로
    if len(pts) < 2:
        raise ValueError(f"GeoJSON 에서 라인 좌표를 찾지 못함 (발견된 기하: {sorted(t for t in seen if t) or '없음'})")
    return _maybe_tm(pts), name


def parse_shp(raw):
    """Shapefile(.shp 단독 또는 .zip 묶음) → (pts, name=None).
    폴리라인 계열만 사용. 좌표계는 _maybe_tm 휴리스틱 (산림청 5186 대응)."""
    import shapefile  # pyshp — 업로드 시에만 로드
    if raw[:4] == b"PK\x03\x04":
        z = zipfile.ZipFile(io.BytesIO(raw))
        shp_names = [n for n in z.namelist() if n.lower().endswith(".shp")]
        if not shp_names:
            raise ValueError("zip 안에 .shp 파일이 없음")
        base = shp_names[0][:-4]
        def member(sfx):
            for n in z.namelist():
                if n.lower() == (base + sfx).lower():
                    return io.BytesIO(z.read(n))
            return None
        r = shapefile.Reader(shp=io.BytesIO(z.read(shp_names[0])),
                             shx=member(".shx"), dbf=member(".dbf"))
    else:
        r = shapefile.Reader(shp=io.BytesIO(raw))
    pts = []
    for sh in r.shapes():
        if sh.shapeType in (3, 13, 23):     # POLYLINE / Z / M
            pts.extend((float(x), float(y)) for x, y in sh.points)
    if len(pts) < 2:
        raise ValueError("Shapefile 에 폴리라인 좌표가 2개 미만")
    return _maybe_tm(pts), None


def parse_track(raw, fname=""):
    """확장자·매직바이트로 포맷 판별 → (pts, name|None)."""
    ext = os.path.splitext((fname or "").lower())[1]
    head = raw.lstrip()[:1]
    if ext in (".geojson", ".json") or (not ext and head in (b"{", b"[")):
        return parse_geojson(raw)
    if ext in (".shp", ".zip") or raw[:4] in (b"PK\x03\x04", b"\x00\x00\x27\x0a"):
        return parse_shp(raw)
    return parse_gpx(raw)


def parse_gpx_parts(raw):
    """raw → (parts[[ (lon,lat),... ], ...], name).

    trk(상세 기록) 우선 — trk 가 있으면 rte·wpt 는 무시한다. 네이버지도 등은 같은
    경로를 wpt/rte(성긴 요약)/trk(상세) 3중으로 담는데, 이를 함께 그리면 성긴 rte 가
    큰 직선으로 상세선 위에 겹친다(=경로가 끊겨 보이던 근본 원인). trk 가 없을 때만
    rte, 그마저 없으면 wpt 시퀀스를 쓴다. trkseg 경계는 파트로 보존(끊긴 구간을
    직선으로 잇지 않음) — 단, 한 trkseg 안의 성긴 점들은 그대로 이어 실제 경로를 그린다."""
    root = ET.fromstring(raw)
    trk_parts, cur = [], []
    rte, wpts, name = [], [], None

    def flush():
        nonlocal cur
        if len(cur) >= 2:
            trk_parts.append(cur)
        cur = []

    for el in root.iter():
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "trkseg":
            flush()                       # 새 세그 시작 → 이전 파트 확정
        elif tag == "trkpt":
            cur.append((float(el.attrib["lon"]), float(el.attrib["lat"])))
        elif tag == "rtept":
            rte.append((float(el.attrib["lon"]), float(el.attrib["lat"])))
        elif tag == "wpt":
            wpts.append((float(el.attrib["lon"]), float(el.attrib["lat"])))
        elif tag == "name" and name is None and el.text and el.text.strip():
            name = el.text.strip()
    flush()

    if trk_parts:
        return trk_parts, name
    if len(rte) >= 2:
        return [rte], name
    if len(wpts) >= 2:
        return [wpts], name
    raise ValueError("GPX 에 트랙포인트가 2개 미만")


def parse_track_segments(raw, fname=""):
    """parse_track 과 같은 포맷 판별. GPX 는 trk 우선 + trkseg 경계를 파트로 보존,
    그 외 포맷(GeoJSON·SHP)은 파서가 준 플랫 좌표를 단일 파트로. → (parts, name)."""
    ext = os.path.splitext((fname or "").lower())[1]
    head = raw.lstrip()[:1]
    if ext in (".geojson", ".json") or (not ext and head in (b"{", b"[")):
        pts, name = parse_geojson(raw)
        return [pts], name
    if ext in (".shp", ".zip") or raw[:4] in (b"PK\x03\x04", b"\x00\x00\x27\x0a"):
        pts, name = parse_shp(raw)
        return [pts], name
    return parse_gpx_parts(raw)


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


def _max_offset(path, ref):
    """path 각 점에서 ref 점열(5m 리샘플 원본 갭)까지 최근접 거리의 최댓값(m)."""
    if not ref:
        return 0.0
    return max(min(pl.hav(p, r) for r in ref) for p in path)


# ── 매칭 본체 ──
def match(code, raw, tau=25.0, detour=1.6, fname=""):
    """→ dict(lines, segments, report, gpx_name)"""
    gpx_pts, gpx_name = parse_track(raw, fname)
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
                        # + 긴 갭은 대체 금지(GAP_FILL_MAX_M) — 실제 다른 길 보호.
                        # + 회랑 검사(GAP_FILL_CORRIDOR_M) — 대체 경로가 원본 궤적을
                        #   벗어나면 드리프트 보정이 아니라 다른 길이므로 원본 유지.
                        if gpx_m <= GAP_FILL_MAX_M and gpx_m / detour <= total <= gpx_m * detour:
                            path = _dedupe([a_q] + coords + [b_q])
                            if len(path) >= 2 and _max_offset(path, seg_pts) <= GAP_FILL_CORRIDOR_M:
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


def match_raw(raw, fname=""):
    """구간망이 없는 산(수동 등록) — GPX 원본을 스냅 없이 그대로 코스로.
    trk 우선 파싱(성긴 rte 요약선 겹침 방지) + trkseg 경계로만 파트 분리 →
    MultiLineString 반환(끊긴 세그먼트만 분리, 한 세그 안의 성긴 점은 이어 그림).
    각 파트는 리샘플·스무딩만 적용. match 와 동일 스키마."""
    segs, gpx_name = parse_track_segments(raw, fname)
    lines = []
    for seg in segs:
        coords = _dedupe([tuple(p) for p in smooth(resample(seg))])
        if len(coords) >= 2:
            lines.append([[round(x, 6), round(y, 6)] for x, y in coords])
    if not lines:
        raise ValueError("트랙 좌표가 2개 미만")
    total_km = sum(_polyline_km([tuple(p) for p in ln]) for ln in lines)
    fc = lambda src: {"type": "FeatureCollection", "features": [{
        "type": "Feature", "properties": ({"src": src} if src else {}),
        "geometry": {"type": "LineString", "coordinates": ln}} for ln in lines]}
    return {
        "lines": lines,
        "segments": [{"src": "gpx", "n": len(ln)} for ln in lines],
        "gpx_name": gpx_name,
        "report": {"matched_ratio": 0.0, "distance_km": round(total_km, 2),
                   "max_dev_m": 0.0, "fallbacks": [], "raw_passthrough": True,
                   "parts": len(lines)},
        "preview_raw": fc(None),
        "preview_matched": fc("gpx"),
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


def gpx_elevation(raw):
    """GPX 트랙포인트 (lon,lat,ele) 트랙 + '실제 녹화' 여부.
    ele 가 있으면 그 값을 쓴다 — 네이버·카카오 export 는 자사 정밀 지형모델 기반이라
    우리 코퍼니쿠스 DSM(다리·건물 포함해 강변에서 튐)보다 매끄럽고 정확하다.
    포인트별 <time> 이 있으면 기기 실측 녹화(있으면 '실측GPS', 없으면 'GPX값').
    반환: (track[(lon,lat,ele)]|None, is_recording[bool])."""
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return None, False
    track, npts, ntime = [], 0, 0
    for el in root.iter():
        if el.tag.rsplit("}", 1)[-1] != "trkpt":
            continue
        npts += 1
        e = None
        for ch in el:
            ct = ch.tag.rsplit("}", 1)[-1]
            if ct == "ele" and ch.text:
                try:
                    e = float(ch.text)
                except ValueError:
                    pass
            elif ct == "time":
                ntime += 1
        if e is not None:
            try:
                track.append((float(el.attrib["lon"]), float(el.attrib["lat"]), e))
            except (KeyError, ValueError):
                pass
    if npts < 2 or len(track) < npts:        # 전 포인트에 ele 가 있어야 사용
        return None, False
    return track, (ntime >= npts * 0.5)      # 절반 이상 time → 실측 녹화


def compute_stats(lines, dem, gpx_track=None):
    coords = []
    for ln in lines:
        coords += ln if not coords else ln[1:]
    # 거리는 파트별 합산 — 수작업 코스의 비연결 파트 갭을 직선으로 가산하지 않음 (부록 D)
    km = sum(_polyline_km(ln) for ln in lines)
    # 고도 — GPX 자체 고도가 있으면 프로필·누적상승 모두 그것으로(DSM 스파이크 회피).
    # 없으면 DEM 을 격자 수준(25m)으로 표본. 둘 다 소임계값(3m) 히스테리시스로 잡음 차단.
    if gpx_track and len(gpx_track) >= 2:
        prof = pl.profile_from_track(gpx_track, 48)
        dense = pl.smooth_series(pl.ele_series_by_dist(gpx_track, 25.0), 3)
    else:
        prof = pl.profile48(coords, dem.elev)
        dense = pl.elev_along(coords, dem.elev, 25.0)
    asc, desc = pl.cum_gain(dense, 3.0)
    return {"distance_km": round(km, 2), "time_hr": pl.naismith_time(km, asc),
            "profile": prof,
            "min_elev": int(round(min(dense))), "max_elev": int(round(max(dense))),
            "ascent": asc, "descent": desc}


# ── admin_server 진입점 ──
def match_gpx_upload(code, draft, raw, tau, detour, upload_name=""):
    # 산림청 구간망(mountain/<code>/)이 있는 산만 스냅, 없으면(수동 등록) 원본 그대로.
    has_net = os.path.isdir(os.path.join(pl.ROOT, "mountain", code))
    m = match(code, raw, tau, detour, upload_name) if has_net else match_raw(raw, upload_name)
    dem = _dem_for([draft["mountain"]["bbox"], _course_bbox(m["lines"])])
    # GPX 에 고도가 있으면 그걸 우선(네이버·카카오 export·실측 녹화), 없으면 DEM.
    gtrack, esrc = None, "dem"
    try:
        trk, rec = gpx_elevation(raw)
        if trk:
            gtrack = trk
            esrc = "gps" if rec else "gpx"       # 실측 녹화 / GPX 값(export)
    except Exception:
        gtrack = None
    computed = compute_stats(m["lines"], dem, gpx_track=gtrack)

    # 업로드 원본 보존 (확장자는 원본 파일명 기준 — gpx/geojson/json/zip/shp)
    gdir = os.path.join(pl.ROOT, "admin_data", code, "gpx")
    os.makedirs(gdir, exist_ok=True)
    ext = os.path.splitext((upload_name or "").lower())[1] or ".gpx"
    fname = f"{uuid.uuid4().hex[:12]}{ext}"
    open(os.path.join(gdir, fname), "wb").write(raw)

    course = {
        "id": f"c-{uuid.uuid4().hex[:12]}",
        "name": m["gpx_name"] or os.path.splitext(os.path.basename(upload_name))[0] or "업로드 코스",
        "difficulty": pl.DIFF_BY_ASCENT(computed["ascent"]),
        "desc": None, "kind": "운영자 큐레이션",
        "status": "draft",
        "source": {"type": "gpx", "gpx_file": f"gpx/{fname}",
                   "matched_ratio": m["report"]["matched_ratio"]},
        "segments": m["segments"],
        "lines": m["lines"],
        "computed": computed,
    }
    report = dict(m["report"], ascent=computed["ascent"], elev_src=esrc)  # 고도 출처
    return {"course": course, "report": report,
            "preview": {"raw": m["preview_raw"], "matched": m["preview_matched"]}}


def recompute_course(draft, course):
    dem = _dem_for([draft["mountain"]["bbox"], _course_bbox(course["lines"])])
    course["computed"] = compute_stats(course["lines"], dem)
    course["difficulty"] = pl.DIFF_BY_ASCENT(course["computed"]["ascent"])
    return course
