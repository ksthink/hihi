# 🥾 하이하잇 (HiHeight) — 오프라인 등산 앱

MapLibre GL JS + PMTiles 로 만든 대한민국(북한산·설악산) 등산로 탐방 앱입니다.
iOS 네이티브 앱 전환을 염두에 두고 **iPhone 17(402×874) 시뮬레이터 프레임** 안에서
모바일 UI(전체화면 지도 + 하단 시트 + 하단 탭바)로 동작합니다.

## 컨셉

- **오프라인 우선** · 대한민국 지형 대상 · 등산 최적화
- **배터리 절약** — 색상을 배제한 **흑백(모노크롬)** UI, **화이트/다크** 두 모드만 제공
  (다크는 순수 검정 배경으로 OLED 절전). 베이스맵도 흑백으로 렌더링.

## 기능

- 🗺️ PMTiles 벡터 기저 지도 (흑백, 화이트/다크 테마 대응)
- 🧭 하단 탭바: **탐험 · 추천 · 등반 · 기록**
- 🥾 탐험: 북한산 / 설악산 전환, 등산로 목록 · 지도 이동 · 바텀시트
- 🏔️ 주요 봉우리(백운대·대청봉·울산바위 등) 라벨
- 📊 난이도(초급/중급/고급)는 색이 아닌 **흑백 막대 미터 + 선 굵기**로 표현
- 🌓 좌상단 테마 토글(화이트/다크, 선택 저장)
- 📍 현재 위치, 축척 컨트롤
- 📌 **북한산 시설 스팟 803개** (이정표·조망점·화장실·음수대·위험지역·정자 등)
  흑백 마커로 표시, 시트에서 표시/숨김 토글, 지도 확대 시 강조 스팟 라벨 노출

## 스팟 데이터 (EPSG:5186 → WGS84)

원본 `PMNTN_SPOT_북한산_114100801.json` 은 산림청 등산로 스팟 Esri JSON 으로
좌표가 **EPSG:5186(Korea 2000 / Central Belt, TM)** 미터 단위입니다.
`scripts/convert_spots.py` 가 의존성 없이 TM 역투영(GRS80)으로 WGS84 경위도로 변환해
`data/bukhansan-spots.geojson` 을 생성합니다.

```bash
python3 scripts/convert_spots.py scripts/spots_raw_북한산.json data/bukhansan-spots.geojson
```

## 등산로 루트 데이터 (실제)

북한산 등산로는 **OpenStreetMap** 데이터로 만든 **40개 코스**를 사용합니다 (OSM 은 이미 WGS84):

- **능선·계곡 등산로 22개** — 이름 있는 `highway=path/footway` (의상능선·칼바위능선·원효길·진달래길 …).
  `sac_scale` 로 난이도 산정(hiking→초급, mountain→중급, demanding→고급).
- **북한산둘레길 18개 구간** — `route=hiking` 릴레이션.

```bash
# 1) Overpass 조회 (mail.ru 미러가 빠름; kumi/de 는 rate-limit 잦음)
EP=https://maps.mail.ru/osm/tools/overpass/api/interpreter
Q1='[out:json][timeout:120];way["highway"~"^(path|footway)$"]["name"](37.60,126.93,37.71,127.04);out geom;'
Q2='[out:json][timeout:280];rel["route"="hiking"]["name"~"북한산둘레길"](37.58,126.92,37.73,127.06);out geom;'
curl -s --data-urlencode "data=$Q1" "$EP" -o scripts/osm_named_geom.json
curl -s --data-urlencode "data=$Q2" "$EP" -o scripts/osm_dulle.json
# 2) 능선 등산로 + 둘레길 합쳐 변환
python3 scripts/osm_trails.py scripts/osm_named_geom.json scripts/osm_dulle.json data/bukhansan-routes.geojson
```

