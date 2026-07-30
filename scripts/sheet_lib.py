#!/usr/bin/env python3
"""시트 탭 — 산 메타·스팟을 표(그리드/xlsx)로 열람·편집·백업·가져오기.

그리드(JSON)와 xlsx 가 같은 행 스키마를 쓴다(왕복 대칭 — 내보낸 파일을 그대로 올리면 무변경).
  mountains: code(키, 수정 금지) name region elev sort_order famous bac100 knps published
  spots:     code(산코드) id(키, 비우면 신규) category name lat lng detail etc
             main disp_zoom disp_icon disp_size disp_bold deleted

병합 규칙:
  - 행 = 그 항목의 전체 상태(빈 칸 = 빈 값). 내보내기가 항상 전 칸을 채우므로 왕복 무손실.
  - 시트에서 행이 빠져도 삭제하지 않는다 — deleted=TRUE 표시 행만 소프트 삭제(사고 방지).
  - 신규 산 등록은 시트로 불가(bbox·DEM 이 필요 — 산 편집 탭에서).
적용 전 자동 백업: admin_data/backups/<UTC ts>/<code>-draft.json (최근 30세트 보관, 복원 가능).
"""
import io
import json
import os
import shutil
import time
import uuid

import draft_store

BACKUP_DIR = os.path.join(draft_store.ADMIN_DATA, "backups")
BACKUP_KEEP = 30

MNT_FIELDS = ["code", "name", "region", "elev", "sort_order",
              "famous", "bac100", "knps", "published"]
MNT_LABELS = {"code": "산코드", "name": "이름", "region": "지역", "elev": "해발(m)",
              "sort_order": "노출순서", "famous": "100대명산", "bac100": "BAC100",
              "knps": "공식탐방로", "published": "공개"}
SPOT_FIELDS = ["code", "mountain", "id", "category", "name", "lat", "lng",
               "detail", "etc", "main", "disp_zoom", "disp_icon", "disp_size",
               "disp_bold", "deleted"]
SPOT_LABELS = {"code": "산코드", "mountain": "산(참고)", "id": "ID(수정 금지)",
               "category": "분류", "name": "이름", "lat": "위도", "lng": "경도",
               "detail": "상세", "etc": "비고", "main": "주봉",
               "disp_zoom": "표시줌(99=끔)", "disp_icon": "기호(비움=분류따름)",
               "disp_size": "크기", "disp_bold": "볼드", "deleted": "삭제"}


# ── 행 변환 ──────────────────────────────────────────────────────────────

def _mnt_row(d):
    m = d["mountain"]
    lists = m.get("lists") or []
    return {"code": m["code"], "name": m.get("name"), "region": m.get("region"),
            "elev": m.get("elev"), "sort_order": m.get("sort_order", 100),
            "famous": bool(m.get("famous")), "bac100": "bac100" in lists,
            "knps": "knps" in lists, "published": bool(m.get("published", True)),
            "pack_version": (d.get("publish") or {}).get("pack_version")}


def _spot_row(code, mname, s):
    return {"code": code, "mountain": mname, "id": s["id"],
            "category": s.get("category"), "name": s.get("name"),
            "lat": s["coord"][1], "lng": s["coord"][0],
            "detail": s.get("detail"), "etc": s.get("etc"),
            "main": bool(s.get("main")),
            "disp_zoom": s.get("disp_zoom"), "disp_icon": s.get("disp_icon"),
            "disp_size": s.get("disp_size"), "disp_bold": s.get("disp_bold"),
            "deleted": bool(s.get("deleted"))}


def collect():
    """전 산의 시트 행 — 그리드 표시·xlsx 내보내기 공용."""
    mnts, spots = [], []
    for meta in draft_store.list_drafts():
        d = draft_store.load(meta["code"])
        mnts.append(_mnt_row(d))
        for s in d["spots"]:
            spots.append(_spot_row(meta["code"], d["mountain"]["name"], s))
    mnts.sort(key=lambda r: (r["sort_order"], r["code"]))
    return {"mountains": mnts, "spots": spots}


# ── xlsx 내보내기/파싱 ────────────────────────────────────────────────────

