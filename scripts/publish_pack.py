#!/usr/bin/env python3
"""draft → 팩 산출 → Supabase 배포 파이프라인 (관리자 '배포' 버튼의 실체).

단계 (JobManager 진행 보고):
 1. draft → data/packs/<산코드>/{routes,spots}.geojson
 2. DEM 확보 (cache/dem, 미보유 시 AWS 다운로드)
 3. 등고선 → contours.geojson (Copernicus 50m/100m)
 4. 기저 타일 → data/tiles/<산코드>-base.pmtiles (tools/pmtiles extract,
    bbox 불변 + 파일 존재 시 스킵. 소스는 env PMTILES_SOURCE)
 5. Storage packs/<산코드>/ 4파일 업로드 (x-upsert)
 6. mountains upsert (pack_version+1, updated_at)
 7. draft.publish 갱신

secret 키는 .env(SUPABASE_SECRET_KEY) 로만. CLI 단독 실행:
  .venv/bin/python scripts/publish_pack.py <산코드>
"""
import datetime
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

import dem_cache
import draft_store
import pack_lib as pl
import r2_lib

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://durnojryhhsajnlwvdzt.supabase.co").rstrip("/")
PMTILES_SOURCE = os.environ.get("PMTILES_SOURCE", "https://demo-bucket.protomaps.com/v4.pmtiles")
PMTILES_BIN = os.path.join(pl.ROOT, "tools", "pmtiles")


def _key():
    k = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE")
    if not k:
        raise RuntimeError("SUPABASE_SECRET_KEY 미설정 (.env)")
    return k


def _req(method, path, data=None, headers=None, raw=False):
    h = {"Authorization": "Bearer " + _key(), "apikey": _key()}
    if headers:
        h.update(headers)
    body = data if raw else (json.dumps(data).encode() if data is not None else None)
    r = urllib.request.Request(SUPABASE_URL + path, data=body, method=method, headers=h)
    try:
        resp = urllib.request.urlopen(r, timeout=120)
        return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _upload(local, dest):
    # 팩 파일은 Cloudflare R2(hihi/packs/) 에 업로드 — egress 무료. mountains 카탈로그는 Supabase DB 유지.
    return r2_lib.upload_file(local, f"packs/{dest}")


def publish(code, job=None, step=None):
    """배포 실행. job/step 은 admin_server JobManager 콜백 (없으면 콘솔 출력)."""
    log = (lambda s, p: step(job, s, p)) if job else (lambda s, p: print(f"[{p:.0%}] {s}"))
    draft = draft_store.load(code)
    if not draft:
        raise FileNotFoundError(f"{code} 초안 없음")
    m = draft["mountain"]
    bbox = m["bbox"]
    ready = [c for c in draft["courses"] if c["status"] == "ready"]
    if not ready:
        raise ValueError("배포(ready) 상태 코스가 없음")

    # 1. geojson 산출
    log(f"팩 생성: 코스 {len(ready)}개, 스팟", 0.05)
    pack_dir = os.path.join(pl.ROOT, "data", "packs", code)
    os.makedirs(pack_dir, exist_ok=True)
    routes_fc, spots_fc = draft_store.to_pack(draft)
    for name, fc in (("routes.geojson", routes_fc), ("spots.geojson", spots_fc)):
        json.dump(fc, open(os.path.join(pack_dir, name), "w", encoding="utf-8"),
                  ensure_ascii=False, separators=(",", ":"))

    # 2~3. DEM → 등고선
    log("DEM 확보", 0.15)
    tifs = dem_cache.ensure(bbox, log=lambda s: job["log"].append(s) if job else print(s))
    log("등고선 생성 (Copernicus 50m)", 0.25)
    import make_contours_copernicus as mc
    mc.generate(os.path.join(pack_dir, "contours.geojson"), bbox, tifs,
                log=lambda s: job["log"].append(s) if job else print(s))

    # 4. 기저 타일
    tiles_dir = os.path.join(pl.ROOT, "data", "tiles")
    os.makedirs(tiles_dir, exist_ok=True)
    tile_f = os.path.join(tiles_dir, f"{code}-base.pmtiles")
    prev = draft.get("publish") or {}
    if os.path.exists(tile_f) and prev.get("tiles_bbox") == bbox:
        log("기저 타일 재사용 (bbox 불변)", 0.5)
    else:
        log("기저 타일 추출 (pmtiles extract — 수 분 소요)", 0.4)
        bbox_s = ",".join(str(v) for v in bbox)
        r = subprocess.run([PMTILES_BIN, "extract", PMTILES_SOURCE, tile_f,
                            f"--bbox={bbox_s}", "--maxzoom=15"],
                           capture_output=True, text=True, timeout=1800)
        if r.returncode != 0:
            raise RuntimeError(f"pmtiles extract 실패: {r.stderr[-300:]}")

    # 5. 업로드
    files = {os.path.join(tiles_dir, f"{code}-base.pmtiles"): "base.pmtiles",
             os.path.join(pack_dir, "routes.geojson"): "routes.geojson",
             os.path.join(pack_dir, "spots.geojson"): "spots.geojson",
             os.path.join(pack_dir, "contours.geojson"): "contours.geojson"}
    total = 0
    for i, (local, dest) in enumerate(files.items()):
        log(f"업로드 {dest}", 0.55 + 0.08 * i)
        total += _upload(local, f"{code}/{dest}")

    # 6. mountains upsert
    version = (prev.get("pack_version") or 0) + 1
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    log(f"카탈로그 갱신 (v{version})", 0.9)
    row = {"id": code, "name": m["name"], "region": m.get("region"),
           "elev": m.get("elev"), "center": m["center"], "zoom": m["zoom"],
           "bbox": bbox, "pack_version": version, "pack_size_kb": total // 1024,
           "sort_order": m.get("sort_order", 100), "published": m.get("published", True),
           "famous": m.get("famous", False), "updated_at": now}
    st, out = _req("POST", "/rest/v1/mountains", [row],
                   {"Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates,return=minimal"})
    if st == 400 and b"PGRST204" in out:
        # 마이그레이션 전(신규 컬럼 부재) 호환 — 기본 컬럼만으로 재시도.
        # supabase/migrations-001-admin.sql 실행 후에는 sort_order/published/famous 반영됨.
        log("신규 컬럼 없음 → 기본 컬럼으로 upsert (migrations-001-admin.sql 실행 요망)", 0.92)
        for k in ("sort_order", "published", "famous", "updated_at"):
            row.pop(k, None)
        st, out = _req("POST", "/rest/v1/mountains", [row],
                       {"Content-Type": "application/json",
                        "Prefer": "resolution=merge-duplicates,return=minimal"})
    if st not in (200, 201, 204):
        raise RuntimeError(f"mountains upsert 실패({st}): {out[:200]}")

    # 7. draft.publish 갱신 (동시 편집 반영 위해 재로드)
    d = draft_store.load(code)
    d["publish"] = {"pack_version": version,
                    "published_at": now,
                    "pack_size_kb": total // 1024,
                    "tiles_bbox": bbox}
    draft_store.save(code, d)
    log(f"배포 완료: v{version} · {total // 1024 // 1024}MB", 1.0)
    return {"pack_version": version, "pack_size_kb": total // 1024}


if __name__ == "__main__":
    # CLI: .env 수동 로드
    envp = os.path.join(pl.ROOT, ".env")
    if os.path.exists(envp):
        for line in open(envp, encoding="utf-8"):
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ.setdefault(k, v)
    publish(sys.argv[1])