> 참고: 산림청 데이터 기반 대안 스크립트(`extract_routes.py` 백운대 라우팅,
> `convert_baegundae.py`, `convert_routes.py`)도 저장소에 남아 있습니다.

## 등고선 (SRTM DEM)

기저 지도(Protomaps)에는 표고 데이터가 없어, **SRTM 1-arcsec DEM** 에서 등고선을 생성해
오버레이합니다. `scripts/make_contours.py` 가 numpy/contourpy 로 50m 간격 등고선을 만들어
`data/bukhansan-contours.geojson`(100m 주 등고선 + 50m 보조, 고도 라벨)을 생성합니다.

```bash
# DEM 타일 다운로드 (AWS elevation-tiles-prod, 무료)
for T in N37E126 N37E127; do
  curl -s "https://elevation-tiles-prod.s3.amazonaws.com/skadi/N37/$T.hgt.gz" -o scripts/$T.hgt.gz
  gunzip -f scripts/$T.hgt.gz
done
# venv(numpy, contourpy) 필요
python scripts/make_contours.py data/bukhansan-contours.geojson
```

지도에서 100m 등고선은 줌 10.5+, 50m 보조는 12.5+, 고도 라벨은 13.5+ 에서 표시됩니다.

> 참고: 시설 스팟(화장실·음수대 등)은 여전히 홍은동 구간(114100801) 자료라 지도 남쪽에 위치합니다.
> `scripts/convert_routes.py` 는 그 홍은동 자락길 변환용으로 남겨둡니다.

```bash
python3 scripts/convert_routes.py scripts/route_raw.json data/bukhansan-routes.geojson
```

> 설악산은 아직 샘플(`data/seoraksan.geojson`)이며, 실제 루트 JSON을 주면 같은 방식으로 교체합니다.
- ⬇️ **지도 데이터 다운로드**
  - 등산로 데이터: GeoJSON 파일로 즉시 다운로드
  - 오프라인 기저 지도: 선택한 산 영역만 잘라내는 `pmtiles` 추출 스크립트 다운로드

## 실행

브라우저 보안(ES 모듈 · fetch) 때문에 정적 서버로 열어야 합니다.

```bash
cd hihi
python3 -m http.server 8890
# 브라우저에서 http://localhost:8890 접속
```

또는:

```bash
npx serve .
```

## 오프라인 지도 데이터 받기

사이드바의 **"오프라인 지도 추출 스크립트"** 버튼을 누르면 선택한 산의 bbox가 담긴
`extract-<산>.sh` 스크립트가 내려받아집니다. 실행하려면 `pmtiles` CLI가 필요합니다.

```bash
# 1) pmtiles CLI 설치 (https://github.com/protomaps/go-pmtiles/releases)
# 2) 내려받은 스크립트 실행
bash extract-bukhansan.sh
# → bukhansan-offline.pmtiles 생성 (북한산 영역만, 수 MB 수준)

# 3) 로컬에서 확인
pmtiles serve .
```

`app.js` 상단의 `PMTILES_URL` 을 내려받은 오프라인 파일 경로로 바꾸면
인터넷 없이도 해당 영역 지도를 볼 수 있습니다.

## 파일 구조

| 파일 | 설명 |
|------|------|
| `index.html` | 페이지 골격 · 사이드바 UI |
| `app.js` | 지도 초기화, PMTiles 등록, 등산로/봉우리 레이어, 다운로드 |
| `basemap-style.js` | Protomaps v4 스키마용 MapLibre 스타일 정의 |
| `style.css` | 스타일시트 |
| `data/*.geojson` | 등산로 · 봉우리 데이터 |

## 데이터 출처 / 주의

- 기저 지도: [Protomaps](https://protomaps.com) PMTiles, © [OpenStreetMap](https://openstreetmap.org) 기여자
- ⚠️ **등산로 라인은 개략적인 샘플 데이터입니다.** 실제 위치·거리와 다를 수 있으니
  산행 시 국립공원공단 공식 지도를 확인하세요.
