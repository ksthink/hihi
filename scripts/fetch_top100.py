#!/usr/bin/env python3
"""산림청 100대 명산 목록 전량 수집 → cache/top100.json (관리자 100대 분류·정상 좌표 소스).

데이터: 한국등산트레킹지원센터 top100FamtListBasiInfoService (data.go.kr B553662, 총 100건)
필드: 산식별자(frtrlId)·산명·산코드(mtnCd)·시도명·주소명·위도·경도·해발고도·데이터추출일시
인증키: .env PEAK_POI_KEY (봉우리POI 서비스와 동일 키, URL 인코딩된 형태 그대로)
주의: 백엔드가 curl/urllib 기본 UA 를 거부 → 브라우저형 UA 필수.

API 의 mtnCd 는 등산로 원본(mountain/<산코드>) 체계와 불일치가 있다(중복 3쌍 포함, 실측 ~20건).
→ 수집 후 이름+정상 좌표(원본 bbox 포함 여부)로 로컬 산코드를 확정해 local_code 로 저장.
  local_code=null 은 산림청 등산로 원본이 없는 산 (국립공원 등 — 관리자 검색에 안 뜸).

실행: .venv/bin/python scripts/fetch_top100.py
"""
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "cache", "top100.json")
BASE = "https://apis.data.go.kr/B553662/top100FamtListBasiInfoService/getTop100FamtListBasiInfoList"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 hiheight-admin"


def load_env():
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            s = line.strip()
            if s and not s.startswith("#") and "=" in s:
                k, v = s.split("=", 1)
                os.environ.setdefault(k, v)


def local_names():
    """mountain/ 스캔 → {이름: [산코드]} (admin_server._mnt_codes 와 동일 규칙)."""
    base = os.path.join(ROOT, "mountain")
    out = {}
    for code in sorted(os.listdir(base)) if os.path.isdir(base) else []:
        dp = os.path.join(base, code)
        if not (re.fullmatch(r"\d{9}", code) and os.path.isdir(dp)):
            continue
        for fn in os.listdir(dp):
            m = re.fullmatch(rf"PMNTN_(.+)_{code}\.json", fn)
            if m and not m.group(1).startswith(("SPOT_", "SAFE_")):
                out.setdefault(m.group(1).replace("_", " "), []).append(code)
                break
    return out


def geom_bbox(code):
    """산림청 원본(ESRI JSON, EPSG:5186) 구간 좌표의 WGS84 bbox — pack_lib 변환 재사용."""
    import pack_lib as pl
    try:
        segs, _ = pl.load_forest_segments(code)
    except Exception:
        return None
    xs = [p[0] for s in segs for p in s["pts"]]
    ys = [p[1] for s in segs for p in s["pts"]]
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


def resolve_local(rows):
    """API 산코드 → 로컬 산코드 확정. 이름 후보 중 정상 좌표가 원본 bbox(±0.05°) 안에
    드는 것만 인정 (복수면 bbox 중심 최근접). 근접 폴백은 두지 않는다 —
    동명이산이 많아(남산 16곳 등) 느슨한 임계는 오매핑을 낳는다. 이름 후보 없으면 null."""
    n2c = local_names()
    have = {c for cs in n2c.values() for c in cs}
    code2name = {c: n for n, cs in n2c.items() for c in cs}
    for t in rows:
        base = re.sub(r"\(.+\)$", "", t["name"])
        # API 코드가 로컬에 있고 이름도 부합하면 그대로 신뢰
        if t["code"] in have and base in code2name[t["code"]]:
            t["local_code"] = t["code"]
            continue
        cands = n2c.get(t["name"]) or n2c.get(base) \
            or [c for n, cs in n2c.items() if base in n for c in cs]
        best, bestD = None, 1e9
        for c in cands:
            bb = geom_bbox(c)
            if not bb:
                continue
            if not (bb[0] - .05 <= t["lon"] <= bb[2] + .05 and bb[1] - .05 <= t["lat"] <= bb[3] + .05):
                continue
            d = abs(t["lon"] - (bb[0] + bb[2]) / 2) + abs(t["lat"] - (bb[1] + bb[3]) / 2)
            if d < bestD:
                best, bestD = c, d
        t["local_code"] = best


def main():
    load_env()
    key = os.environ.get("PEAK_POI_KEY")
    if not key:
        sys.exit(".env 에 PEAK_POI_KEY 가 없습니다")
    url = f"{BASE}?serviceKey={key}&numOfRows=200&pageNo=1&type=json"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r)
    body = d["response"]["body"]
    items = (body.get("items") or {}).get("item") or []
    if len(items) != body.get("totalCount"):
        sys.exit(f"수집 {len(items)}건 ≠ totalCount {body.get('totalCount')}")
    rows = [{
        "frtrlId": it["frtrlId"],            # 산식별자 (봉우리POI frtrlId 와 동일 체계)
        "name": it["frtrlNm"],               # 산명 (동명이산은 '백운산(광양)' 식)
        "code": str(it["mtnCd"]).strip(),    # 산림청 산코드 (mountain/<code> 와 동일 체계)
        "sido": it.get("ctpvNm"),            # 시도명
        "addr": it.get("addrNm"),            # 주소명
        "lat": it.get("lat"),                # 정상 위도
        "lon": it.get("lot"),                # 정상 경도
        "elev": it.get("aslAltide"),         # 해발고도(m)
        "crtrDt": it.get("crtrDt"),          # 데이터추출일시
    } for it in items]
    rows.sort(key=lambda x: x["name"])
    resolve_local(rows)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(rows, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    ok = sum(1 for t in rows if t["local_code"])
    fixed = sum(1 for t in rows if t["local_code"] and t["local_code"] != t["code"])
    print(f"{len(rows)}건 → {OUT} (로컬 매핑 {ok}/100, API 코드 보정 {fixed}건)")
    for t in rows:
        if not t["local_code"]:
            print(f"  원본 없음: {t['name']} ({t['sido']})")


if __name__ == "__main__":
    main()
