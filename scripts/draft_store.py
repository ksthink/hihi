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
