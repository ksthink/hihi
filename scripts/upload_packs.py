#!/usr/bin/env python3
"""Supabase 시드 스크립트.

- 'packs' Storage 버킷 생성(공개)
- data/*.geojson 을 packs/<mountain_id>/ 로 업로드
- mountains 카탈로그 행 upsert

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

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE", "")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

if not URL or not KEY:
    sys.exit("환경변수 SUPABASE_URL, SUPABASE_SECRET_KEY 를 설정하세요.")

# 명산 팩: mountain_id -> {로컬파일: Storage 파일명}
PACKS = {
    "bukhansan": {
        "data/bukhansan-routes.geojson": "routes.geojson",
        "data/bukhansan-spots.geojson": "spots.geojson",
        "data/bukhansan-contours.geojson": "contours.geojson",
    },
}

# mountains 카탈로그 (app.js 의 PARKS/FAMOUS 와 일치)
MOUNTAINS = [
    {"id": "bukhansan", "name": "북한산", "region": "서울·경기", "elev": 836,
     "center": [126.990, 37.672], "zoom": 11.3,
     "bbox": [126.90, 37.59, 127.06, 37.75], "pack_version": 1},
    {"id": "seoraksan", "name": "설악산", "region": "강원 속초·양양", "elev": 1708,
     "center": [128.457, 38.135], "zoom": 11.6,
     "bbox": [128.43, 38.08, 128.48, 38.18], "pack_version": 1},
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
    with open(os.path.join(ROOT, local), "rb") as f:
        content = f.read()
    st, out = req("POST", f"/storage/v1/object/packs/{dest}", content,
                  {"Content-Type": "application/geo+json", "x-upsert": "true"}, raw=True)
    ok = st in (200, 201)
    print(("업로드 OK   " if ok else f"업로드 실패({st}) ") + dest +
          ("" if ok else f"  {out[:150]}"))
    return len(content)


def seed_mountains(sizes):
    rows = [dict(m, pack_size_kb=sizes.get(m["id"], 0)) for m in MOUNTAINS]
    st, out = req("POST", "/rest/v1/mountains", rows,
                  {"Content-Type": "application/json",
                   "Prefer": "resolution=merge-duplicates,return=minimal"})
    print("mountains upsert OK" if st in (200, 201, 204)
          else f"mountains upsert 실패({st}) {out[:200]}")


def main():
    ensure_bucket()
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