def export_xlsx():
    import openpyxl
    wb = openpyxl.Workbook()
    data = collect()

    def fill(ws, fields, labels, rows):
        ws.append(fields)                                   # 1행 = 키(파싱 기준)
        ws.append([labels[k] for k in fields])              # 2행 = 한글 설명
        for r in rows:
            ws.append([_cell(r.get(k)) for k in fields])
        ws.freeze_panes = "A3"
        for i, k in enumerate(fields, 1):
            ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = \
                14 if k in ("name", "region", "detail", "etc", "mountain") else 10

    fill(wb.active, MNT_FIELDS, MNT_LABELS, data["mountains"])
    wb.active.title = "mountains"
    fill(wb.create_sheet("spots"), SPOT_FIELDS, SPOT_LABELS, data["spots"])
    rd = wb.create_sheet("설명")
    for line in ("· 1행(영문 키)은 수정 금지 — 가져오기가 이 행으로 컬럼을 찾습니다.",
                 "· code/id 는 병합 키 — 수정하면 다른 항목을 덮어씁니다. 스팟 신규는 id 를 비우세요.",
                 "· 행을 지워도 삭제되지 않습니다 — deleted 컬럼에 TRUE 를 넣어야 삭제됩니다.",
                 "· 빈 칸 = 빈 값(해제). 신규 산 등록은 시트로 불가 — 관리자 산 편집에서.",
                 "· 가져오기 후 변경된 산은 재발행해야 앱에 반영됩니다."):
        rd.append([line])
    rd.column_dimensions["A"].width = 80
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _cell(v):
    return v if v is None or isinstance(v, (int, float, bool)) else str(v)


def parse_xlsx(data):
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    out = {}
    for sheet, fields in (("mountains", MNT_FIELDS), ("spots", SPOT_FIELDS)):
        if sheet not in wb.sheetnames:
            raise ValueError(f"'{sheet}' 시트가 없습니다 — 내보낸 파일 양식을 유지하세요")
        ws = wb[sheet]
        rows = ws.iter_rows(values_only=True)
        head = [str(c).strip() if c is not None else "" for c in next(rows, [])]
        idx = {}
        for k in fields:
            if k not in head:
                raise ValueError(f"{sheet}: '{k}' 컬럼이 없습니다 — 1행(키)을 수정하지 마세요")
            idx[k] = head.index(k)
        parsed = []
        for rn, row in enumerate(rows, start=2):
            vals = {k: row[i] if i < len(row) else None for k, i in idx.items()}
            if all(v in (None, "") for v in vals.values()):
                continue                                    # 완전 빈 행
            if rn == 2 and str(vals.get("code") or "") in ("산코드", ""):
                continue                                    # 2행 = 한글 설명 행
            vals["_row"] = rn
            parsed.append(vals)
        out[sheet] = parsed
    return out


# ── 정규화·검증 ──────────────────────────────────────────────────────────

def _b(v):
    """불리언 칸 — TRUE/FALSE·1/0·예/아니오·빈 칸(False) 허용."""
    if isinstance(v, bool):
        return v
    if v in (None, ""):
        return False
    s = str(v).strip().lower()
    if s in ("true", "1", "1.0", "y", "yes", "o", "예", "참"):
        return True
    if s in ("false", "0", "0.0", "n", "no", "x", "아니오", "거짓"):
        return False
    raise ValueError(f"불리언이 아님: {v!r}")


def _txt(v):
    s = str(v).strip() if v is not None else ""
    return s or None


def _num(v, lo, hi, what):
    if v in (None, ""):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"{what}: 숫자가 아님 ({v!r})")
    if not (lo <= f <= hi):
        raise ValueError(f"{what}: 범위 밖 ({v!r}, {lo}~{hi})")
    return f


def _norm_mnt(r):
    code = str(r.get("code") or "").strip()
    if not code.isdigit() or len(code) != 9:
        raise ValueError(f"산코드가 9자리 숫자가 아님: {r.get('code')!r}")
    name = _txt(r.get("name"))
    if not name:
        raise ValueError("이름이 비어 있음")
    elev = _num(r.get("elev"), 0, 3000, "해발")
    so = _num(r.get("sort_order"), 0, 9999, "노출순서")
    return {"code": code, "name": name, "region": _txt(r.get("region")),
            "elev": int(elev) if elev is not None else None,
            "sort_order": int(so) if so is not None else 100,
            "famous": _b(r.get("famous")), "bac100": _b(r.get("bac100")),
            "knps": _b(r.get("knps")), "published": _b(r.get("published"))}


