#!/usr/bin/env python3
"""100대명산 봉우리POI 전량 수집 → cache/peak-poi.json (관리자 '정상' 스팟 후보 소스).

데이터: 한국등산트레킹지원센터 peakPoiInfoService (data.go.kr B553662, 총 ~960건, 일 1회 갱신)
인증키: .env PEAK_POI_KEY (URL 인코딩된 형태 그대로)
주의: 백엔드가 curl/urllib 기본 UA 를 거부 → 브라우저형 UA 필수.

실행: .venv/bin/python scripts/fetch_peak_poi.py
"""
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "cache", "peak-poi.json")
BASE = "https://apis.data.go.kr/B553662/peakPoiInfoService/getPeakPoiInfoList"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 hiheight-admin"


def load_env():
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            s = line.strip()
            if s and not s.startswith("#") and "=" in s:
                k, v = s.split("=", 1)
                os.environ.setdefault(k, v)


def fetch_page(key, page, rows=200, tries=3):
    url = f"{BASE}?serviceKey={key}&numOfRows={rows}&pageNo={page}&type=json"
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.load(r)
            body = d["response"]["body"]
            items = body.get("items") or {}
            rows_ = items.get("item") or []
            if isinstance(rows_, dict):  # 1건이면 dict 로 오는 공공API 관례
                rows_ = [rows_]
            return rows_, int(body.get("totalCount") or 0)
        except Exception as e:
            if i == tries - 1:
                raise
            print(f"  page {page} 재시도 ({e})")
            time.sleep(3)


def main():
    load_env()
    key = os.environ.get("PEAK_POI_KEY")
    if not key:
        sys.exit("PEAK_POI_KEY 미설정 (.env)")
    out, page = [], 1
    while True:
        rows, total = fetch_page(key, page)
        for a in rows:
            out.append({
                "poiId": a.get("poiId"), "frtrlId": a.get("frtrlId"),
                "mountain": (a.get("frtrlNm") or "").strip(),
                "name": (a.get("placeNm") or "").strip() or None,
                "lon": a.get("lot"), "lat": a.get("lat"),
                "alt": a.get("aslAltide"), "desc": (a.get("dscrtCn") or "").strip() or None,
                "type": a.get("orgnPlaceTpeCd"),
            })
        print(f"page {page}: 누적 {len(out)}/{total}")
        if len(out) >= total or not rows:
            break
        page += 1
        time.sleep(0.4)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    mts = {r["mountain"] for r in out}
    print(f"저장: {OUT} — POI {len(out)}건 · 산 {len(mts)}곳")


if __name__ == "__main__":
    main()
