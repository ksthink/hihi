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
import urllib.request
import urllib.error
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = "https://demo-bucket.protomaps.com/"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8890


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
        url = UPSTREAM + self.path[len("/pmtiles/"):]
        req = urllib.request.Request(url)
        for h in ("Range", "If-Match", "If-None-Match"):
            v = self.headers.get(h)
            if v:
                req.add_header(h, v)
        try:
            resp = urllib.request.urlopen(req, timeout=30)
        except urllib.error.HTTPError as e:
            resp = e  # 206/304/416 등도 헤더/본문 보유
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
