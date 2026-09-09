#!/usr/bin/env python3
"""산별 큐레이션 초안(draft) 저장소 — admin_data/<산코드>/draft.json.

draft 는 운영자 편집 소스(커밋 대상), data/packs/<산코드>/*.geojson 은 배포 산출물(재생성 가능).

draft.json 스키마:
  version: 1
  mountain: { code, name, region, elev, center[lon,lat], zoom, bbox[4],
              sort_order, famous, published }
  courses: [{ id(uuid), name, difficulty(초급|중급|고급), desc, kind,
              status(draft|ready),                    # ready 만 배포에 포함
              source{ type: gpx|forest_auto|legacy, gpx_file?, matched_ratio? },
              segments: [{src: graph|gpx, n}] | None, # 하이브리드 구간 출처(포인트 수)
              lines: [[[lon,lat],...], ...],          # MultiLineString 좌표
              computed{ distance_km, time_hr, profile[48], min_elev, max_elev,
                        ascent, descent } }]
  spots: [{ id, category, name(운영자 라벨, null=앱 라벨 미노출), coord[lon,lat],
            detail, etc, origin(forest|manual), moved, deleted }]
  publish: { pack_version, published_at, pack_size_kb }
"""
import json
import math
import os
import tempfile
import uuid

import pack_lib as pl

ADMIN_DATA = os.path.join(pl.ROOT, "admin_data")

# 기존 배포 3산 (slug 시대 산출물 → draft 역임포트용 메타, upload_packs.py 와 일치)
LEGACY = {
    "113050202": {"slug": "bukhansan", "name": "북한산", "region": "서울·경기", "elev": 836,
                  "center": [126.990, 37.672], "zoom": 11.3,
                  "bbox": [126.90, 37.59, 127.06, 37.75], "pack_version": 3, "sort_order": 1},
    "428302602": {"slug": "seoraksan", "name": "설악산", "region": "강원 속초·양양", "elev": 1708,
                  "center": [128.403, 38.133], "zoom": 11.3,
                  "bbox": [128.30, 38.07, 128.51, 38.19], "pack_version": 2, "sort_order": 2},
    "412900401": {"slug": "cheonggyesan", "name": "청계산", "region": "서울·과천·성남", "elev": 616,
                  "center": [127.035, 37.42], "zoom": 12.0,
                  "bbox": [126.98, 37.36, 127.09, 37.47], "pack_version": 1, "sort_order": 3},
}


def draft_path(code):
    return os.path.join(ADMIN_DATA, code, "draft.json")


def load(code):
    p = draft_path(code)
    if not os.path.exists(p):
        return None
    return json.load(open(p, encoding="utf-8"))


def save(code, draft):
    """원자적 저장 (호출별 고유 tmp → rename).

    tmp 경로를 고정하면 admin_server(스레드 병렬)에서 저장 두 건이 겹칠 때
    한쪽이 rename 해 간 tmp 를 다른 쪽이 또 rename 하려다 ENOENT 로 실패한다
    (자동저장 + 명시 저장 동시 발생 사례). mkstemp 로 저장마다 다른 tmp 를 쓰면
    각 저장이 독립적으로 원자 교체되고 마지막 저장본이 남는다."""
    d = os.path.join(ADMIN_DATA, code)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix="draft.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(draft, f, ensure_ascii=False, indent=1)
        os.replace(tmp, draft_path(code))
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def list_drafts():
    out = []
    if not os.path.isdir(ADMIN_DATA):
        return out
    for code in sorted(os.listdir(ADMIN_DATA)):
        d = load(code)
        if not d:
            continue
        m = d["mountain"]
        out.append({"code": code, "name": m["name"], "region": m.get("region"),
                    "elev": m.get("elev"), "published": m.get("published", True),
                    "famous": m.get("famous", False), "sort_order": m.get("sort_order", 100),
                    "courses": len(d["courses"]),
                    "ready": sum(1 for c in d["courses"] if c["status"] == "ready"),
                    "spots": sum(1 for s in d["spots"] if not s.get("deleted")),
                    "publish": d.get("publish")})
    return out


