#!/usr/bin/env python3
"""레거시 시드 스크립트 (현행 배포는 관리자 콘솔/publish_pack.py).

- data/*.geojson 을 **Cloudflare R2** packs/<mountain_id>/ 로 업로드 (egress 무료)
- mountains 카탈로그 행 upsert (Supabase DB)
- R2 자격증명은 .env (R2_* 키), mountains upsert 는 SUPABASE_SECRET_KEY

사용:
  export SUPABASE_URL=https://durnojryhhsajnlwvdzt.supabase.co
  export SUPABASE_SECRET_KEY=sb_secret_...        # ⚠️ 비밀! 커밋 금지 (로컬 .env 로만)
  python3 scripts/upload_packs.py

Secret 키(sb_secret_…, 구 service_role)는 RLS 를 우회하므로 절대 저장소/클라이언트 코드에
두지 말 것. env 로만 주입하고, 이 스크립트는 서버/로컬에서만 실행.
(레거시 service_role 키는 2026-07-04 폐기 → 신규 Secret 키 사용)
"""
import json
import os
import sys
import urllib.error
import urllib.request

import r2_lib

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE", "")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

if not URL or not KEY:
    sys.exit("환경변수 SUPABASE_URL, SUPABASE_SECRET_KEY 를 설정하세요.")

# 명산 팩: mountain_id(= 산림청 산코드 9자리, scripts/MNT_CODE.xlsx) -> {로컬파일: Storage 파일명}
# base.pmtiles 재생성: pmtiles extract <v4 소스> data/tiles/<id>-base.pmtiles --bbox=<bbox> --maxzoom=15
PACKS = {
    "113050202": {  # 북한산(백운대 대표코드)
        "data/tiles/bukhansan-base.pmtiles": "base.pmtiles",
        "data/bukhansan-routes.geojson": "routes.geojson",
        "data/bukhansan-spots.geojson": "spots.geojson",
        "data/bukhansan-contours.geojson": "contours.geojson",
    },
    "428302602": {  # 설악산(대청봉 대표코드)
        "data/tiles/seoraksan-base.pmtiles": "base.pmtiles",
        "data/seoraksan-routes.geojson": "routes.geojson",
        "data/seoraksan-spots.geojson": "spots.geojson",
        "data/seoraksan-contours.geojson": "contours.geojson",
    },
    "412900401": {  # 청계산(과천 대표코드)
        "data/tiles/cheonggyesan-base.pmtiles": "base.pmtiles",
        "data/cheonggyesan-routes.geojson": "routes.geojson",
        "data/cheonggyesan-spots.geojson": "spots.geojson",
        "data/cheonggyesan-contours.geojson": "contours.geojson",
    },
}

def content_type(name):
    return ("application/octet-stream" if name.endswith(".pmtiles")
            else "application/geo+json")

# mountains 카탈로그 (app.js 의 PARKS/FAMOUS 와 일치)
MOUNTAINS = [
    {"id": "113050202", "name": "북한산", "region": "서울·경기", "elev": 836,
     "center": [126.990, 37.672], "zoom": 11.3,
     "bbox": [126.90, 37.59, 127.06, 37.75], "pack_version": 3},
    {"id": "428302602", "name": "설악산", "region": "강원 속초·양양", "elev": 1708,
     "center": [128.403, 38.133], "zoom": 11.3,
     "bbox": [128.30, 38.07, 128.51, 38.19], "pack_version": 2},
    {"id": "412900401", "name": "청계산", "region": "서울·과천·성남", "elev": 616,
     "center": [127.035, 37.42], "zoom": 12.0,
     "bbox": [126.98, 37.36, 127.09, 37.47], "pack_version": 1},
]


def req(method, path, data=None, headers=None, raw=False):
    h = {"Authorization": "Bearer " + KEY, "apikey": KEY}
    if headers:
        h.update(headers)
    body = data if raw else (json.dumps(data).encode() if data is not None else None)
    r = urllib.request.Request(URL + path, data=body, method=method, headers=h)
    try:
        resp = urllib.request.urlopen(r, timeout=60)
        return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def ensure_bucket():
    st, out = req("POST", "/storage/v1/bucket",
                  {"id": "packs", "name": "packs", "public": True},
                  {"Content-Type": "application/json"})
    if st in (200, 201):
        print("버킷 packs 생성")
    elif st == 409 or b"already exists" in out.lower() or b"Duplicate" in out:
        print("버킷 packs 이미 존재")
    else:
        print(f"버킷 생성 응답 {st}: {out[:200]}")


def upload(local, dest):
    # 팩 파일은 Cloudflare R2(hihi/packs/) 로 업로드 — egress 무료. (mountains 카탈로그는 Supabase DB)
    size = r2_lib.upload_file(os.path.join(ROOT, local), f"packs/{dest}")
    print("업로드 OK(R2)  " + dest)
    return size


def seed_mountains(sizes):
    rows = [dict(m, pack_size_kb=sizes.get(m["id"], 0)) for m in MOUNTAINS]
    st, out = req("POST", "/rest/v1/mountains", rows,
                  {"Content-Type": "application/json",
                   "Prefer": "resolution=merge-duplicates,return=minimal"})
    print("mountains upsert OK" if st in (200, 201, 204)
          else f"mountains upsert 실패({st}) {out[:200]}")


def main():
    # ensure_bucket()  # R2 로 이관 — 버킷은 이미 존재(Supabase 버킷 생성 불필요)
    sizes = {}
    for mid, files in PACKS.items():
        total = 0
        for local, dest in files.items():
            total += upload(local, f"{mid}/{dest}")
        sizes[mid] = total // 1024
    seed_mountains(sizes)
    print("완료.")


if __name__ == "__main__":
    main()