def _norm_spot(r, cats):
    code = str(r.get("code") or "").strip()
    if not code.isdigit() or len(code) != 9:
        raise ValueError(f"산코드가 9자리 숫자가 아님: {r.get('code')!r}")
    cat = _txt(r.get("category"))
    if cat not in cats:
        raise ValueError(f"분류 '{cat}' 없음 (가능: {', '.join(sorted(cats))})")
    lat = _num(r.get("lat"), 32.0, 39.5, "위도")
    lng = _num(r.get("lng"), 124.0, 132.0, "경도")
    if lat is None or lng is None:
        raise ValueError("좌표(위도·경도)가 비어 있음")
    icon = r.get("disp_icon")
    if icon in (None, ""):
        icon = None
    elif isinstance(icon, bool):
        pass
    else:
        icon = str(icon).strip()
        if icon.lower() in ("true", "false"):
            icon = icon.lower() == "true"
        elif not (1 <= len(icon) <= 2) or any(ord(ch) > 0xFFFF for ch in icon):
            raise ValueError(f"기호는 BMP 문자 1~2자: {icon!r} (이모지 불가 — 지도에서 조용히 사라짐)")
    dz = _num(r.get("disp_zoom"), 0, 99, "표시줌")
    ds = _num(r.get("disp_size"), 4, 40, "크기")
    return {"code": code, "id": _txt(r.get("id")), "category": cat,
            "name": _txt(r.get("name")),
            "coord": [round(lng, 6), round(lat, 6)],
            "detail": _txt(r.get("detail")), "etc": _txt(r.get("etc")),
            "main": _b(r.get("main")),
            "disp_zoom": dz, "disp_icon": icon,
            "disp_size": ds, "disp_bold": _b(r.get("disp_bold")) or None,
            "deleted": _b(r.get("deleted"))}


# ── 변경 계획(diff) ──────────────────────────────────────────────────────

MNT_MERGE = ["name", "region", "elev", "sort_order", "famous", "published"]
SPOT_MERGE = ["category", "name", "coord", "detail", "etc", "main",
              "disp_zoom", "disp_icon", "disp_size", "disp_bold", "deleted"]


def build_plan(incoming, spot_cats):
    """정규화 + 현재 draft 와 비교 → 변경 계획. 오류가 있으면 적용 불가."""
    plan = {"errors": [], "warnings": [], "mountains": [], "spots": [], "_drafts": {}}

    def draft(code):
        if code not in plan["_drafts"]:
            plan["_drafts"][code] = draft_store.load(code)
        return plan["_drafts"][code]

    for r in incoming.get("mountains", []):
        where = f"mountains {r.get('_row', '?')}행"
        try:
            n = _norm_mnt(r)
        except ValueError as e:
            plan["errors"].append(f"{where}: {e}")
            continue
        d = draft(n["code"])
        if not d:
            plan["errors"].append(f"{where}: 등록되지 않은 산코드 {n['code']} — 산 등록은 산 편집 탭에서")
            continue
        m = d["mountain"]
        cur_lists = set(m.get("lists") or [])
        changes = {}
        for k in MNT_MERGE:
            old = m.get(k, 100 if k == "sort_order" else None)
            if k in ("famous", "published"):
                old = bool(old if old is not None else (k == "published"))
            if old != n[k]:
                changes[k] = [old, n[k]]
        new_lists = {x for x in ("bac100", "knps") if n[x]}
        if cur_lists != new_lists:
            changes["lists"] = [sorted(cur_lists), sorted(new_lists)]
        if changes:
            plan["mountains"].append({"code": n["code"], "name": n["name"],
                                      "changes": changes, "_norm": n})

    seen_main = {}
    for r in incoming.get("spots", []):
        where = f"spots {r.get('_row', '?')}행"
        try:
            n = _norm_spot(r, spot_cats)
        except ValueError as e:
            plan["errors"].append(f"{where}: {e}")
            continue
        d = draft(n["code"])
        if not d:
            plan["errors"].append(f"{where}: 등록되지 않은 산코드 {n['code']}")
            continue
        if n["main"] and not n["deleted"]:
            if n["code"] in seen_main:
                plan["warnings"].append(
                    f"{where}: 주봉이 산 {n['code']} 에 2개 이상 — 마지막 행이 주봉이 됩니다")
            seen_main[n["code"]] = n["id"] or where
        if not n["id"]:                                    # 신규
            if n["deleted"]:
                continue                                    # 신규+삭제 = 무의미
            n["id"] = f"sp-man-{uuid.uuid4().hex[:6]}"
            plan["spots"].append({"code": n["code"], "id": n["id"], "name": n["name"],
                                  "category": n["category"], "action": "추가", "_norm": n})
            continue
        cur = next((s for s in d["spots"] if s["id"] == n["id"]), None)
        if cur is None:
            plan["errors"].append(f"{where}: 스팟 id '{n['id']}' 없음 — 내보낸 id 를 유지하세요"
                                  " (신규는 id 를 비움)")
            continue
        changes = {}
        for k in SPOT_MERGE:
            old = cur.get(k)
            if k in ("main", "deleted"):
                old = bool(old)
            new = n[k]
            if k == "coord":
                if [round(c, 6) for c in (old or [0, 0])] != new:
                    changes[k] = [old, new]
                continue
            if (old if old not in ("",) else None) != new:
                changes[k] = [old, new]
        if changes:
            act = "삭제" if changes.get("deleted", [None, None])[1] else (
                "복원" if "deleted" in changes else "수정")
            plan["spots"].append({"code": n["code"], "id": n["id"],
                                  "name": n["name"] or cur.get("name"),
                                  "category": n["category"], "action": act,
                                  "changes": changes, "_norm": n})
    return plan


