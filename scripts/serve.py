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

# 기저 타일 소스: 자체 호스팅 Cloudflare R2(한국 영역 base, egress 무료).
# 과거 demo-bucket.protomaps.com/v4.pmtiles(고정 파일)가 2026-07 삭제된 이후 R2 로 이관.
# 이 프록시는 웹 전용 same-origin 계층(브라우저 CORS 회피용) — iOS 네이티브는 로컬 번들
# range 접근이라 불필요(폐기 대상). 앱은 /pmtiles/* 로 요청 → R2 고정 객체로 매핑.
R2_PUB = os.environ.get("R2_PUB", "https://pub-cfc2302f77a446c1a0fdff6d0ae4e451.r2.dev")
# /pmtiles/<파일명> → R2 객체. 허용 목록 밖 파일명(레거시 v4.pmtiles 등)은 base 로 폴백.
PMTILES_FILES = {"kr-base.pmtiles", "kr-terrain.pmtiles"}
PMTILES_URL = os.environ.get("PMTILES_URL", f"{R2_PUB}/kr-base.pmtiles")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 로컬 원본(데이터 제작 산출물)이 디스크에 있으면 R2 왕복 없이 그 파일을 Range 서빙 —
# 타일 요청당 ~50-70ms(신규 TLS 연결 포함)를 절약. 없으면 기존대로 R2 프록시.
TILES_DIR = os.path.join(ROOT, "data", "tiles")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8890


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # 정적 파일 캐시 정책. Cache-Control 부재 시 브라우저 휴리스틱 캐시가 파일별로
        # 제각각 동작해, 배포 직후 구 basemap-style.js + 신 app.js 같은 모듈 버전 섞임이
        # 생긴다(임포트 링크 에러 → 앱 전체 정지). no-cache = 매 로드 재검증(304 아님,
        # SimpleHTTPRequestHandler 는 조건부 GET 미지원이라 전체 재전송 — 1인 운영엔 충분).
        # 글리프(내용 안정·파일 512개)만 1일 캐시, PMTiles 프록시/로컬은 자체 헤더 사용.
        if not self.path.startswith("/pmtiles/"):
            self.send_header(
                "Cache-Control",
                "max-age=86400" if self.path.startswith("/fonts/") else "no-cache")
        super().end_headers()

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
        # /pmtiles/<파일명> → 허용 목록이면 해당 R2 객체, 아니면 base (Range 그대로 전달)
        name = self.path.rsplit("/", 1)[-1].split("?")[0]
        if name in PMTILES_FILES:
            local = os.path.join(TILES_DIR, name)
            if os.path.isfile(local):
                return self._serve_local(local)
        url = f"{R2_PUB}/{name}" if name in PMTILES_FILES else PMTILES_URL
        req = urllib.request.Request(url)
        req.add_header("User-Agent", "hiheight/1.0")  # R2 pub.r2.dev 는 기본 urllib UA 를 403 차단
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

    def _serve_local(self, path):
        # 로컬 pmtiles 를 Range 지원으로 서빙 (SimpleHTTPRequestHandler 는 Range 미지원이라 직접 구현)
        size = os.path.getsize(path)
        etag = f'"{int(os.path.getmtime(path))}-{size}"'
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self._cors()
            self.end_headers()
            return
        start, end, status = 0, size - 1, 200
        rng = self.headers.get("Range")
        if rng and rng.startswith("bytes="):
            try:
                s, _, e = rng[6:].partition("-")
                if s:
                    start = int(s)
                    if e:
                        end = min(int(e), size - 1)
                else:  # 접미 범위 bytes=-N (마지막 N 바이트)
                    start = max(0, size - int(e))
                if start >= size or start > end:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self._cors()
                    self.end_headers()
                    return
                status = 206
            except ValueError:
                start, end, status = 0, size - 1, 200
        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(length))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("ETag", etag)
        self._cors()
        self.end_headers()
        if self.command == "HEAD":
            return
        try:
            with open(path, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(1 << 20, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
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
