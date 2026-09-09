import math
import numpy as np
from PIL import Image

# HiHeight/HikerSprite.swift 를 찍어내는 생성기.
#
#   python3 HikerSprite-gen.py          미리보기 gen.png / gen.gif 만 만든다
#   python3 HikerSprite-gen.py --swift  HiHeight/HikerSprite.swift 를 다시 쓴다
#
# 상체는 원본 스프라이트 시트에서 뽑은 한 프레임으로 고정하고(모든 프레임이 픽셀 단위로
# 동일하다) 다리만 관절 모델로 그린다. 걸음을 바꾸려면 STRIDE·LIFT·LEG 를 만지고
# --swift 로 다시 찍어낼 것.

# 상체 20행 — 지금 앱에 들어가 있는 것 그대로. 스틱(15~16열)은 따로 그리므로 뺐다.
BODY = [
 "............####..",
 "........#####.###.",
 ".......#######.###",
 "....##########.##.",
 "....#####....##...",
 ".....###......#...",
 ".....##.#...#.#...",
 ".....##.#...#.#...",
 "..#####.......#...",
 ".#######.....##...",
 "######.#.#####....",
 "#####...#..##.....",
 "#####...#...#..##.",
 "#####..#.###.#####",
 "########.###.#####",
 "########...#...###",
 ".####...#########.",
 "..###.......#..##.",
 ".....########..##.",
 ".....########..##.",
]
W, H = 18, 31
GROUND = 29.0          # 발이 닿는 바닥 행
HIPS   = (6.0, 11.0)   # 두 다리의 골반 x — 원본 반바지 폭(5~12열)에 맞춘다
LEG    = 8.4           # 다리 전체 길이(칸)
STRIDE = 2.5           # 보폭 절반
LIFT   = 1.9           # 유각기 발 들림
STANCE = 0.62          # 한 주기 중 디딤기 비율

def foot(u, hx):
    """다리 하나의 발 위치. u=0 에서 앞으로 딛는다."""
    u %= 1.0
    if u < STANCE:                       # 디딤기 — 발은 바닥에 붙어 뒤로 흐른다
        s = u / STANCE
        return hx + STRIDE - 2*STRIDE*s, GROUND
    s = (u - STANCE) / (1 - STANCE)      # 유각기 — 발이 떠서 앞으로 돌아온다
    return hx - STRIDE + 2*STRIDE*s, GROUND - LIFT*math.sin(math.pi*s)

def hip_y(feet):
    """디딤발이 닿는 한 골반 높이는 그 발까지의 거리로 정해진다 — 자연스러운 상하 흔들림."""
    ys=[]
    for (fx, fy), hx in zip(feet, HIPS):
        if fy >= GROUND - 0.05:                       # 바닥에 붙은 발만 구속한다
            d = min(abs(fx - hx), LEG - 0.4)
            ys.append(fy - math.sqrt(LEG*LEG - d*d))
    return min(ys) if ys else GROUND - LEG

def knee(hx, hy, fx, fy, bend=1.0):
    dx, dy = fx-hx, fy-hy
    d = math.hypot(dx, dy); d = min(d, LEG-0.05)
    h = math.sqrt(max((LEG/2)**2 - (d/2)**2, 0.0))
    mx, my = hx+dx/2, hy+dy/2
    ux, uy = dx/d, dy/d
    return mx - uy*h*bend*-1, my + ux*h*bend*-1      # 무릎은 앞(+x)으로 굽는다

def blank():
    return [[False]*W for _ in range(H)]

def dilate(a):
    out=blank()
    for y in range(H):
        for x in range(W):
            if a[y][x]:
                for dy in (-1,0,1):
                    for dx in (-1,0,1):
                        yy,xx=y+dy,x+dx
                        if 0<=xx<W and 0<=yy<H: out[yy][xx]=True
    return out

def under(base, top):
    """top 의 둘레 한 칸을 base 에서 파낸다 — 1비트 그림에서 앞뒤를 가르는 방법."""
    hole=dilate(top)
    for y in range(H):
        for x in range(W):
            if hole[y][x] and not top[y][x]: base[y][x]=False

def merge(dst, src):
    for y in range(H):
        for x in range(W):
            if src[y][x]: dst[y][x]=True

def seg(grid, x0,y0,x1,y1, r):
    n = int(max(abs(x1-x0), abs(y1-y0))*4)+2
    for i in range(n+1):
        t=i/n; cx=x0+(x1-x0)*t; cy=y0+(y1-y0)*t
        for yy in range(int(cy-r-1), int(cy+r+2)):
            for xx in range(int(cx-r-1), int(cx+r+2)):
                if 0<=xx<W and 0<=yy<H and (xx+0.5-cx)**2+(yy+0.5-cy)**2 <= r*r:
                    grid[yy][xx]=True

