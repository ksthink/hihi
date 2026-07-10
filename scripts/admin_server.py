#!/usr/bin/env python3
"""하이하잇 관리자 서버 — 코스 큐레이션·팩 배포 콘솔.

serve.py(정적+PMTiles 프록시)를 상속하고 /api/* JSON 라우트와 백그라운드 잡을 얹는다.
사용자 앱(/)과 관리자(/admin/)를 같은 포트에서 서빙하므로 serve.py 대체로 쓰면 된다.

운영자 1인용. 원격(EC2 등) 접속을 위해 기본 0.0.0.0 바인딩이며, /api 는
**토큰 인증**(.env ADMIN_TOKEN, 최초 실행 시 자동 생성)으로 보호한다.
localhost(127.0.0.1) 요청은 토큰 없이 허용. Supabase secret 키는 .env 로만
로드(클라이언트로 절대 전달 안 함). 로컬 전용으로 잠그려면 ADMIN_BIND=127.0.0.1.

사용: .venv/bin/python scripts/admin_server.py [port]   (기본 8890)
접속: http://<호스트>:8890/admin/?token=<ADMIN_TOKEN>   (토큰은 시작 로그에 출력)
"""
import json
import os
import queue
import re
import secrets
import sys
import threading
import time
import traceback
import urllib.parse
import urllib.request
import uuid
from functools import partial
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from serve import Handler as BaseHandler, ROOT  # noqa: E402

import draft_store  # noqa: E402
import pack_lib as pl  # noqa: E402

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8890
BIND = os.environ.get("ADMIN_BIND", "0.0.0.0")

# 스팟 표시 정책 기본값 — 값 = 표시 시작 줌(0=항상), null = 끔. 앱 app.js 의 기본값과 일치 유지.
SPOT_DISPLAY_DEFAULT = {"version": 1, "categories": {
    "정상": 0, "조망점": 18, "화장실": 18, "정자": 18, "헬기장": 18, "음수대": 18,
    "주차장": None, "분기점": None, "시종점": None,
}}