def _summit_spot(code, meta):
    """100대명산 API 정상 좌표(meta.peak) → '정상' 스팟 1점 자동 시드 (주봉 main=true).
    산림청 SPOT 대량 시드는 폐기 — 운영자 큐레이션 없이 앱 봉우리(▲)만 표시.
    peak 없는 산(100대 외)은 빈 목록."""
    pk = (meta or {}).get("peak")
    if not pk:
        return []
    return [{"id": f"sp-peak-{code}", "category": "정상",
             "name": meta.get("name"),
             "coord": [round(pk["lon"], 6), round(pk["lat"], 6)],
             "detail": f"{round(pk['elev'])}m" if pk.get("elev") else None,
             "etc": None, "origin": "top100", "moved": False, "deleted": False,
             "main": True}]


def new_draft(code, mnt_meta=None):
    """신규 산 초안: mountain/ 스캔 메타 + 정상 스팟 자동 시드 + 구간망 bbox."""
    meta = dict(mnt_meta or {})
    segs, mntn_nm = pl.load_forest_segments(code)
    xs = [p[0] for s in segs for p in s["pts"]]
    ys = [p[1] for s in segs for p in s["pts"]]
    bbox = [round(min(xs) - 0.01, 2), round(min(ys) - 0.01, 2),
            round(max(xs) + 0.01, 2), round(max(ys) + 0.01, 2)]
    draft = {
        "version": 1,
        "mountain": {
            "code": code,
            "name": meta.get("name") or mntn_nm,
            "region": meta.get("region"),
            "elev": int(meta["elev"]) if meta.get("elev") else None,
            "center": [round((bbox[0] + bbox[2]) / 2, 3), round((bbox[1] + bbox[3]) / 2, 3)],
            "zoom": 12.0, "bbox": bbox,
            "sort_order": 100, "famous": False, "published": True,
        },
        "courses": [],
        "spots": _summit_spot(code, meta),
        "publish": None,
    }
    return draft


def new_manual_draft(code, name, center, elev=None, region=None, margin=0.03):
    """산림청 원본 없는 산(도심·소규모)의 초안 — 운영자 입력만으로 생성.

    산림청 등산로 데이터가 없어 mountain/ 스캔에 안 잡히는 산을 직접 등록하는 경로.
    코스는 이후 GPX 업로드, 스팟은 지도 클릭으로 채운다. bbox 는 중심 ± margin(도) —
    DEM·등고선·기저타일 추출 범위(publish_pack 은 이 bbox 만 사용). elev 가 있으면
    중심에 '정상' 스팟 1점을 자동 시드(주봉 ▲)해 앱에서 봉우리가 바로 보이게 한다.
    code 는 '9'+8자리 예약 대역(산림청 코드는 1~4로 시작 — 충돌 없음)."""
    lon, lat = round(center[0], 6), round(center[1], 6)
    bbox = [round(lon - margin, 3), round(lat - margin, 3),
            round(lon + margin, 3), round(lat + margin, 3)]
    spots = []
    if elev:
        spots = [{"id": f"sp-peak-{code}", "category": "정상", "name": name,
                  "coord": [lon, lat], "detail": f"{int(elev)}m", "etc": None,
                  "origin": "manual", "moved": False, "deleted": False, "main": True}]
    return {
        "version": 1,
        "mountain": {
            "code": code,
            "name": name,
            "region": region or None,
            "elev": int(elev) if elev else None,
            "center": [round(lon, 3), round(lat, 3)],
            "zoom": 13.0, "bbox": bbox,
            "sort_order": 100, "famous": False, "published": True,
        },
        "courses": [],
        "spots": spots,
        "publish": None,
    }


# bbox 자동 맞춤 — 발행이 이 상자만 보고 DEM·등고선·기저타일을 뽑는다(publish_pack).
# 수동 등록 산은 중심 ±0.03°(≈5×7km) 로 시작하므로 국립공원급 산을 올리면 지도가 잘린다.
# 코스는 등록 뒤에 올라오니 "등록 시점에 크기를 묻는" 방식으로는 맞출 수 없다.
BBOX_PAD_KM = 1.0      # 코스 바깥 여유 — 들머리 주변이 지도 끝에 붙지 않게
BBOX_GRID = 0.01       # 스냅 격자(≈1km). ⚠️ 이게 없으면 코스를 하나 더 올릴 때마다
                       #    bbox 가 미세하게 흔들려 기저 타일을 매번 다시 뽑는다
                       #    (publish_pack 은 tiles_bbox 가 같을 때만 재사용한다).