def frame(t):
    feet=[foot(t, HIPS[0]), foot(t+0.5, HIPS[1])]
    hy=hip_y(feet)

    def leg(i):
        L=blank(); fx,fy=feet[i]; hx=HIPS[i]
        kx,ky=knee(hx,hy,fx,fy)
        seg(L, hx,hy, kx,ky, 1.5)                     # 허벅지
        seg(L, kx,ky, fx,fy, 1.3)                     # 정강이
        seg(L, fx-0.9,fy-0.5, fx+1.4,fy-0.5, 1.2)     # 등산화
        return L

    far, near = sorted(range(2), key=lambda i: feet[i][0])   # 뒤에 있는 발이 먼 다리
    g  = leg(far)
    nl = leg(near)
    under(g, nl); merge(g, nl)                        # 앞다리 둘레를 파내 뒤다리와 가른다

    top = int(round(hy)) - 19                         # 상체 아래 끝(19행=반바지)을 골반에

    P=blank()                                         # 스틱 — 상체 아래로 뻗어 바닥에 박힌다
    for y in range(top+20, int(GROUND)+1):
        for x in (15,16):
            if 0<=y<H: P[y][x]=True
    under(g, P)                                       # 스틱은 다리보다 앞 — 다리만 파낸다

    B=blank()
    for r,row in enumerate(BODY):
        for c,ch in enumerate(row):
            if ch=='#' and 0<=top+r<H: B[top+r][c]=True
    merge(g, B); merge(g, P)
    return ["".join('#' if v else '.' for v in row) for row in g]

def frames(n=8):
    return [frame(i/n) for i in range(n)]

def png(fs, Z=10, pad=10, path='gen-preview.png'):
    ims=[Image.fromarray(np.where(np.array([[c=='#' for c in r] for r in f]),0,255)
         .astype('uint8')).resize((W*Z,H*Z), Image.NEAREST) for f in fs]
    sh=Image.new('L',((W*Z+pad)*len(ims)+pad, H*Z+2*pad),235)
    for i,g in enumerate(ims): sh.paste(g,(pad+i*(W*Z+pad),pad))
    sh.save(path)

def gif(fs, Z=6, path='gen-preview.gif', ms=110):
    ims=[Image.fromarray(np.where(np.array([[c=='#' for c in r] for r in f]),0,255)
         .astype('uint8')).resize((W*Z,H*Z), Image.NEAREST).convert('P') for f in fs]
    ims[0].save(path, save_all=True, append_images=ims[1:], duration=ms, loop=0)

SWIFT_PATH = 'HiHeight/HikerSprite.swift'

def swift(fs):
    n=len(fs)
    out=[f"""import SwiftUI

// 스플래시의 걷는 등산가 — {W}×{H} 칸 픽셀 스프라이트, {n}프레임.
//
// ⚠️ 원본 스프라이트 시트를 그대로 재생하지 않는다. 시트(24프레임·8프레임 두 장 모두)는
//    프레임마다 픽셀 격자가 어긋나 있어 — 이웃 프레임 간 다른 픽셀이 3~17%, 다리만
//    움직이는 걷기라면 5% 안쪽이어야 한다 — 그대로 쓰면 걷는 게 아니라 캐릭터 전체가
//    지글거린다. 두 시트 모두 번호가 비어 있는 목업이기도 했다.
//
//    그래서 **상체는 시트에서 뽑은 한 프레임으로 고정**하고(모든 프레임이 픽셀 단위로
//    동일하다), 다리만 관절 모델로 그렸다. 무릎은 2관절 역기구학으로 풀고, 골반 높이는
//    디딤발까지의 거리에서 나오므로 상하 흔들림이 저절로 생긴다. 겹친 다리는 앞다리
//    둘레 한 칸을 파내 갈랐다 — 1비트 그림에서 앞뒤를 구분하는 방법이다.
//
// ⚠️ 손으로 고치지 말 것. 이 배열은 ios/HikerSprite-gen.py 가 찍어낸 것이다.
//    걸음을 바꾸려면 그 파일의 STRIDE·LIFT·LEG 를 만지고 --swift 로 다시 찍어내라.
enum HikerSprite {{
    static let cols = {W}
    static let rows = {H}
    static let frameCount = {n}

    static let frames: [[String]] = ["""]
    for i,f in enumerate(fs):
        out.append(f'        [   // {i+1}')
        out += [f'            "{row}",' for row in f]
        out.append('        ],')
    out.append("""    ]
}

// 제자리 걷기. Canvas 로 칸을 직접 채우므로 어떤 크기에서도 뭉개지지 않는다.
struct HikerWalk: View {
    var cell: CGFloat = 5                    // 칸 한 변(pt)
    var tint: Color
    var period: Double = 0.105               // 프레임당 노출(초) — 8프레임 한 바퀴 0.84초

    var body: some View {
        TimelineView(.periodic(from: .now, by: period)) { ctx in
            let i = Int(ctx.date.timeIntervalSinceReferenceDate / period)
                % HikerSprite.frameCount
            Canvas { g, _ in
                for (r, row) in HikerSprite.frames[i].enumerated() {
                    for (c, ch) in row.enumerated() where ch == "#" {
                        g.fill(Path(CGRect(x: CGFloat(c) * cell, y: CGFloat(r) * cell,
                                           width: cell, height: cell)),
                               with: .color(tint))
                    }
                }
            }
            .frame(width: cell * CGFloat(HikerSprite.cols),
                   height: cell * CGFloat(HikerSprite.rows))
        }
    }
}""")
    return "\n".join(out)+"\n"

if __name__=='__main__':
    import sys, os
    os.chdir(os.path.dirname(os.path.abspath(__file__)))   # 미리보기를 스크립트 옆에 쓴다
    fs=frames(8)
    png(fs); gif(fs)
    if '--swift' in sys.argv:
        open(SWIFT_PATH,'w').write(swift(fs))
        print('찍어냄', SWIFT_PATH)
    print('ok', len(fs), f'{W}x{H}')
