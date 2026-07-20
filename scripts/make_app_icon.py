#!/usr/bin/env python3
"""iOS 앱 아이콘 생성 — 흑백 산 실루엣 + 정상 위치 마커.

  python3 scripts/make_app_icon.py

앱의 흑백 컨셉을 그대로 따른다(검정 배경 · 흰 실루엣). 산은 좌·우·아래로 흘려보내
아이콘을 꽉 채우고, 주봉 정상에 현재위치 마커를 얹어 "산 + 내 위치"를 한 형태로 만든다.
등고선을 실루엣 안에 넣는 안도 시도했으나 홈화면 크기(120px)에서 케이크 층처럼 뭉쳐 폐기.

SVG 렌더러(ImageMagick)의 clip-path 지원이 불안정해 Pillow 로 직접 합성한다.
4배 슈퍼샘플링 후 축소해 안티에일리어싱을 얻는다.
"""
from pathlib import Path
from PIL import Image, ImageDraw

SS = 4                                   # 슈퍼샘플 배율
SIZE = 1024
N = SIZE * SS
OUT = (Path(__file__).resolve().parent.parent
       / "ios/HiHeight/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png")

# 좌 낮은 봉 + 우 주봉(비대칭이 산답다). 좌표는 1024 기준, 캔버스 밖으로 넘겨 블리드.
MOUNTAIN = [(-60, 1084), (300, 430), (452, 622), (640, 300), (1084, 1084)]
PEAK = (640, 300)                        # 주봉 정상 = 마커 중심
MARKER = [(92, "black"), (60, "white"), (26, "black")]   # (반지름, 색) 바깥→안쪽


def main() -> None:
    img = Image.new("RGB", (N, N), "black")     # RGB = 알파 없음(App Store 요구)
    d = ImageDraw.Draw(img)
    d.polygon([(x * SS, y * SS) for x, y in MOUNTAIN], fill="white")

    # 정상 마커 — 검정 테두리가 흰 실루엣과 마커를 분리해 준다
    for r, color in MARKER:
        d.ellipse([(PEAK[0] - r) * SS, (PEAK[1] - r) * SS,
                   (PEAK[0] + r) * SS, (PEAK[1] + r) * SS], fill=color)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.resize((SIZE, SIZE), Image.LANCZOS).save(OUT)
    print(f"wrote {OUT} ({SIZE}x{SIZE}, no alpha)")


if __name__ == "__main__":
    main()