BBOX_MIN_SPAN = 0.06   # 최소 한 변 — 코스가 짧아도 지도가 손바닥만 해지지 않게.
                       # ⚠️ **넓힐 때만** 적용한다. 소급하면 산림청 원본 bbox 가 이보다
                       #    작은 산(덕숭산 0.05°)까지 건드려 기저 타일을 다시 뽑게 된다.


def content_points(draft):
    """코스 좌표 + 살아 있는 스팟 좌표 — bbox 가 반드시 담아야 하는 점들."""
    pts = [p for c in draft.get("courses", []) for ln in c.get("lines", []) for p in ln]
    pts += [s["coord"] for s in draft.get("spots", [])
            if s.get("coord") and not s.get("deleted")]
    return pts


def fit_bbox(draft):
    """코스·스팟을 담도록 bbox 를 **넓히기만** 한다. 좁히지 않는 이유는 두 가지 —
    운영자가 일부러 넓혀 둔 지도를 되돌리면 안 되고, 좁히면 이미 발행한 팩보다
    범위가 줄어 기저 타일을 다시 뽑아야 한다. 변화가 없으면 기존 리스트를 그대로 돌려준다.

    반환: (bbox, changed)"""
    cur = list(draft["mountain"]["bbox"])
    pts = content_points(draft)
    if not pts:
        return cur, False
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    # ⚠️ 판정에는 여유를 쓰지 않는다. 여유까지 넣어 비교하면 콘텐츠가 이미 잘 들어가 있는
    #    산도 가장자리에 가깝다는 이유로 한 칸씩 넓어지고, 그때마다 기저 타일을 다시 뽑는다
    #    (실측: 북한산·가리왕산·덕숭산 셋 다 그렇게 됐다). 여유는 "넓힐 때 얼마나"에만 쓴다.
    if (cur[0] <= min(xs) and cur[1] <= min(ys)
            and max(xs) <= cur[2] and max(ys) <= cur[3]):
        return cur, False        # 이미 담고 있다 — 최소 한 변도 여기서는 따지지 않는다

    lat = draft["mountain"]["center"][1]
    dlat = BBOX_PAD_KM / 111.0
    dlon = BBOX_PAD_KM / max(1e-6, 111.0 * math.cos(math.radians(lat)))
    want = [min(xs) - dlon, min(ys) - dlat, max(xs) + dlon, max(ys) + dlat]
    # 넓히기만 — 기존 상자와 합집합
    box = [min(cur[0], want[0]), min(cur[1], want[1]),
           max(cur[2], want[2]), max(cur[3], want[3])]

    # 바깥으로 격자 스냅. ⚠️ 나눗셈 결과를 그대로 floor 하면 안 된다 —
    #    37.3/0.01 이 3729.999… 라 37.29 로 한 칸 새어 나간다. 먼저 반올림해 정수를 만든다.
    g = BBOX_GRID
    lo = lambda v: math.floor(round(v / g, 6)) * g
    hi = lambda v: math.ceil(round(v / g, 6)) * g
    box = [lo(box[0]), lo(box[1]), hi(box[2]), hi(box[3])]
    # 최소 한 변 보장 — 중심을 유지한 채 벌린다
    for i, j in ((0, 2), (1, 3)):
        if box[j] - box[i] < BBOX_MIN_SPAN - 1e-9:
            mid = (box[i] + box[j]) / 2
            box[i] = lo(mid - BBOX_MIN_SPAN / 2)
            box[j] = hi(mid + BBOX_MIN_SPAN / 2)
    box = [round(v, 3) for v in box]
    return box, box != cur


def seed_auto_courses(draft, dem, max_courses=12, log=print):
    """산림청 그래프 자동추출 코스를 draft 에 시드 (build_forest_pack 코어 재사용)."""
    from build_forest_pack import extract_courses
    feats, _ = extract_courses(draft["mountain"]["code"], dem, max_courses, log=log)
    for f in feats:
        p = f["properties"]
        draft["courses"].append({
            "id": f"c-{uuid.uuid4().hex[:12]}",
            "name": p["name"], "difficulty": p["difficulty"], "desc": p["desc"],
            "kind": p["kind"], "status": "ready",
            "source": {"type": "forest_auto"}, "segments": None,
            "lines": f["geometry"]["coordinates"],
            "computed": {k: p[k] for k in ("distance_km", "time_hr", "profile",
                                           "min_elev", "max_elev", "ascent", "descent")},
        })
    return draft


