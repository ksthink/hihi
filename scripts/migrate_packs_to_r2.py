#!/usr/bin/env python3
"""Supabase Storage packs/ → Cloudflare R2 packs/ 일회성 이관.

기존 산들의 팩 파일(base.pmtiles·routes/spots/contours.geojson)을 Supabase Storage
공개 URL 에서 받아 R2(hihi 버킷)의 동일 키(packs/<산코드>/<파일>)로 업로드한다.
Supabase 원본은 지우지 않음(폴백 유지 — 확인 후 수동 삭제 가능).

사용: .venv/bin/python scripts/migrate_packs_to_r2.py
"""
import sys
import urllib.request

import r2_lib

SUPA = "https://durnojryhhsajnlwvdzt.supabase.co"
PUBK = "sb_publishable_qltsOvZhvVwPF5YNQARgCg_6KcV6Km5"
CODES = ["113050202", "114100301", "116200201", "416301201", "428302602", "412900401"]
FILES = ["base.pmtiles", "routes.geojson", "spots.geojson", "contours.geojson"]


def fetch(url):
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            return r.read() if r.status == 200 else None
    except Exception:
        return None


def main():
    s3 = r2_lib.client()
    total = ok = 0
    for code in CODES:
        for f in FILES:
            key = f"packs/{code}/{f}"
            src = f"{SUPA}/storage/v1/object/public/{key}?apikey={PUBK}"
            data = fetch(f"{SUPA}/storage/v1/object/public/{key}")
            if data is None:
                continue
            total += 1
            r2_lib.upload_bytes(data, key, s3=s3)
            ok += 1
            print(f"  ✓ {key}  ({len(data)//1024} KB)")
    print(f"이관 완료: {ok}/{total} 파일 → R2 {r2_lib.bucket()}/packs/")
    return 0 if ok == total else 1


if __name__ == "__main__":
    sys.exit(main())
