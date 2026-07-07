#!/usr/bin/env python3
"""정적 파일 + PMTiles 프록시 서버.

- 일반 경로: hihi 디렉터리의 정적 파일을 그대로 서빙
- /pmtiles/<path>: 원격 Protomaps 버킷으로 Range 요청을 그대로 전달하고
  응답에 CORS 헤더를 붙여 반환 → 브라우저 same-origin 이 되어 CORS 회피

사용: python3 scripts/serve.py [port]   (기본 8890)
"""
import os
import sys
import shutil
import datetime
import threading
import urllib.request
import urllib.error
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Protomaps 기저 타일 소스. 과거 demo-bucket 의 고정 파일(v4.pmtiles)이 삭제되어(2026-07)
# 날짜별 빌드(build.protomaps.com/<YYYYMMDD>.pmtiles, 약 1주 보관)를 자동 탐지해 사용한다.
# 앱은 /pmtiles/<무엇이든> 로 요청 → 항상 최신 빌드로 매핑(로테이션에도 안 깨짐).
BUILD_HOST = os.environ.get("PMTILES_BUILD_HOST", "https://build.protomaps.com/")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8890

_build_lock = threading.Lock()
_build_file = None  # 예: "20260707.pmtiles" (프로세스 캐시)


def resolve_build(force=False):
    """가장 최근 유효한 build.protomaps.com 날짜 빌드 파일명을 찾아 캐시."""
    global _build_file
    with _build_lock:
        if _build_file and not force:
            return _build_file
        today = datetime.datetime.utcnow().date()
        for i in range(0, 15):
            fn = (today - datetime.timedelta(days=i)).strftime("%Y%m%d") + ".pmtiles"
            try:
                req = urllib.request.Request(BUILD_HOST + fn)
                req.add_header("Range", "bytes=0-0")
                req.add_header("User-Agent", "hiheight/1.0")  # build.protomaps.com 은 기본 urllib UA 를 403 차단
                r = urllib.request.urlopen(req, timeout=10)
                if r.status < 400:
                    _build_file = fn
                    return fn
            except Exception:
                continue
        _build_file = today.strftime("%Y%m%d") + ".pmtiles"  # 폴백
        return _build_file


class Handler(SimpleHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range, If-Match, If-None-Match")
        self.send_header(
            "Access-Control-Expose-Headers",
            "ETag, Content-Range, Accept-Ranges, Content-Length",
        )

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/pmtiles/"):
            return self._proxy()
        return super().do_GET()

    def _proxy(self):
        # 요청 파일명은 무시하고 항상 최신 Protomaps 빌드로 매핑
        def fetch(build):
            url = BUILD_HOST + build
            req = urllib.request.Request(url)
            req.add_header("User-Agent", "hiheight/1.0")  # build.protomaps.com 은 기본 urllib UA 를 403 차단
            for h in ("Range", "If-Match", "If-None-Match"):
                v = self.headers.get(h)
                if v:
                    req.add_header(h, v)
            try:
                return urllib.request.urlopen(req, timeout=30)
            except urllib.error.HTTPError as e:
                return e  # 206/304/416 등도 헤더/본문 보유
        try:
            resp = fetch(resolve_build())
            if getattr(resp, "status", 200) == 404:  # 빌드가 로테이션됨 → 재탐지 후 1회 재시도
                resp = fetch(resolve_build(force=True))
        except Exception as e:
            self.send_error(502, f"upstream error: {e}")
            return
        try:
            self.send_response(resp.status)
            for h in ("Content-Type", "Content-Length", "Content-Range",
                      "Accept-Ranges", "ETag", "Last-Modified"):
                v = resp.headers.get(h)
                if v:
                    self.send_header(h, v)
            self._cors()
            self.end_headers()
            if self.command != "HEAD":
                shutil.copyfileobj(resp, self.wfile)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            try:
                resp.close()
            except Exception:
                pass

    def do_HEAD(self):
        if self.path.startswith("/pmtiles/"):
            return self._proxy()
        return super().do_HEAD()


if __name__ == "__main__":
    handler = partial(Handler, directory=ROOT)
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), handler)
    print(f"Serving {ROOT} on http://0.0.0.0:{PORT}  (PMTiles proxy at /pmtiles/)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.shutdown()