def import_legacy(code):
    """배포된 3산의 data/<slug>-*.geojson → draft 역임포트."""
    meta = LEGACY[code]
    routes = json.load(open(os.path.join(pl.ROOT, "data", f"{meta['slug']}-routes.geojson"),
                            encoding="utf-8"))
    spots = json.load(open(os.path.join(pl.ROOT, "data", f"{meta['slug']}-spots.geojson"),
                           encoding="utf-8"))
    courses = []
    for f in routes["features"]:
        p = f["properties"]
        courses.append({
            "id": f"c-{uuid.uuid4().hex[:12]}",
            "name": p["name"], "difficulty": p["difficulty"], "desc": p.get("desc"),
            "kind": p.get("kind"), "status": "ready",
            "source": {"type": "legacy"}, "segments": None,
            "lines": f["geometry"]["coordinates"],
            "computed": {k: p.get(k) for k in ("distance_km", "time_hr", "profile",
                                               "min_elev", "max_elev", "ascent", "descent")},
        })
    sp = []
    for f in spots["features"]:
        p = f["properties"]
        sp.append({"id": f"sp-{p.get('id')}", "category": p["category"], "name": None,
                   "coord": f["geometry"]["coordinates"],
                   "detail": p.get("detail") or None, "etc": p.get("etc") or None,
                   "origin": "forest", "moved": False, "deleted": False})
    return {
        "version": 1,
        "mountain": {"code": code, "name": meta["name"], "region": meta["region"],
                     "elev": meta["elev"], "center": meta["center"], "zoom": meta["zoom"],
                     "bbox": meta["bbox"], "sort_order": meta["sort_order"],
                     "famous": True, "published": True},
        "courses": courses,
        "spots": sp,
        "publish": {"pack_version": meta["pack_version"], "published_at": None,
                    "pack_size_kb": None},
    }


def to_pack(draft):
    """draft → (routes FeatureCollection, spots FeatureCollection) — 사용자 앱 스키마."""
    feats = []
    for c in draft["courses"]:
        if c["status"] != "ready":
            continue
        props = {"name": c["name"], "difficulty": c["difficulty"], **c["computed"],
                 "kind": c.get("kind") or "운영자 큐레이션", "desc": c.get("desc")}
        # 사용자 앱이 기대하는 키 순서와 무관하게 동일 키 집합 유지
        out = {k: props[k] for k in
               ("name", "difficulty", "distance_km", "time_hr", "kind",
                "desc", "profile", "min_elev", "max_elev", "ascent", "descent")}
        if c.get("no") is not None:  # 코스 번호 — 앱 지도 중앙 라벨 (부록 D)
            out["no"] = c["no"]
        feats.append({"type": "Feature",
                      "geometry": {"type": "MultiLineString", "coordinates": c["lines"]},
                      "properties": out})
    feats.sort(key=lambda f: (f["properties"].get("no") is None,
                              f["properties"].get("no") or 0,
                              -(f["properties"]["distance_km"] or 0)))
    sp = []
    for s in draft["spots"]:
        if s.get("deleted"):
            continue
        # 산림청 유래 스팟은 원본 숫자 id 로 (기존 팩과 호환)
        raw = s["id"][3:] if str(s["id"]).startswith("sp-") else str(s["id"])
        props = {"id": int(raw) if raw.isdigit() else s["id"], "category": s["category"],
                 "detail": s.get("detail"), "etc": s.get("etc")}
        if s.get("name"):
            props["name"] = s["name"]
        if s.get("main") is not None:  # 봉우리 위계(정상 main=true/부봉 false) — 앱 peak 크기
            props["main"] = s["main"]
        # 스팟별 표시 오버라이드(없으면 분류 전역 설정 따름) — disp_zoom 99=끔
        for k in ("disp_zoom", "disp_icon", "disp_size", "disp_bold"):
            if s.get(k) is not None:
                props[k] = s[k]
        sp.append({"type": "Feature",
                   "geometry": {"type": "Point", "coordinates": s["coord"]},
                   "properties": props})
    return ({"type": "FeatureCollection", "features": feats},
            {"type": "FeatureCollection", "features": sp})
