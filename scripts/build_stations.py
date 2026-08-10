#!/usr/bin/env python3
"""에어코리아 측정소 목록(673곳·좌표)을 `api/_stations.json` 으로 굽는다.

왜 굽는가 — 매 요청(서버리스는 cold start 마다)에 800건을 외부에서 받으면, 그 한 번의
실패가 그대로 `{station:null}` 이 되고 캐시까지 되면 그 사이 화면이 통째로 빈다
(2026-08-10 실제: 웹은 나오는데 앱만 미세먼지가 비었다). 측정소는 신설·폐지가 드무니
파일이 기본이고 API 는 갱신용이다.

  KNPS_KEY=... python3 scripts/build_stations.py     # 필요할 때만(측정소 신설·폐지 시)

`dmX` 가 위도, `dmY` 가 경도다 — 이름과 반대이므로 주의.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "api", "_stations.json")
URL = "https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList"


def main():
    key = os.environ.get("KMA_KEY") or os.environ.get("KNPS_KEY")
    if not key:
        # 로컬 .env 에서 읽어 본다 — 별도 export 없이 돌리기 위함.
        try:
            with open(os.path.join(ROOT, ".env"), encoding="utf-8") as f:
                for line in f:
                    k, _, v = line.partition("=")
                    if k.strip() in ("KMA_KEY", "KNPS_KEY") and v.strip():
                        key = v.strip()
                        break
        except OSError:
            pass
    if not key:
        sys.exit("KMA_KEY / KNPS_KEY 가 없습니다")

    sk = key if "%" in key else urllib.parse.quote(key, safe="")
    q = urllib.parse.urlencode({"returnType": "json", "pageNo": "1", "numOfRows": "800"})
    req = urllib.request.Request(f"{URL}?serviceKey={sk}&{q}",
                                 headers={"User-Agent": "hiheight/1.0"})
    # 이 API 는 504 를 곧잘 낸다(이 폴백을 만든 이유이기도 하다). 몇 번 더 두드려 본다.
    body, last = None, None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = (json.load(r).get("response") or {}).get("body") or {}
            break
        except Exception as e:                      # noqa: BLE001 — 사유 무관하게 재시도
            last = e
            print(f"  조회 실패({attempt + 1}/4): {e}", file=sys.stderr)
            time.sleep(3)
    if body is None:
        sys.exit(f"측정소 목록을 받지 못했습니다 — {last}. 기존 파일을 그대로 둡니다.")

    out = []
    for s in body.get("items") or []:
        try:
            lat, lon = float(s["dmX"]), float(s["dmY"])
        except (KeyError, TypeError, ValueError):
            continue
        if not s.get("stationName"):
            continue
        out.append({"name": s["stationName"], "addr": s.get("addr") or None,
                    "lat": lat, "lon": lon})

    if len(out) < 500:
        sys.exit(f"측정소가 {len(out)}곳뿐입니다 — 조회가 온전치 않아 덮어쓰지 않습니다")

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{OUT} — {len(out)}곳 (전체 {body.get('totalCount')})")


if __name__ == "__main__":
    main()
