#!/usr/bin/env python3
"""admin/symbols.js 생성 — 지도가 실제로 그릴 수 있는 기호만 뽑는다.

폰트 cmap 을 믿으면 안 된다. MonaS12 는 ♨ ⛰ ☎ ♻ ⚠ ✈ 처럼 **cmap 에는 있지만
글리프 속이 빈** 문자를 여럿 갖고 있고, 그런 문자를 기호로 넣으면 지도에서 아무 표시
없이 사라진다(어디가 잘못됐는지 알 길이 없어 특히 비싸다).

그래서 렌더 경로의 마지막 산출물인 **글리프 PBF 를 직접 읽어** 비트맵이 실제로 들어
있는 것만 남긴다. Regular·Bold 양쪽을 요구하므로 볼드를 켜도 깨지지 않는다.

사용: python3 scripts/gen_symbols.py     (저장소 루트에서)
"""
import glob
import io
import os
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 지도에서 쓸모 있는 순서 = 고르개 탭 순서
BLOCKS = [
    ("기하 도형", 0x25A0, 0x25FF), ("기타 기호", 0x2600, 0x26FF),
    ("딩뱃", 0x2700, 0x27BF), ("한글·CJK 원문자", 0x3200, 0x32FF),
    ("원문자·괄호", 0x2460, 0x24FF), ("단위·약어", 0x3300, 0x33FF),
    ("문자꼴", 0x2100, 0x214F), ("화살표", 0x2190, 0x21FF),
    ("기술 기호", 0x2300, 0x23FF), ("수학", 0x2200, 0x22FF),
    ("숫자꼴", 0x2150, 0x218F), ("CJK 기호", 0x3000, 0x303F),
    ("통화", 0x20A0, 0x20BF), ("한글 자모", 0x3130, 0x318F),
    ("괘선", 0x2500, 0x257F), ("블록", 0x2580, 0x259F), ("구두점", 0x2000, 0x206F),
]
# 첫 탭 — 산 지도에 실제로 어울리는 것들 (卍 은 CJK 통합한자라 블록 열거에 안 걸린다)
PICK = "▲△★☆●○■□◆◇◉◎⊕⊙✚✜✦✧⚑⚐㉿㊟㊕㈜卍"
# 보이지 않거나 단독으로 못 쓰는 부류
BAD_CATEGORY = {"Zs", "Zl", "Zp", "Cf", "Cc", "Mn", "Me", "Sk"}


def _varint(b, i):
    r = s = 0
    while True:
        x = b[i]
        i += 1
        r |= (x & 0x7F) << s
        if not x & 0x80:
            return r, i
        s += 7


def glyph_bitmaps(path):
    """glyphs{stacks=1{glyphs=3{id=1, bitmap=2}}} → {코드포인트: 비트맵 바이트수}"""
    buf = io.open(path, "rb").read()
    out = {}

    def glyph(b):
        i, gid, bm = 0, None, 0
        while i < len(b):
            key, i = _varint(b, i)
            field, wire = key >> 3, key & 7
            if wire == 2:
                ln, i = _varint(b, i)
                if field == 2:
                    bm = ln
                i += ln
            elif wire == 0:
                v, i = _varint(b, i)
                if field == 1:
                    gid = v
            elif wire == 5:
                i += 4
            elif wire == 1:
                i += 8
        if gid is not None:
            out[gid] = bm

    def walk(b, depth):
        i = 0
        while i < len(b):
            key, i = _varint(b, i)
            field, wire = key >> 3, key & 7
            if wire == 2:
                ln, i = _varint(b, i)
                sub, i = b[i:i + ln], i + ln
                if depth == 0 and field == 1:
                    walk(sub, 1)
                elif depth == 1 and field == 3:
                    glyph(sub)
            elif wire == 0:
                _, i = _varint(b, i)
            elif wire == 5:
                i += 4
            elif wire == 1:
                i += 8

    walk(buf, 0)
    return out


def load(stack):
    out = {}
    files = glob.glob(os.path.join(ROOT, "fonts", stack, "*.pbf"))
    if not files:
        sys.exit(f"글리프를 못 찾음: fonts/{stack}/*.pbf")
    for p in files:
        out.update(glyph_bitmaps(p))
    return out


def main():
    reg, bold = load("MonaS12 Regular"), load("MonaS12 Bold")

    def ok(c):
        return (reg.get(c, 0) > 0 and bold.get(c, 0) > 0
                and unicodedata.category(chr(c)) not in BAD_CATEGORY)

    groups = [("자주 쓰는", "".join(c for c in PICK if ok(ord(c))))]
    seen = set(PICK)
    for name, a, b in BLOCKS:
        s = "".join(chr(c) for c in range(a, b + 1) if ok(c) and chr(c) not in seen)
        if s:
            groups.append((name, s))
            seen |= set(s)

    body = "\n".join(
        '  { name: %s, chars: %s },' % (_js(n), _js(s)) for n, s in groups)
    src = (__doc__.split("\n")[0] and "") + f'''// 지도에 쓸 수 있는 기호 — 관리자 "기호" 고르개용.
// ⚠️ 손으로 고른 목록이 아니라 **지도가 실제로 읽는 글리프 파일에서 뽑은 것**이다.
//    fonts/MonaS12 {{Regular,Bold}}/*.pbf 를 열어 Regular·Bold **양쪽에 비트맵이 있는**
//    글자만 남겼다. 폰트 cmap 에 등록만 되고 속이 빈 글자(♨ ⛰ ☎ ♻ ⚠ ✈ 등)는 지도에서
//    조용히 사라지므로 제외한다. 공백·제어·결합문자도 뺐다.
//    글리프 PBF 를 다시 만들면 scripts/gen_symbols.py 로 이 파일도 다시 만들 것.
export const SYMBOL_GROUPS = [
{body}
];
'''
    out = os.path.join(ROOT, "admin", "symbols.js")
    io.open(out, "w", encoding="utf-8").write(src)
    total = sum(len(s) for _, s in groups)
    for n, s in groups:
        print(f"  {n:16s} {len(s):4d}")
    print(f"admin/symbols.js — {len(groups)}묶음 {total}자")


def _js(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


if __name__ == "__main__":
    main()
