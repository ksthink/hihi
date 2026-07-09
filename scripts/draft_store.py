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
    """원자적 저장 (tmp → rename)."""
    d = os.path.join(ADMIN_DATA, code)
    os.makedirs(d, exist_ok=True)
    tmp = draft_path(code) + ".tmp"
    json.dump(draft, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(tmp, draft_path(code))


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


def _forest_spots_to_draft(code):
    sp = []
    for f in pl.load_forest_spots(code, keep=pl.SPOT_KEEP):
        p = f["properties"]
        sp.append({"id": f"sp-{p['id']}", "category": p["category"], "name": None,
                   "coord": f["geometry"]["coordinates"],
                   "detail": p["detail"], "etc": p["etc"],
                   "origin": "forest", "moved": False, "deleted": False})
    return sp


def new_draft(code, mnt_meta=None):
    """신규 산 초안: mountain/ 스캔 메타 + 산림청 스팟 + 구간망 bbox."""
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
        "spots": _forest_spots_to_draft(code),
        "publish": None,
    }
    return draft


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
        sp.append({"type": "Feature",
                   "geometry": {"type": "Point", "coordinates": s["coord"]},
                   "properties": props})
    return ({"type": "FeatureCollection", "features": feats},
            {"type": "FeatureCollection", "features": sp})