def public_plan(plan):
    """클라이언트 응답용 — 내부 필드 제거."""
    return {"errors": plan["errors"], "warnings": plan["warnings"],
            "mountains": [{k: v for k, v in m.items() if not k.startswith("_")}
                          for m in plan["mountains"]],
            "spots": [{k: v for k, v in s.items() if not k.startswith("_")}
                      for s in plan["spots"]]}


# ── 적용·백업·복원 ───────────────────────────────────────────────────────

def _changed_codes(plan):
    return sorted({m["code"] for m in plan["mountains"]} | {s["code"] for s in plan["spots"]})


def apply_plan(plan):
    if plan["errors"]:
        raise ValueError("오류가 있어 적용할 수 없습니다")
    codes = _changed_codes(plan)
    if not codes:
        return {"ok": True, "backup": None, "codes": [], "mountains": 0, "spots": 0}
    ts = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    bdir = os.path.join(BACKUP_DIR, ts)
    os.makedirs(bdir, exist_ok=True)
    for code in codes:                                     # 적용 직전 스냅샷
        shutil.copy2(draft_store.draft_path(code), os.path.join(bdir, f"{code}-draft.json"))
    _prune_backups()

    for m in plan["mountains"]:
        d = plan["_drafts"][m["code"]]
        n = m["_norm"]
        d["mountain"].update({k: n[k] for k in MNT_MERGE})
        d["mountain"]["lists"] = [x for x in ("bac100", "knps") if n[x]]
    for s in plan["spots"]:
        d = plan["_drafts"][s["code"]]
        n = s["_norm"]
        if s["action"] == "추가":
            d["spots"].append({"id": n["id"], "category": n["category"], "name": n["name"],
                               "coord": n["coord"], "detail": n["detail"], "etc": n["etc"],
                               "origin": "manual", "moved": False, "deleted": False,
                               "main": n["main"],
                               **{k: n[k] for k in ("disp_zoom", "disp_icon",
                                                    "disp_size", "disp_bold")
                                  if n[k] is not None}})
        else:
            cur = next(x for x in d["spots"] if x["id"] == n["id"])
            for k in SPOT_MERGE:
                if k == "coord":
                    if "coord" in (s.get("changes") or {}):
                        cur["coord"] = n["coord"]
                        cur["moved"] = True
                    continue
                cur[k] = n[k]
        # 주봉 유일화 — 시트에서 주봉으로 지정된 스팟이 있으면 그 산의 다른 주봉 해제
    for code, d in plan["_drafts"].items():
        if not d:
            continue
        mains = [s for s in d["spots"] if s.get("main") and not s.get("deleted")]
        for s in mains[:-1]:
            s["main"] = False
    for code in codes:
        draft_store.save(code, plan["_drafts"][code])
    return {"ok": True, "backup": ts, "codes": codes,
            "mountains": len(plan["mountains"]), "spots": len(plan["spots"])}


def list_backups():
    if not os.path.isdir(BACKUP_DIR):
        return []
    out = []
    for ts in sorted(os.listdir(BACKUP_DIR), reverse=True)[:BACKUP_KEEP]:
        d = os.path.join(BACKUP_DIR, ts)
        if not os.path.isdir(d):
            continue
        codes = [f.split("-draft.json")[0] for f in sorted(os.listdir(d))
                 if f.endswith("-draft.json")]
        out.append({"ts": ts, "codes": codes})
    return out


def restore(ts):
    if not ts or "/" in ts or ".." in ts:
        raise ValueError("잘못된 백업 id")
    bdir = os.path.join(BACKUP_DIR, ts)
    if not os.path.isdir(bdir):
        raise FileNotFoundError(f"백업 {ts} 없음")
    codes = []
    for f in sorted(os.listdir(bdir)):
        if not f.endswith("-draft.json"):
            continue
        code = f.split("-draft.json")[0]
        d = json.load(open(os.path.join(bdir, f), encoding="utf-8"))
        draft_store.save(code, d)
        codes.append(code)
    return {"ok": True, "ts": ts, "codes": codes}


def _prune_backups():
    if not os.path.isdir(BACKUP_DIR):
        return
    for ts in sorted(os.listdir(BACKUP_DIR), reverse=True)[BACKUP_KEEP:]:
        shutil.rmtree(os.path.join(BACKUP_DIR, ts), ignore_errors=True)
