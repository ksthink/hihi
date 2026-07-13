# 하이하잇 (HiHeight) — 프로젝트 지침

MapLibre GL JS + PMTiles 기반 **대한민국 등산 웹앱**. 흑백(라이트/다크)·오프라인 지향.
로컬 정적 서버 + PMTiles CORS 프록시(`scripts/serve.py`, 포트 8890)로 구동.

## 개발 로드맵 (중요)
- **웹에서 ~80%까지** 현재 형태로 설계·개발한다.
- **이후는 맥북 로컬에서 iOS 네이티브로 완성**한다 (권장: MapLibre Native iOS + SwiftUI).
- iOS 이식 계획서(단일 기준): **`IOS.md`** (v2, 2026-07-13 — 구 `~/.claude/plans/moonlit-rolling-tulip.md` 대체).

## 필수 규칙 — iOS 네이티브 이식을 항상 염두에 둘 것
웹 개발 요청을 처리할 때 **항상 iOS 네이티브 앱 이식을 전제로** 판단한다.
네이티브 이식에 걸림돌이 될 수 있는 선택을 도입하거나 발견하면 **진행 전 반드시 질문하거나 고지**한다.

특히 아래를 경계한다 (발견 시 대안 제시 + 고지):
- **CDN 하드 의존**: `maplibre-gl`·`pmtiles` ESM, `protomaps.github.io` 글리프 폰트 → 네이티브에선 로컬 번들 필요.
- **CORS 프록시 의존**(`serve.py`) → 네이티브는 로컬 PMTiles range 접근이라 불필요. 프록시 전제 설계 피하기.
- **브라우저 전용 API**: `localStorage`(→UserDefaults), `location.hash`(지도 상태), `Blob`/`URL.createObjectURL` 다운로드, `matchMedia`, DOM 드래그 시트.
- **웹 전용 UI 패턴**: HTML/CSS 레이아웃 가정(SwiftUI 로 재작성됨). 시뮬레이터 목업 크롬은 폐기 대상.
- **스텁 기능**: 등반 GPS 트래킹·기록 영속화는 네이티브에서 새로 구현(CoreLocation/백그라운드 위치/SwiftData).
- **데이터/라이선스**: OSM(ODbL 표시+share-alike), Protomaps, 산림청, SRTM 저작자표시. 한국 정밀지도 국외반출 규제 유의.

## 작업일지 규칙
사용자가 **"작업일지 작성"** 이라고 요청하면 `WORKLOG.md` 에 기록한다:
- 환경의 현재 날짜로 `## YYYY-MM-DD` 항목을 만든다(이미 있으면 그 항목에 이어서 추가).
- **최신 날짜가 맨 위**로 오게 정렬.
- 그날 **생성/추가**한 것과 **수정/변경**한 것을 구분해 간결한 불릿으로 기록(파일명 포함).
- 이번 세션에서 실제로 한 작업만 기록(추측 금지).

## 데이터 파이프라인
`scripts/*.py` = 콘텐츠 생성(Overpass OSM·SRTM DEM 등고선/고도·EPSG:5186→WGS84 변환). 산출물은 `data/*.geojson`.
명산별 데이터 팩으로 확장 가능하도록 유지한다.
