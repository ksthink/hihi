# 하이하잇 (HiHeight) — 오프라인 우선 대한민국 등산 앱

> **"산에서는 네트워크도, 배터리도 아껴야 한다."**

하이하잇은 대한민국 명산의 등산로를 **탐험**하고, 지도를 **오프라인으로 저장**하고,
산행을 **기록·비교**하는 등산 앱입니다.

**웹앱**(MapLibre GL JS)과 **iOS 네이티브 앱**(MapLibre Native + SwiftUI)이 같은 저장소에서
**같은 지도 스타일·같은 데이터 파이프라인**을 공유합니다.

🔗 **웹앱**: https://hihi.ksthink.com
📱 **iOS**: TestFlight 내부 테스터 배포 중 (`dev.metaphr.hiheight`)

---

## 목차
1. [세 가지 원칙](#1-세-가지-원칙)
2. [시스템 한눈에](#2-시스템-한눈에)
3. [파이프라인 — 데이터가 흐르는 길](#3-파이프라인--데이터가-흐르는-길)
4. [탭별 기능 요약](#4-탭별-기능-요약)
5. [실행 · 빌드 · 배포](#5-실행--빌드--배포)
6. [지도 자산 자체 호스팅 · 캐시 정책](#6-지도-자산-자체-호스팅--캐시-정책)
7. [진행 상태](#7-진행-상태)
8. [저장소 구조](#8-저장소-구조)
9. [데이터 출처 · 라이선스](#9-데이터-출처--라이선스)
10. [함께 보면 좋은 문서](#10-함께-보면-좋은-문서)

---

## 1. 세 가지 원칙

- **오프라인 우선** — 산에는 전파가 안 닿는 곳이 많습니다. 지도·등산로·시설 정보를 미리
  기기에 저장해 두고, 등반 중에는 **네트워크 없이** 동작합니다.
- **배터리 절약** — 등산에서 배터리는 안전입니다. 흑백(모노크롬) UI, 다크 = 순수 검정(OLED),
  등반 배터리 모드 3단(일반/절전/최대절전), 지도 없는 내비 화면.
- **대한민국 특화** — 지도 범위를 남한 전역(제주·독도 포함)으로 제한하고, 산별 "팩" 단위로
  등산로·등고선·시설을 관리합니다. 산 식별자는 **산림청 산코드 9자리**(수동 등록 산은
  `9xxxxxxxx` 예약 대역) — R2 폴더명·DB·기기 저장 팩 키가 전부 이 코드를 공유합니다.

---

## 2. 시스템 한눈에

역할이 다른 다섯 덩어리가 세 개의 저장소(R2·Supabase·기기 로컬)를 사이에 두고 연결됩니다.

```
[운영자]                         [저장소]                     [사용자]
관리자 콘솔 (/admin/) ──발행──▶  Cloudflare R2  ──HTTP──▶  웹앱 (MapLibre GL JS)
 · 산·코스·스팟 편집             │ 타일·팩·config·이미지      iOS 앱 (MapLibre Native)
 · 큐레이션·표시설정             │ (egress 무료)               │
 · 시트(xlsx)·백업       ──시드─▶ Supabase (서울)  ◀──DB/Auth──┘
 · 등반 기록 열람·분석           │ 카탈로그·산정보·기록·RLS
                                 └ Vercel /api/* (날씨 프록시 · 웹 타일 프록시)
파이프라인 스크립트 (scripts/*.py)
 · DEM·등고선·타일 추출 — 발행 잡이 호출
```

- **웹앱** = 빌드 없는 정적 파일(ES 모듈). **iOS** = SwiftUI + MapLibre Native, XcodeGen 생성.
- **관리자 콘솔** = 운영자 1인용 도구(배포 제외). 모든 콘텐츠가 여기서 출발합니다.
- **Supabase** = 인증 + 관계형 DB만(RLS). **파일은 전부 R2**. 등반 런타임은 항상 기기 로컬이
  담당하는 **로컬 우선** 모델 — 서버가 죽어도 산행은 계속됩니다.

---

## 3. 파이프라인 — 데이터가 흐르는 길

이 저장소를 이해하는 가장 빠른 방법은 "무엇이 어디서 만들어져 어디로 흘러가는가"입니다.
일곱 개의 파이프라인이 전부입니다.

### P1. 산·코스 데이터 (제작 → 발행 → 소비)

```
산림청 원본(mountain/, 5,360산)   ─┐
GPX 실측 업로드(맵매칭/원본 그대로) ├─▶ 관리자 편집 ─▶ admin_data/<산코드>/draft.json (git 커밋)
지도 클릭 컴포저(구간 순서 클릭)   ─┘        │ 코스 선별·명명·난이도, 스팟, 주봉
                                             ▼ [배포] = publish_pack.py 잡
                     draft → routes/spots.geojson 생성
                     dem_cache(GLO-30) → contours.geojson (등고선)
                     go-pmtiles extract → 산별 base.pmtiles (기저 타일)
                                             │
                     ┌───────────────────────┴────────────────────┐
                     ▼ R2 packs/<산코드>/ (파일 4종)               ▼ Supabase mountains upsert
                                                                    (pack_version+1·노출 순서·공개)
앱: mountains 카탈로그 SELECT → 산 목록 → packs/<산코드>/ fetch → 지도 위 코스·스팟 렌더
```

- **draft.json 이 진실의 원천**(커밋 대상), 발행 산출물은 전부 재생성 가능(gitignore).
- 발행하면 **앱은 새로고침만으로 새 산이 등장** — 카탈로그 주도라 앱 코드 재배포가 없습니다.
- 고도는 GPX `<ele>` 우선(교량·건물의 DSM 스파이크 회피), 없으면 GLO-30 DEM 표본.
- 목록에 없는 도심·소규모 산은 이름 + 지도 클릭만으로 직접 등록(`9xxxxxxxx` 대역, GPX 원본
  그대로 코스 등록 — trkseg 경계대로 파트 분리).

### P2. 지도 스타일 (단일 출처 → 웹·iOS 양쪽)

```
basemap-style.js buildStyle()  ─┬─▶ 웹: 런타임에 직접 호출 (테마·기저 전환 시 재생성)
(흑백 카토그래피 단일 출처)      └─▶ iOS: ios/gen-style.mjs 가 빌드 때 JSON 4종으로 구워
                                        앱 번들에 포함 (+ R2 표시설정을 이때 반영)
```

- 웹에서 손본 카토그래피가 재빌드 한 번으로 네이티브에 그대로 반영됩니다.
- ⚠️ 그 결과 **iOS 는 표시설정(P6)이 빌드 시점에 굳습니다** — 설정 변경 후 재빌드 필요.

### P3. 오프라인 팩 (저장 → 무네트워크 등반)

```
R2 packs/<산코드>/ ─[지도 다운 · 등반 시작 시 저장 권유]─▶ 기기 저장
                                                    웹: IndexedDB (브라우저가 퇴거 가능)
                                                    iOS: 파일시스템 (영구)
탐험 중 = 원격(R2) 우선 (최신성)    ─┐
등반 중 = 로컬 팩 전용 (신호·배터리) ┴─ MapView 가 소스 URL 만 교체 (하이브리드)
```

- 팩이 없는 산에서 등반을 시작하면 저장을 권유하고, 무시하면 온라인 모드로 진행합니다.
- 팩은 받은 시점에 멈춥니다 — 카탈로그 `pack_version` 비교로 업데이트를 안내합니다.

### P4. 등반 기록·진단 (GPS → 기록 → 분석)

```
CoreLocation 1Hz ─▶ ClimbStore ─┬─▶ 화면: HUD·라이브 루트 (배터리 모드에 따라 표시 스로틀)
(백그라운드 지속)                ├─▶ climb-session.ndjson (점마다 append — 강제종료 복구)
                                 └─▶ [등반 종료]
                                      ├ 원본 고해상 트랙: 기기 로컬 GPX (클라우드 미업로드)
                                      └ 단순화 트랙(≤2,000점) + 진단 meta(배터리·GPS·기기·
                                        전경/배경·저전력·배터리 모드) → Supabase climb_records
앱 기록 탭: 목록·달력·합계·루트 보기(고도 프로필·코스 겹침·GPX 내보내기)   ← RLS: 본인만
관리자 등반 기록 탭: 전 계정 열람(service_role) · GPS 모드별 %/h 분석 · xlsx 다운로드
```

- 트랙 포맷 `[lng,lat,고도,unix초]` 는 웹·iOS 공용 계약(`supabase/schema.sql` 주석이 명세).
- 진단 meta 가 배터리 최적화의 근거 데이터입니다 — 빌드·기기·모드별 소모율 비교.

### P5. 큐레이션 (추천 탭 콘텐츠)

```
관리자 큐레이션 탭 ─[저장]─▶ admin_data/curations.json (원본)
 · 산/코스 연결 카드 + 빈 카드(free)      └─▶ R2 config/curations.json (no-cache)
 · 문구 5요소 · 커버 사진/GIF                    └─▶ 앱 추천 탭: 매거진 캐러셀
 · 커버 업로드 → R2 images/mountains/<키>             (탭하면 해당 산/코스로 이동, free 는 무이동)
 · xlsx 내려받기/업로드(전체 교체 + 자동 백업)
```

- 편집기가 앱 슬라이드와 같은 모양이라 "본 대로 나옵니다". GIF 는 웹 `<img>` 자동 재생.
- 큐레이션이 없거나 오프라인이면 앱은 내장 추천으로 폴백합니다.

### P6. 표시 설정 (스팟·기저 POI 정책)

```
관리자 지도 오버레이 카드(미리보기 조정) ─▶ admin_data/*.json + R2 config/
 · spot-display.json (정상·장소·조망점 …)      ├─▶ 웹: 부팅 시 fetch + localStorage 캐시 (즉시)
 · poi-display.json (전철역·사찰·학교 …)       └─▶ iOS: gen-style.mjs 가 빌드 때 굽기 (재빌드 필요)
값 = { zoom(표시 시작 줌·99=끔), icon(끔/기본/문자 기호), size, bold }
```

- 기호는 **BMP 문자만**(자체 글리프가 U+FFFF 까지) — 이모지는 화면·서버 이중으로 차단합니다.

### P7. 운영 백업 (되돌릴 수 있는 운영)

```
시트 탭: 전 산 메타·스팟 ↔ 그리드/xlsx 왕복 (diff 미리보기 → 적용)
큐레이션: xlsx 왕복 (전체 교체)
                └─ 모든 적용 직전 admin_data/backups/<UTC ts>/ 자동 스냅샷 (최근 30세트, 복원)
git: draft.json·curations.json·GPX 원본은 커밋 대상 — 저장소 자체가 최종 백업
```

- xlsx 는 "내보낸 파일을 그대로 올리면 무변경"인 왕복 대칭이 검증돼 있습니다.
- 이미지 파일만은 R2 단본입니다(xlsx 에는 URL 만) — R2 버킷이 원본입니다.

### P8. 실시간 외부 데이터 (날씨 · 대기질)

```
기상청 단기예보 ──▶ api/weather.js ──┬─▶ 웹  weather.js  renderStrip()
                    (Vercel · 키 은닉) └─▶ iOS WeatherService → 2시간 간격 8칸

에어코리아 ────────▶ api/air.js ──────┬─▶ 웹  air.js      renderAir()
 · 측정소정보(좌표)   (최근접 측정소를   └─▶ iOS AirQuality  → 한 줄(수치+등급)
 · 대기오염정보       서버에서 계산)
```

- **키는 앱에 심지 않습니다.** 둘 다 `data.go.kr` 인증키를 Vercel 환경변수(`KMA_KEY`) 하나로
  쓰고 프록시가 대신 호출합니다 — 서비스별 **활용신청만 추가**하면 새 변수가 필요 없습니다.
- **최근접 측정소는 서버가 고릅니다.** 측정소 이름 규칙이 지역마다 달라(서울 `강북구`,
  인천·경기 `계산`·`소사본동` 같은 동 단위) 이름 매칭이 불가능합니다. 측정소정보 API 의
  좌표(`dmX`/`dmY`)로 최근접을 고르고, **30km 를 넘으면 값을 주지 않습니다** —
  없는 것보다 틀린 게 나쁩니다. 목록(673곳)은 warm 인스턴스에서 하루 캐시합니다.
- ⚠️ **미세먼지 수치 예보는 존재하지 않습니다.** 에어코리아가 주는 것은 실황 **수치**(1시간
  주기)와 권역별 **일 단위 등급**(하루 4회 발표)뿐입니다. 그래서 날씨처럼 시간 칸을 만들지
  않고 한 줄로 둡니다 — 하루 한 값을 여러 칸에 복제하면 없는 정보를 있는 것처럼 보입니다.
  (네이버의 시간별 미세먼지 예보는 케이웨더 민간 유료 자료입니다.)
- 측정소명·거리를 함께 노출합니다. 산 정상이 아니라 **도심 측정값**이라 사용자가 감안할 수
  있어야 합니다.
- 등반 중에는 다시 받지 않습니다 — 출발 시점 스냅샷(신호·배터리).

---

## 4. 탭별 기능 요약

탭 순서 = 산행 여정: **탐험(고르기) → 등반(실행) → 추천(구경) → 기록(회고)**

| 탭 | 핵심 기능 |
|---|---|
| **탐험** | 흑백 벡터 지도(등고선·음영기복·▲봉우리), 산 검색, 코스 선택(번호 배지·시종점), 산 소개, 날씨(기상청)·미세먼지(에어코리아), 지도 다운 |
| **등반** | 코스 카드(거리·예상시간·난이도·고도 그래프), 저장된 지도, 등반 시작 → GPS 트래킹·HUD·국가지점번호, **내비**(지도 없는 방향·거리 화면), 배터리 모드 3단 |
| **추천** | 큐레이션 매거진 캐러셀(P5), 100대 명산·BAC100·국립공원 아코디언 |
| **기록** | 이메일 로그인, 산행 목록·달력·합계, **루트 보기**(고도 프로필 인터랙션·정규 코스 겹침 비교·GPX 내보내기), 프로필·설정(배터리 모드) |

iOS 전용 안전장치: 강제종료 세션 복구(NDJSON append), 종료 확인번호(오터치 방지),
내비의 이탈 경고·나침반 신뢰도 처리·움직임 기반 방향 판정.

---

## 5. 실행 · 빌드 · 배포

### 웹 로컬 실행
```bash
git clone https://github.com/ksthink/hihi.git && cd hihi
python3 scripts/serve.py        # 정적 서버 + /pmtiles 프록시 (8890)
```
> `python3 -m http.server` 로는 기저 지도가 안 나옵니다 — `/pmtiles/*` 프록시가 필요합니다.

### 관리자 콘솔
```bash
bash scripts/setup_admin.sh                # 최초 1회: .venv + go-pmtiles
.venv/bin/python scripts/admin_server.py   # 0.0.0.0:8890 — 앱(/) + 관리자(/admin/) + API
```
- 비밀번호 로그인(`.env` `ADMIN_PASSWORD`, 5회 실패 시 10분 잠금, localhost 면제).
- ⚠️ **`git pull` 후 서버 재시작 필요**(파이썬 모듈 캐시). 정적 파일(admin/*)만 바뀌면 새로고침만.
- 사용 순서: 산 검색·등록 → 코스 입력(클릭 컴포저/GPX) → 스팟·표시설정·큐레이션 →
  **[배포]** → 앱 새로고침으로 반영 (P1).

### iOS 빌드 · TestFlight
```bash
cd ios
node gen-style.mjs && xcodegen generate    # 스타일 굽기(P2) + .xcodeproj 생성(커밋 안 함)
bash testflight.sh                          # 아카이브 → App Store Connect (ASC_* 환경변수 필요)
```
- 빌드번호 = `git rev-list --count HEAD` — 커밋 없이 재실행하면 애플이 같은 번호를 거부합니다.
- 내부 테스터 배포라 심사 없이 처리(5~15분) 후 설치. 함정 목록 포함 상세: [ios/README.md](ios/README.md).

### 웹 배포 (Vercel)
`main` push → **웹만** 자동 재배포. iOS 는 수동(`testflight.sh`).
- `api/tiles.js` = R2 기저 타일 same-origin 프록시(웹 CORS 회피 — iOS 는 R2 직결이라 불필요)
- `api/weather.js`(기상청) · `api/air.js`(에어코리아) = 외부 API 프록시 —
  **키를 앱에 심지 않기 위해 웹·iOS 모두 이 경유를 유지** (P8)
- 비밀 키(Supabase secret·R2 키·ADMIN_PASSWORD)는 `.env` 전용 — 커밋·Vercel·앱 번들 금지

---

## 6. 지도 자산 자체 호스팅 · 캐시 정책

외부 CDN이 파일을 지우면 지도가 깨집니다(Protomaps 데모버킷 삭제로 실제로 겪음).
지도에 필요한 자산은 전부 자체 호스팅하고, iOS 는 앱 번들에 넣습니다.

| 자산 | 웹 | iOS |
|---|---|---|
| 기저 타일 `kr-base.pmtiles`(505MB) | R2 (프록시 경유, Range 로 보이는 타일만) | R2 커스텀 도메인 직결 |
| 오프라인 팩 | R2 → IndexedDB | R2 → 파일시스템 |
| 지도 라벨 글리프(한글 SDF) | 리포 `fonts/` | **앱 번들**(폴더 참조 필수 — [ISSUE.md](ISSUE.md) #3) |
| UI 폰트 MonaS12 | woff2 서브셋 | 번들 ttf |

> ⚠️ **R2 의 `*.json`·`*.geojson` 은 `Cache-Control: no-cache` 필수** — 없으면 클라이언트
> 휴리스틱 캐싱으로 몇 시간 옛 데이터를 재사용합니다(큐레이션 미반영 버그로 실제 겪음).
> `scripts/r2_lib.py` 가 확장자로 자동 판정합니다. `*.pmtiles` 는 의도적으로 제외(Range·불변).

웹에 남은 외부 의존은 `maplibre-gl`·`pmtiles`·`supabase-js` ESM CDN뿐이고, iOS 는 전부
네이티브 SDK(Swift Package)로 대체됩니다.

---

## 7. 진행 상태

웹에서 설계·검증한 뒤 iOS 네이티브로 완성하는 전략이며, **네이티브는 이미 동작하는 앱
단계**입니다(빌드 270번대, 실기 피드백 반복 중). 계획서(IOS.md)의 검증 관문:

| | 검증 대상 | 상태 |
|---|---|---|
| S1 | 앱 번들 글리프로 한글 지도 라벨 렌더 | ✅ |
| S2 | 오프라인 팩 → 비행기 모드 렌더 | ✅ |
| S3 | 백그라운드 GPS·강제종료 복구 | ✅ 구현 / ⏳ **배터리 예산(4h ≤25%) 실측 미완** |

남은 과제(출시 전): 출처표기 화면(ODbL 의무), App Privacy·백그라운드 위치 사유서,
배터리 모드별 실측. 상세: [IOS.md](IOS.md) · [ios/README.md](ios/README.md).

---

## 8. 저장소 구조

```
hihi/
├── index.html · app.js · style.css      웹앱 (빌드 없는 정적 파일)
├── basemap-style.js                     지도 스타일 단일 출처 (P2)
├── weather.js · air.js · npn.js         도메인 로직 (iOS 직역 참조 / 관리자 공용)
├── poi-icons.js                         기저 POI 아이콘 (웹 캔버스 · iOS POIIcons 이식본과 동일 렌더)
├── supabase-client.js                   Supabase 초기화 (공개 키)
│
├── ios/                                 iOS 네이티브 (XcodeGen · 상세 ios/README.md)
│   ├── project.yml · gen-style.mjs · testflight.sh
│   └── HiHeight/                        Swift 소스 (MapView·ClimbStore·NavView·RouteViewUI …)
│
├── admin/                               관리자 콘솔 SPA (배포 제외)
├── admin_data/                          운영 원본 — draft.json·GPX·큐레이션·표시설정 (커밋 대상)
│   └── backups/                         적용 직전 자동 스냅샷 (gitignore, 30세트)
│
├── scripts/                             파이프라인 + 서버
│   ├── serve.py · admin_server.py       개발 서버 / 관리자 서버(+API)
│   ├── publish_pack.py · pack_lib.py    발행 파이프라인 (P1)
│   ├── draft_store.py · gpx_match.py    초안 저장소 · GPX 맵매칭
│   ├── sheet_lib.py                     시트 탭 (P7 — xlsx 왕복·백업·복원)
│   ├── dem_cache.py · r2_lib.py         DEM 캐시 · R2 업로드(캐시 정책)
│   └── …                                (변환·시드·아이콘 등)
│
├── api/                                 Vercel 함수 (tiles·weather 프록시)
├── fonts/                               UI 폰트 + 지도 글리프 (자체 호스팅)
├── data/                                팩 원본 (산출물 tiles/·packs/ 는 gitignore)
├── supabase/schema.sql                  DB 스키마 + RLS (+ 트랙·meta 계약 주석)
└── 문서                                  README · IOS · CLOUDFLARE · ICLOUD · WORKLOG · ISSUE · QA · WORD
```

**저장소별 데이터** (Supabase = Auth+DB / R2 = 파일)

| 리소스 | 위치 | 내용 |
|---|---|---|
| `mountains` · `mountain_info` | Supabase | 팩 카탈로그(공개·노출 순서·pack_version) · 전국 산정보 5,360건 |
| `profiles` · `climb_records` · `saved_packs` | Supabase | 사용자 데이터 (RLS: 본인만) |
| `kr-base.pmtiles` · `kr-terrain.pmtiles` | R2 | 전국 기저 타일 · 음영기복 |
| `packs/<산코드>/` | R2 | 산별 팩 4종 (P1 산출물) |
| `config/*.json` · `images/mountains/` | R2 | 큐레이션·표시설정(no-cache) · 커버 사진/GIF |

---

## 9. 데이터 출처 · 라이선스

- **기저 지도**: [Protomaps](https://protomaps.com) Basemap · © [OpenStreetMap](https://openstreetmap.org) 기여자 (ODbL) — R2 자체 호스팅
- **등산로·시설**: OpenStreetMap (ODbL) / 산림청·국립공원공단 공간정보 (약관 준수)
- **등고선·고도**: Copernicus GLO-30 DEM (AWS Open Data) / NASA SRTM (퍼블릭 도메인)
- **날씨**: 기상청 단기예보 (data.go.kr) · **대기질**: 한국환경공단 에어코리아 (data.go.kr)
- **폰트**: MonaS12 (⚠️ 재배포 라이선스 확인 필요)
- ⚠️ 등산로 라인은 개략 데이터입니다 — 실제 산행 시 공식 지도를 반드시 확인하세요.
- 한국 정밀 국가기본도 국외 반출 규제를 고려해 개방 데이터(OSM·Copernicus)만 사용하고,
  호스팅·고도 계산은 국내(서울) 리전에서 수행합니다.
- 📌 App Store 출시 전: 앱 내 저작자 표시 화면, 백그라운드 위치 사유서, App Privacy → IOS.md §12

---

## 10. 함께 보면 좋은 문서

| 문서 | 내용 |
|---|---|
| **[IOS.md](IOS.md)** | iOS 네이티브 이식 계획서 (단일 기준 — 신규 구현 §7, 사전조건 §8) |
| [ios/README.md](ios/README.md) | iOS 빌드·구조·남은 과제 상세 |
| [ios/DEVMODE.md](ios/DEVMODE.md) | 개발자 모드 HUD — 사용법·완전 삭제 절차 |
| [CLOUDFLARE.md](CLOUDFLARE.md) | R2 기저 타일 자체 호스팅 구축 순서 (처음 하는 사람용) |
| [ICLOUD.md](ICLOUD.md) | GPX 원본의 iCloud 문서 보관 |
| **[EMERGENCY.md](EMERGENCY.md)** | 비상상황 매뉴얼 — 데이터·보안 사고, 서비스 장애 대응 절차 |
| [WORKLOG.md](WORKLOG.md) | 작업일지 (날짜별 생성·수정 기록) |
| [ISSUE.md](ISSUE.md) | 장기 미해결 이슈 추적 — "왜 오래 걸렸나" 서술형 |
| [QA.md](QA.md) | 설계 질문/답변 기록 · [WORD.md](WORD.md) 용어 사전 |
| [CLAUDE.md](CLAUDE.md) | 개발 지침 (iOS 이식 전제 규칙 · 작업일지 규칙) |