def load_env():
    p = os.path.join(ROOT, ".env")
    if not os.path.exists(p):
        return
    for line in open(p, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def ensure_admin_token():
    """ADMIN_TOKEN 이 없으면 생성해 .env 에 영속화."""
    if os.environ.get("ADMIN_TOKEN"):
        return os.environ["ADMIN_TOKEN"]
    tok = secrets.token_hex(16)
    with open(os.path.join(ROOT, ".env"), "a", encoding="utf-8") as f:
        f.write(f"\n# 관리자 콘솔 /api 인증 토큰 (admin_server.py 자동 생성)\nADMIN_TOKEN={tok}\n")
    os.environ["ADMIN_TOKEN"] = tok
    return tok


# ── 백그라운드 잡 (직렬 1개 — 운영자 1인) ──
class JobManager:
    def __init__(self):
        self.jobs = {}
        self.q = queue.Queue()
        threading.Thread(target=self._worker, daemon=True).start()

    def submit(self, title, fn, code=None):
        jid = uuid.uuid4().hex[:12]
        job = {"id": jid, "title": title, "code": code, "state": "queued",
               "step": "대기 중", "progress": 0.0, "log": [], "result": None, "error": None}
        self.jobs[jid] = job
        self.q.put((job, fn))
        return jid

    def busy(self, code):
        """해당 산코드의 잡이 대기/실행 중인가 (삭제와 배포의 레이스 방지용)."""
        return any(j.get("code") == code and j["state"] in ("queued", "running")
                   for j in self.jobs.values())

    def _worker(self):
        while True:
            job, fn = self.q.get()
            job["state"] = "running"
            try:
                job["result"] = fn(job)
                job["state"] = "done"
                job["progress"] = 1.0
                job["step"] = "완료"
            except Exception as e:
                job["state"] = "error"
                job["error"] = str(e)
                job["log"].append(traceback.format_exc(limit=3))


JOBS = JobManager()


def job_step(job, step, progress):
    job["step"] = step
    job["progress"] = progress
    job["log"].append(step)


# ── 초안 생성/자동 시드 ──
def create_draft(code):
    """초안 생성. legacy 3산은 기존 산출물 역임포트, 그 외는 산림청 원본 기반.
    반환: (draft, job_id|None) — 신규 산은 자동 코스 시드 잡을 건다."""
    if draft_store.load(code):
        raise ValueError(f"{code} 초안이 이미 있음")
    if code in draft_store.LEGACY:
        draft = draft_store.import_legacy(code)
        draft_store.save(code, draft)
        return draft, None

    meta = next((m for m in _mnt_codes() if m["code"] == code), {})
    draft = draft_store.new_draft(code, meta)
    if meta.get("top100"):  # 100대 명산은 추천 노출(famous) 자동 체크
        draft["mountain"]["famous"] = True
    draft_store.save(code, draft)

    # 자동 코스 시드는 폐기 (파편화된 국립공원 구간망에서 괴물 코스 생성 — 부록 D).
    # 코스는 운영자가 GPX 업로드로 직접 입력. DEM 만 미리 받아 첫 recompute 지연을 줄인다.
    def seed(job):
        import dem_cache
        job_step(job, "DEM 타일 확보", 0.3)
        dem_cache.ensure(draft["mountain"]["bbox"],
                         log=lambda m: job["log"].append(m))
        job_step(job, "DEM 준비 완료 — 코스는 GPX 업로드로 입력", 0.95)
        return {"code": code}

    return draft, JOBS.submit(f"{draft['mountain']['name']} DEM 준비", seed, code=code)


_MNT_CACHE = None
_TOP100_CACHE = None


def _top100():
    """cache/top100.json (fetch_top100.py 산출) → {로컬 산코드: 항목}.
    100대 명산 분류(top100)와 정상 좌표·해발고도 소스. 파일 없으면 빈 dict."""
    global _TOP100_CACHE
    if _TOP100_CACHE is None:
        p = os.path.join(ROOT, "cache", "top100.json")
        rows = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else []
        _TOP100_CACHE = {t["local_code"]: t for t in rows if t.get("local_code")}
    return _TOP100_CACHE


def _xlsx_meta():
    """산림청 xlsx(산 소개 시드용으로 보관 중) → {산코드: {region, elev}}.
    이름 중복(전국 317건, 예: 청계산 과천·가평·양평) 구분 표기에 쓴다.
    소재지·높이는 mnt.xlsx 우선, 없으면 MNT_CODE.xlsx 위치로 보충."""
    try:
        import openpyxl
    except ImportError:
        return {}
    meta = {}
    p = os.path.join(ROOT, "scripts", "MNT_CODE.xlsx")  # 순번/산이름/위치/산코드
    if os.path.exists(p):
        ws = openpyxl.load_workbook(p, read_only=True).active
        for r in list(ws.iter_rows(values_only=True))[1:]:
            if r and r[3]:
                loc = str(r[2] or "").strip() or None
                meta[str(r[3]).strip()] = {"region": loc, "elev": None}
    p = os.path.join(ROOT, "scripts", "mnt.xlsx")  # 산코드/산명/…/소재지[6]/…/높이[11]
    if os.path.exists(p):
        ws = openpyxl.load_workbook(p, read_only=True).active
        for r in list(ws.iter_rows(values_only=True))[1:]:
            if not r or not r[0]:
                continue
            cur = meta.setdefault(str(r[0]).strip(), {"region": None, "elev": None})
            loc = str(r[6] or "").strip()
            if loc:
                cur["region"] = loc
            try:
                if r[11] and float(r[11]) > 0:
                    cur["elev"] = round(float(r[11]))
            except (TypeError, ValueError):
                pass
    return meta


def _mnt_codes():
    """mountain/<산코드>/ 스캔 — 내려받은 산림청 원본이 곧 산 목록.
    이름은 PMNTN_<이름>_<산코드>.json 파일명에서 추출, 지역·높이는 xlsx 메타로 보강."""
    global _MNT_CACHE
    if _MNT_CACHE is None:
        base = os.path.join(ROOT, "mountain")
        xm = _xlsx_meta()
        rows = []
        for code in sorted(os.listdir(base)) if os.path.isdir(base) else []:
            dp = os.path.join(base, code)
            if not (re.fullmatch(r"\d{9}", code) and os.path.isdir(dp)):
                continue
            name = code
            for fn in os.listdir(dp):
                m = re.fullmatch(rf"PMNTN_(.+)_{code}\.json", fn)
                if m and not m.group(1).startswith(("SPOT_", "SAFE_")):
                    name = m.group(1).replace("_", " ")
                    break
            m = xm.get(code) or {}
            t = _top100().get(code)  # 100대 명산 분류 + 정상 좌표·고도 보강
            rows.append({"code": code, "name": name,
                         "region": m.get("region") or (t and t["addr"]) or None,
                         # 해발고도: 기존 xlsx 값 우선, 없으면 100대 API 값으로 보충
                         "elev": m.get("elev") or (t and t["elev"] and round(t["elev"])) or None,
                         "top100": bool(t),
                         "peak": t and {"lat": t["lat"], "lon": t["lon"], "elev": t["elev"]}})
        _MNT_CACHE = rows
    return _MNT_CACHE


# 로그인 실패 잠금 (IP 별): 5회 실패 → 10분 잠금
LOGIN_FAILS = {}          # ip -> {"n": 실패 횟수, "until": 잠금 해제 시각}
MAX_FAILS, LOCK_SEC = 5, 600


class AdminHandler(BaseHandler):
    # ── 공통 ──
    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _err(self, msg, status=400):
        self._json({"error": msg}, status)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def _authorized(self, q):
        if self.client_address[0] in ("127.0.0.1", "::1"):
            return True
        tok = os.environ.get("ADMIN_TOKEN")
        if not tok:
            return False
        return (self.headers.get("X-Admin-Token") == tok
                or (q.get("token") or [None])[0] == tok)

    _KMA_OPS = {"ncst": "getUltraSrtNcst", "ufcst": "getUltraSrtFcst", "vfcst": "getVilageFcst"}

    def _weather(self, q):
        """기상청 단기예보 프록시 (CORS 회피 + 키 은닉). api/weather.js 와 동일 계약."""
        op = (q.get("op") or [""])[0]
        path = self._KMA_OPS.get(op)
        need = {k: (q.get(k) or [""])[0] for k in ("nx", "ny", "base_date", "base_time")}
        if not path or not all(need.values()):
            return self._err("bad params", 400)
        key = os.environ.get("KMA_KEY") or os.environ.get("KNPS_KEY")
        if not key:
            return self._err("no KMA_KEY", 500)
        sk = key if re.search(r"%[0-9A-Fa-f]{2}", key) else urllib.parse.quote(key, safe="")
        qs = urllib.parse.urlencode({"dataType": "JSON", "numOfRows": "300", "pageNo": "1", **need})
        url = (f"https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/{path}"
               f"?serviceKey={sk}&{qs}")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "hiheight/1.0"})
            resp = urllib.request.urlopen(req, timeout=20)
            body = resp.read()
        except Exception as e:
            return self._err(f"upstream: {e}", 502)
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "public, max-age=600")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _login(self):
        """비밀번호(.env ADMIN_PASSWORD) 검증 → 성공 시 API 토큰 발급."""
        ip = self.client_address[0]
        now = time.time()
        rec = LOGIN_FAILS.setdefault(ip, {"n": 0, "until": 0.0})
        if now < rec["until"]:
            wait = int(rec["until"] - now)
            return self._json({"error": f"로그인 잠금 — {wait // 60 + 1}분 후 다시 시도하세요",
                               "retry_after": wait}, 429)
        try:
            data = json.loads(self._body() or b"{}")
        except ValueError:
            data = {}
        pw = os.environ.get("ADMIN_PASSWORD")
        if pw and str(data.get("password", "")) == pw:
            LOGIN_FAILS.pop(ip, None)
            return self._json({"token": os.environ["ADMIN_TOKEN"]})
        rec["n"] += 1
        if rec["n"] >= MAX_FAILS:
            rec["n"] = 0
            rec["until"] = now + LOCK_SEC
            return self._json({"error": f"{MAX_FAILS}회 실패 — 10분 동안 접속이 차단됩니다",
                               "retry_after": LOCK_SEC}, 429)
        return self._json({"error": f"비밀번호가 틀렸습니다 (남은 시도 {MAX_FAILS - rec['n']}회)"}, 401)

    def _route(self, method):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        parts = [p for p in u.path.split("/") if p]  # ["api", ...]
        if method == "POST" and parts[1:] == ["login"]:
            return self._login()  # 로그인은 인증 없이 (실패 잠금으로 보호)
        if method == "GET" and parts[1:] == ["weather"]:
            return self._weather(q)  # 앱 공개 기능 — 인증 제외
        if not self._authorized(q):
            return self._err("관리자 인증 필요", 401)
        try:
            return self._dispatch(method, parts[1:], q)
        except FileNotFoundError as e:
            self._err(str(e), 404)
        except ValueError as e:
            self._err(str(e), 400)
        except Exception as e:
            self._err(f"{type(e).__name__}: {e}", 500)
            traceback.print_exc()

    # ── 라우팅 ──
    def _dispatch(self, method, p, q):
        # GET /api/weather?op=&nx=&ny=&base_date=&base_time=  (기상청 프록시)
        if method == "GET" and p == ["weather"]:
            return self._weather(q)

        # GET /api/mnt-codes?q=
        if method == "GET" and p == ["mnt-codes"]:
            kw = (q.get("q") or [""])[0].strip()
            rows = [m for m in _mnt_codes()
                    if kw and (kw in m["name"] or m["code"].startswith(kw))][:30]
            out = [dict(m, has_src=os.path.isdir(os.path.join(ROOT, "mountain", m["code"])),
                        has_draft=draft_store.load(m["code"]) is not None) for m in rows]
            return self._json(out)

        # GET/PUT /api/config/spots — 스팟 표시 정책 (분류별 표시 시작 줌, 앱 전역)
        # 저장: admin_data/spot-display.json (원본) + R2 config/spot-display.json (앱이 부팅 시 fetch)
        if p == ["config", "spots"]:
            cfg_path = os.path.join(draft_store.ADMIN_DATA, "spot-display.json")
            if method == "GET":
                if os.path.exists(cfg_path):
                    return self._json(json.load(open(cfg_path, encoding="utf-8")))
                return self._json(SPOT_DISPLAY_DEFAULT)
            if method == "PUT":
                data = json.loads(self._body())
                cats = data.get("categories")
                if not isinstance(cats, dict):
                    raise ValueError("categories 객체 필요")
                for k, v in cats.items():
                    if k not in SPOT_DISPLAY_DEFAULT["categories"]:
                        raise ValueError(f"알 수 없는 분류: {k}")
                    if v is not None and not (isinstance(v, (int, float)) and 0 <= v <= 22):
                        raise ValueError(f"{k}: 줌은 0~22 또는 null(끔)")
                cfg = {"version": 1, "categories": {**SPOT_DISPLAY_DEFAULT["categories"], **cats}}
                body = json.dumps(cfg, ensure_ascii=False, indent=1).encode()
                os.makedirs(draft_store.ADMIN_DATA, exist_ok=True)
                with open(cfg_path, "wb") as f:
                    f.write(body)
                import r2_lib
                r2_lib.upload_bytes(body, "config/spot-display.json",
                                    content_type="application/json")
                return self._json({"ok": True, **cfg})

        # GET/POST /api/mountains
        if p == ["mountains"]:
            if method == "GET":
                return self._json(draft_store.list_drafts())
            if method == "POST":
                data = json.loads(self._body() or b"{}")
                code = data.get("code", "")
                if not re.fullmatch(r"\d{9}", code):
                    raise ValueError("9자리 산코드 필요")
                draft, jid = create_draft(code)
                return self._json({"code": code, "job_id": jid}, 201)

        # /api/mountains/<code>/...
        if len(p) >= 2 and p[0] == "mountains" and re.fullmatch(r"\d{9}", p[1]):
            code, rest = p[1], p[2:]
            if not rest and method == "DELETE":
                # 앱에서 완전 삭제: Supabase 카탈로그 행 + R2 팩 파일 + 로컬 초안.
                # (초안이 이미 없어도 code 로 배포본을 정리 — 고아 배포본 대응)
                if JOBS.busy(code):
                    raise ValueError("이 산의 배포/준비 작업이 진행 중입니다 — 완료 후 삭제하세요"
                                     " (진행 중 삭제하면 고아 배포본이 생깁니다)")
                import shutil
                import publish_pack
                result = {"code": code}
                try:
                    result.update(publish_pack.unpublish(code))  # 행 + R2 파일
                except Exception as e:  # 네트워크/권한 실패는 보고하되 초안 제거는 진행
                    result["unpublish_error"] = str(e)
                d = os.path.join(draft_store.ADMIN_DATA, code)
                if os.path.isdir(d):
                    shutil.rmtree(d)
                    result["draft_removed"] = True
                return self._json({"ok": True, **result})
            if rest == ["draft"]:
                if method == "GET":
                    d = draft_store.load(code)
                    if not d:
                        raise FileNotFoundError(f"{code} 초안 없음")
                    return self._json(d)
                if method == "PUT":
                    # 갱신 전용 — 생성은 POST /api/mountains 만. 삭제 직후/다른 탭의
                    # 늦은 자동저장이 지워진 초안을 되살리는 것을 차단.
                    if not draft_store.load(code):
                        raise FileNotFoundError(f"{code} 초안 없음 (삭제되었거나 미등록)")
                    d = json.loads(self._body())
                    if d.get("mountain", {}).get("code") != code:
                        raise ValueError("mountain.code 불일치")
                    draft_store.save(code, d)
                    return self._json({"ok": True})
            if rest == ["network"] and method == "GET":
                segs, _ = pl.load_forest_segments(code)
                return self._json(pl.network_geojson(segs))
            if rest == ["gpx"] and method == "POST":
                import gpx_match
                d = draft_store.load(code)
                if not d:
                    raise FileNotFoundError(f"{code} 초안 없음")
                tau = float((q.get("tau") or [25])[0])
                detour = float((q.get("detour") or [1.6])[0])
                raw = self._body()
                return self._json(gpx_match.match_gpx_upload(code, d, raw, tau, detour))
            if len(rest) == 3 and rest[0] == "courses" and rest[2] == "recompute" \
                    and method == "POST":
                import gpx_match
                d = draft_store.load(code)
                cid = rest[1]
                c = next((c for c in d["courses"] if c["id"] == cid), None)
                if not c:
                    raise FileNotFoundError(f"코스 {cid} 없음")
                gpx_match.recompute_course(d, c)
                draft_store.save(code, d)
                return self._json(c)
            if rest == ["publish"] and method == "POST":
                import publish_pack
                d = draft_store.load(code)
                if not d:
                    raise FileNotFoundError(f"{code} 초안 없음")
                jid = JOBS.submit(f"{d['mountain']['name']} 배포",
                                  lambda job: publish_pack.publish(code, job, job_step),
                                  code=code)
                return self._json({"job_id": jid})


        # GET /api/jobs/<id>
        if method == "GET" and len(p) == 2 and p[0] == "jobs":
            job = JOBS.jobs.get(p[1])
            if not job:
                raise FileNotFoundError("잡 없음")
            return self._json(job)

        self._err("no route", 404)

    # ── HTTP 메서드 ──
    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._route("GET")
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self._route("POST")
        self.send_error(405)

    def do_PUT(self):
        if self.path.startswith("/api/"):
            return self._route("PUT")
        self.send_error(405)

    def do_DELETE(self):
        if self.path.startswith("/api/"):
            return self._route("DELETE")
        self.send_error(405)

    def log_message(self, fmt, *args):  # /api 폴링 소음 축소
        # args[0] 이 HTTPStatus 등 비문자열일 수 있음(send_error 경로) — str 로 안전 변환
        if "/api/jobs/" not in str(args[0] if args else ""):
            super().log_message(fmt, *args)


def main():
    load_env()
    tok = ensure_admin_token()
    # (주의) 시작 시 레거시 3산 자동 역임포트는 하지 않는다 — 운영자가 삭제한 산이
    # 서버 재시작(systemd 자동 재시작 포함)마다 되살아났음. 레거시 복원이 필요하면
    # 검색 → 추가 (POST /api/mountains 의 LEGACY 분기)로 명시적으로만.
    handler = partial(AdminHandler, directory=ROOT)
    httpd = ThreadingHTTPServer((BIND, PORT), handler)
    print(f"관리자 콘솔: http://{BIND}:{PORT}/admin/?token={tok}")
    print("(localhost 접속은 토큰 불필요 · 사용자 앱도 같은 포트 / 에서 서빙)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.shutdown()


if __name__ == "__main__":
    main()
