# 하이하잇 (HiHeight) — 오프라인 우선 대한민국 등산 앱

> **"산에서는 네트워크도, 배터리도 아껴야 한다."**

하이하잇은 대한민국 명산의 등산로를 **탐험**하고, 지도를 **오프라인으로 저장**하고,
산행을 **기록**하는 등산 앱입니다.

**웹앱**(MapLibre GL JS)과 **iOS 네이티브 앱**(MapLibre Native + SwiftUI)이 같은 저장소에서
**같은 지도 스타일·같은 데이터**를 공유합니다.

🔗 **웹앱**: https://hihi.ksthink.com
📱 **iOS**: TestFlight 내부 테스터 배포 중 (`dev.metaphr.hiheight`)

---

## 목차
1. [무엇을 하는 앱인가](#1-무엇을-하는-앱인가)
2. [지금 어디까지 왔나](#2-지금-어디까지-왔나)
3. [주요 기능](#3-주요-기능)
4. [어떻게 동작하나 (아키텍처)](#4-어떻게-동작하나-아키텍처)
5. [빠르게 실행하기 (웹)](#5-빠르게-실행하기-웹)
6. [iOS 앱 빌드 · TestFlight 배포](#6-ios-앱-빌드--testflight-배포)
7. [웹 배포 (Vercel)](#7-웹-배포-vercel)
8. [산 데이터 추가하기 (관리자 콘솔)](#8-산-데이터-추가하기-관리자-콘솔)
9. [지도 자산은 전부 자체 호스팅](#9-지도-자산은-전부-자체-호스팅)
10. [저장소 구조](#10-저장소-구조)
11. [데이터 출처 · 라이선스](#11-데이터-출처--라이선스)
12. [함께 보면 좋은 문서](#12-함께-보면-좋은-문서)

---

## 1. 무엇을 하는 앱인가

### 세 가지 원칙
- **오프라인 우선** — 산에는 전파가 안 닿는 곳이 많습니다. 지도·등산로·시설 정보를 미리
  기기에 저장해 두고, 등반 중에는 **네트워크 없이** 동작합니다.
- **배터리 절약** — 등산에서 배터리는 안전입니다. 화면 소비를 줄이려고 **흑백(모노크롬) UI** 만
  씁니다. 다크 모드는 순수 검정(OLED 절전), 라이트 모드는 순수 흰색.
- **대한민국 특화** — 지도 범위를 남한 전역(제주·독도 포함)으로 제한하고, 명산의 등산로·등고선·
  시설을 산별 "팩" 단위로 관리합니다.

### 사용자 흐름
```
산 검색 → 지도·등산로 확인 → 지도 오프라인 저장 → 코스 선택 → 등반 시작(GPS 트래킹) → 기록 저장
```

---

## 2. 지금 어디까지 왔나

웹에서 설계·검증한 뒤 iOS 네이티브로 완성하는 전략이었고, **네이티브 이식은 이미 동작하는
앱 단계**입니다. 계획서의 검증 관문(스파이크) 상태:

| | 검증 대상 | 상태 |
|---|---|---|
| **S1** | 앱 번들 글리프로 한글 지도 라벨 렌더 | ✅ 실기기 확인 |
| **S2** | 오프라인 팩 다운로드 → 비행기 모드 렌더 | ✅ 실기기 확인 |
| **S3** | 백그라운드 GPS · 강제종료 세션 복구 | ✅ 구현 / ⏳ **배터리 예산(4시간 ≤25%) 미검증** |

배터리 예산은 **실제 산행 1회**로만 확인할 수 있어 아직 열려 있습니다.
상세 계획과 잔여 항목은 **[IOS.md](IOS.md)** 를 보세요.

---

## 3. 주요 기능

| 탭 | 핵심 기능 |
|---|---|
| **탐험** | 흑백 벡터 지도, 큐레이션 코스(코스 번호 배지 · 선택 시 시종점 마커), 등고선, ▲봉우리 라벨, 산 검색, 산 소개 카드, 오늘 날씨(기상청) |
| **추천** | 운영자 큐레이션 매거진 캐러셀, 100대 명산 · BAC100 · 국립공원 아코디언 |
| **등반** | 코스 카드(거리·시간·난이도·고도 그래프), 저장된 지도 목록, 실시간 GPS 트래킹, 현재 위치 국가지점번호 |
| **기록** | 이메일 로그인(Supabase Auth), 산행 기록·통계, 프로필(닉네임·사진), 날짜 필터·정렬 (RLS 로 본인만) |

**오프라인 지도 저장** (핵심 기능)
- 코스 목록의 **"지도 다운"** → 팩(기저 타일 + 등산로 + 시설 + 등고선)을 기기에 저장
- 저장된 지도는 **네트워크 없이** 로컬 타일로 렌더 → 그대로 등반 시작
- 저장 위치: 웹은 IndexedDB(브라우저가 퇴거할 수 있음), **iOS 는 파일시스템 영구 저장**

**등반 중 (iOS)**
- 화면을 꺼도, 앱을 벗어나도 경로가 끊기지 않음 (백그라운드 위치)
- **앱이 강제 종료돼도 복구** — 좌표를 받을 때마다 파일에 덧붙이고, 재실행 시 이어가기 제안
- 오터치로 산행이 끝나지 않도록 **종료 시 무작위 2자리 확인번호** 입력
- 위치 버튼으로 정북 고정 ⇄ 나침반 추적 전환, 지나온 길은 실선 · 남은 길은 점선

**날씨 · 국가지점번호**
- 날씨: 검색한 산 위치 기준 기상청 예보. 탐험=실시간, 등반=출발 시점 오프라인 스냅샷
- 국가지점번호: 현재 GPS 위치를 `다사 5394 6231` 형식으로 표시 (UTM-K/EPSG:5179, `npn.js`)

---

## 4. 어떻게 동작하나 (아키텍처)

```
┌ 웹앱 (빌드 없는 정적 파일) ┐   ┌ iOS 앱 (SwiftUI) ────────┐
│ MapLibre GL JS + PMTiles  │   │ MapLibre Native 6.27      │
│ + supabase-js (ESM)       │   │ + supabase-swift          │
└──┬──────────┬─────────┬───┘   └──┬──────────┬─────────┬───┘
   │ 타일·팩   │ 날씨     │ DB·Auth  │ 타일·팩   │ 날씨     │ DB·Auth
   ▼          ▼         ▼          ▼          ▼         ▼
 Cloudflare R2      Vercel        Supabase (서울 리전)
 ├ kr-base.pmtiles  /api/weather  ├ Postgres + RLS
 │  (기저 지도)      (기상청 키    │  mountains · mountain_info
 ├ packs/<산코드>/    은닉)        │  profiles · climb_records · saved_packs
 │  (오프라인 팩)                  └ Auth (이메일)
 └ config/*.json
    (큐레이션·POI 표시)
 egress 무료 · 자체 호스팅
```

- **웹 프런트엔드**: 순수 정적 파일. 번들러·빌드 단계 없음. 브라우저 네이티브 ES 모듈.
- **지도 스타일은 단일 출처** — `basemap-style.js` 의 `buildStyle()` 을 웹이 직접 쓰고,
  iOS 는 `ios/gen-style.mjs` 가 같은 함수로 스타일 JSON 을 뽑아 앱 번들에 넣습니다.
  덕분에 웹에서 손본 카토그래피가 네이티브에 그대로 반영됩니다.
- **지도 타일·팩 = Cloudflare R2** (egress 무료):
  - **기저 지도** `kr-base.pmtiles`(505MB). PMTiles 는 HTTP Range 로 **보이는 타일만** 받습니다.
    웹은 브라우저 CORS 때문에 same-origin 프록시(`/pmtiles/*`)를 거치고,
    **iOS 는 프록시 없이 커스텀 도메인에 직결**합니다(네이티브에는 CORS 개념이 없음).
  - **오프라인 팩** `packs/<산코드>/` — 등산로·시설·등고선 + 산별 `base.pmtiles`.
- **날씨는 반드시 프록시 경유** — 기상청 키를 앱 바이너리에 심으면 추출·도용되므로,
  웹·iOS 모두 Vercel 함수(`/api/weather`)를 호출합니다. 이 프록시는 배포 후에도 유지됩니다.
- **백엔드(Supabase) = 인증 + 관계형 DB 만.** 파일은 전부 R2 로 이관했습니다.
  등반 런타임(지도·경로)은 항상 로컬이 담당하는 **로컬 우선(local-first)** 모델이라,
  서버가 죽어도 산행은 계속됩니다.
  - 모든 사용자 테이블에 **RLS** — 본인 데이터만 접근
  - 클라이언트는 **공개(publishable) 키만**. **비밀 키는 `.env` 전용**(커밋·앱 번들 금지)

> ⚠️ **R2 에 올리는 `*.json`·`*.geojson` 은 반드시 `Cache-Control: no-cache` 가 붙어야 합니다.**
> 헤더가 없으면 클라이언트가 휴리스틱 캐싱으로 **몇 시간 동안 옛 데이터를 재사용**합니다
> (실제로 큐레이션이 앱에 반영되지 않는 버그를 겪음). `scripts/r2_lib.py` 의
> `cache_control_for()` 가 확장자로 자동 판정하므로 업로드 코드에서 신경 쓸 필요는 없습니다.
> `*.pmtiles` 는 수백 MB · Range 요청이라 의도적으로 제외합니다.

---

## 5. 빠르게 실행하기 (웹)

```bash
git clone https://github.com/ksthink/hihi.git
cd hihi
python3 scripts/serve.py        # 정적 서버 + /pmtiles 프록시 (포트 8890)
# → http://localhost:8890
```

> ⚠️ `python3 -m http.server` 로도 페이지는 뜨지만, `/pmtiles/*` 프록시가 없어 **기저 지도가
> 나오지 않습니다.** 반드시 `serve.py`(또는 관리자 서버 `admin_server.py`)를 사용하세요.

---

## 6. iOS 앱 빌드 · TestFlight 배포

Xcode 프로젝트 파일은 **커밋하지 않습니다.** `project.yml` 에서 XcodeGen 이 생성합니다
(`.xcodeproj` 는 사람이 읽기 어려운 XML 이라 Git 충돌이 잦음).

```bash
cd ios
node gen-style.mjs      # basemap-style.js → 스타일 JSON 4종 + 글리프를 번들 리소스로 복사
xcodegen generate       # project.yml → HiHeight.xcodeproj
open HiHeight.xcodeproj # 또는 xcodebuild
```

### TestFlight 업로드

```bash
bash ios/testflight.sh
```

아카이브부터 App Store Connect 전송까지 한 번에 처리합니다. 사전에 환경변수 3개가 필요합니다
(App Store Connect API 키 — 비밀번호·2FA 없이 자동화됨):

```bash
export ASC_KEY_ID=XXXXXXXXXX
export ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export ASC_KEY_PATH=~/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8
```

- 빌드번호 = **`git rev-list --count HEAD`**. 같은 번호는 애플이 거부하므로
  **커밋 없이 재실행하면 실패**합니다 (필요하면 `git commit --allow-empty`).
- 배포용 인증서·프로비저닝 프로파일은 `-allowProvisioningUpdates` 가 자동 발급합니다.
- 배포 대상은 **내부 테스터** — Beta App Review 가 없어 처리(5~15분) 후 즉시 설치 가능합니다.

> ⚠️ **App Store 배포에는 명시적(Explicit) App ID 가 필요합니다.** 개발용 와일드카드
> (`TEAMID.*`) 프로파일로는 실기기 설치까지만 되고 업로드는 거부됩니다.
>
> ⚠️ 버전 값은 `project.yml` 의 `info.properties` 가 `$(MARKETING_VERSION)` ·
> `$(CURRENT_PROJECT_VERSION)` 을 **참조해야** 반영됩니다. 참조를 빼면 XcodeGen 이
> 기본값(`1.0` / `1`)을 Info.plist 에 리터럴로 박아 모든 오버라이드가 무시됩니다.

앱 아이콘은 `scripts/make_app_icon.py` 로 생성합니다(1024, 알파 없음 — App Store 필수).

---

## 7. 웹 배포 (Vercel)

`main` 브랜치에 push 하면 **웹앱만** 자동 재배포됩니다. **iOS 앱은 자동 배포되지 않습니다**
— 컴파일·서명이 필요해 `ios/testflight.sh` 를 직접 실행해야 합니다.

- `api/tiles.js` — `/pmtiles/*` 를 R2 기저 타일로 중계(Range 전달 + CDN 캐시)
- `api/weather.js` — 기상청 예보 프록시 (환경변수 `KMA_KEY`)
- `vercel.json` — `/pmtiles/*` → `/api/tiles` 리라이트
- `.vercelignore` — 파이프라인 스크립트·관리자 콘솔·문서를 배포에서 제외

**환경변수**
| 변수 | 용도 | 위치 |
|---|---|---|
| `KMA_KEY` | 기상청 API 키 | Vercel 환경변수 |
| 공개(publishable) 키 | Supabase 클라이언트 | 코드에 포함(공개키, RLS 보호) |
| secret 키 · R2 키 · `ADMIN_PASSWORD` | 시드·업로드·관리자 | **`.env` 전용 (커밋·Vercel 금지)** |

---

## 8. 산 데이터 추가하기 (관리자 콘솔)

산림청 등산로 원본은 코스가 과다하고 분기점이 부정확합니다. 그래서 운영자가 코스를
**선별·명명·보정**해서 배포하는 관리자 콘솔을 제공합니다.

```bash
bash scripts/setup_admin.sh                    # 최초 1회: .venv + go-pmtiles 설치
.venv/bin/python scripts/admin_server.py       # 0.0.0.0:8890 — 앱(/) + 관리자(/admin/) + API
```

- 접속: `http://<호스트>:8890/admin/` → **비밀번호 로그인**(`.env` 의 `ADMIN_PASSWORD`).
  5회 실패 시 해당 IP **10분 잠금**. (localhost 는 인증 면제)
- 사용 순서:
  1. **검색** — 전국 5,360개 산에서 이름/산코드로 검색 → "추가"(스팟·범위 자동 구성).
     등록 직후엔 산림청 구간망이 **회색으로만** 표시됩니다(코스 자동 생성 없음).
  2. **코스 입력(수작업)** — **[코스 등록]** → 시점부터 종점까지 회색 구간을 **순서대로 클릭**해
     코스 완성(방향 자동 정렬·누적 거리). 완성 시 코스 번호 자동 부여 + 거리·고도·난이도 계산.
     실측 GPX 가 있으면 **GPX 업로드 맵매칭**도 가능(보조 수단).
  3. **큐레이션** — 이름·난이도·설명 편집, 분기점 이름 정리, 정상 스팟 지정(앱에서 ▲봉우리 라벨).
     추천 탭 매거진도 여기서 편집합니다(→ R2 `config/curations.json`).
  4. **배포** — 등고선·기저 타일 생성 → Supabase 반영 → **앱은 새로고침만으로 반영**
     (앱이 `mountains` 카탈로그를 읽으므로 코드 재배포 불필요)
- **앱에서 삭제**: 편집 패널의 "앱에서 삭제" — Supabase 카탈로그 행 + R2 팩 파일 + 로컬 초안을
  한 번에 제거. 일시적으로 감추려면 "공개" 해제 후 배포.

> **산 식별자 = 산림청 산코드 9자리.** 이 코드가 R2 폴더명·DB·저장 팩 키에서 전부 공유되므로
> 한 곳이라도 다르면 연결이 끊깁니다.
>
> ⚠️ **`git pull` 후에는 관리자 서버를 재시작**해야 합니다. 파이썬이 이미 불러온 모듈을
> 메모리에 캐시하기 때문에, 파일만 바뀌어서는 새 코드가 적용되지 않습니다.

---

## 9. 지도 자산은 전부 자체 호스팅

외부 CDN이 파일을 지우면 지도가 깨집니다(실제로 Protomaps 데모버킷 삭제로 한 번 겪음).
그래서 지도에 필요한 자산은 **전부 자체 호스팅**하고, iOS 는 이를 **앱 번들에 넣습니다.**

| 자산 | 웹 | iOS |
|---|---|---|
| 기저 지도 타일 | Cloudflare R2 (프록시 경유) | R2 커스텀 도메인 직결 · 팩은 기기 로컬 |
| 오프라인 팩 | R2 → IndexedDB | R2 → `Application Support/packs/<산코드>/` |
| 지도 라벨 글리프 | 리포 `fonts/` (same-origin) | **앱 번들** (44MB, CJK 전 범위) |
| UI · 지도 폰트 | 리포 `fonts/*.woff2` | 앱 번들 `MonaS12.ttf` |

**지도 라벨 폰트 구조** (참고)
- 웹: 한글·CJK 는 `localIdeographFontFamily` 가 기기 canvas 로 렌더, 라틴·숫자·기호는 SDF 글리프
- **네이티브는 `localIdeographFontFamily` 가 없어** 한글까지 전부 SDF 글리프가 필요합니다.
  그래서 `fonts/MonaS12 Regular|Bold/*.pbf`(fontnik, 전 BMP)를 통째로 번들합니다.
  XcodeGen 에서 반드시 **폴더 참조(`type: folder`)** 로 넣어야 합니다 — 일반 그룹이면
  번들 루트로 평탄화돼 폰트별 같은 파일명이 서로 덮어씁니다.
- → 지도·UI 전체가 **MonaS12** 로 통일

> 웹에 남은 외부 의존은 `maplibre-gl`·`pmtiles`·`supabase-js` 라이브러리(ESM CDN)뿐이며,
> iOS 에서는 네이티브 SDK(Swift Package)로 대체됩니다.

---

## 10. 저장소 구조

```
hihi/
├── index.html            웹앱 셸 (HTML)
├── app.js                웹앱 전체 로직 (지도·검색·등반·기록·오프라인·날씨·국가지점번호)
├── basemap-style.js      흑백 MapLibre 스타일 생성 buildStyle() — 웹·iOS 공용 단일 출처
├── style.css             흑백 디자인 시스템 (CSS 변수 = 디자인 토큰)
├── supabase-client.js    Supabase 초기화 + 인증 헬퍼 (공개 키)
├── weather.js            기상청 예보 도메인 로직 (격자변환·병합·아이콘)
├── npn.js                국가지점번호 변환 (WGS84 → UTM-K/EPSG:5179)
│
├── ios/                  iOS 네이티브 앱 (MapLibre Native + SwiftUI, iOS 17+)
│   ├── project.yml           XcodeGen 정의 — .xcodeproj 는 커밋하지 않음
│   ├── gen-style.mjs         basemap-style.js → 번들 스타일 JSON + 글리프 복사
│   ├── testflight.sh         아카이브 → App Store Connect 업로드
│   ├── ExportOptions.plist   destination=upload (export 와 동시 전송)
│   └── HiHeight/             Swift 소스 32개
│       ├── MapView.swift         MapLibre 래핑 (오프라인 전환·등반 레이어·나침반)
│       ├── ExploreView.swift     탐험 탭 (바텀시트·등반 HUD)
│       ├── ClimbStore.swift      GPS 트래킹 · 세션 영속화(NDJSON)
│       ├── PackStore.swift       오프라인 팩 다운로드·설치
│       ├── AuthStore.swift       Supabase 인증 · 기록 · 프로필
│       └── …                     (탭 뷰 · 테마 · 날씨 · 국가지점번호 등)
│
├── fonts/                자체 호스팅 폰트 + 지도 글리프 (§9)
│   ├── MonaS12*-subset.woff2            UI 폰트 (한글+라틴 서브셋)
│   ├── MonaS12.ttf                      서브셋·PBF 생성 소스
│   └── MonaS12 Regular|Bold/*.pbf       지도 SDF 글리프 (fontnik, 전 BMP)
│
├── api/                  Vercel 서버리스 함수
│   ├── tiles.js          기저 타일 프록시 (→ Cloudflare R2)
│   └── weather.js        기상청 예보 프록시 (KMA 키 은닉)
│
├── admin/                관리자 콘솔 SPA (운영 도구, 배포 제외)
│
├── scripts/              콘텐츠 파이프라인 + 서버 (앱에 포함 안 됨)
│   ├── serve.py              로컬 개발 서버 (정적 + /pmtiles 프록시)
│   ├── admin_server.py       관리자 서버 (serve.py 상속 + /admin + /api)
│   ├── r2_lib.py             R2 공용 헬퍼 — 업로드 · Cache-Control 정책
│   ├── publish_pack.py       배포: draft → geojson·등고선·타일 → R2 packs/
│   ├── pack_lib.py           공용 라이브러리 (좌표변환·그래프·DEM·프로파일)
│   ├── draft_store.py        산별 큐레이션 초안 저장소
│   ├── gpx_match.py          GPX → 구간망 맵매칭
│   ├── dem_cache.py          Copernicus DEM 타일 캐시
│   ├── make_app_icon.py      iOS 앱 아이콘 생성 (1024, 알파 없음)
│   └── (그 외 변환·시드·대안 파이프라인 스크립트)
│
├── supabase/schema.sql   DB 스키마 + RLS
├── vercel.json           배포 리라이트
├── data/                 팩 원본 GeoJSON (일부 gitignore: tiles/, packs/)
│
└── 문서: README.md · WORD.md · IOS.md · CLOUDFLARE.md · WORKLOG.md · QA.md · CLAUDE.md
```

**백엔드 리소스** (Supabase = Auth + DB / Cloudflare R2 = 파일)
| 리소스 | 위치 | 내용 |
|---|---|---|
| `mountains` | Supabase DB | 팩 카탈로그 (id=산코드, name, region, elev, center, zoom, bbox, pack_version) |
| `mountain_info` | Supabase DB | 전국 산 정보 5,360건 (높이·관리주체·전화·소개) |
| `profiles` · `climb_records` · `saved_packs` | Supabase DB | 사용자 데이터 (RLS: 본인만) |
| Auth | Supabase | 이메일 로그인·세션 |
| `kr-base.pmtiles` | Cloudflare R2 | 기저 지도 타일 (505MB) |
| `packs/<산코드>/` | Cloudflare R2 | `base.pmtiles` · `routes`/`spots`/`contours.geojson` |
| `config/*.json` | Cloudflare R2 | 큐레이션 · POI 표시 정책 (`no-cache`) |

---

## 11. 데이터 출처 · 라이선스

- **기저 지도**: [Protomaps](https://protomaps.com) Basemap · © [OpenStreetMap](https://openstreetmap.org) 기여자
  (ODbL — 저작자 표시 및 파생 데이터 share-alike). 타일은 Cloudflare R2 에 자체 호스팅.
- **등산로·시설**: OpenStreetMap (ODbL) / 산림청·국립공원공단 공간정보 (약관 준수)
- **등고선·고도**: Copernicus GLO-30 DEM (AWS Open Data) / NASA SRTM (퍼블릭 도메인)
- **날씨**: 기상청 단기예보 (data.go.kr)
- **폰트**: MonaS12 (UI·지도 공통) — ⚠️ 재배포·상용 라이선스 확인 필요
- ⚠️ **등산로 라인은 개략 데이터입니다.** 실제 산행 시 국립공원공단 등 **공식 지도를 반드시 확인**하세요.
- 한국 정밀 국가기본도의 국외 반출 규제를 고려해, 지도 데이터 호스팅은 국내(서울) 리전을 권장합니다.
- 📌 **App Store 정식 출시 전 필요**: 앱 내 **저작자 표시 화면**(ODbL 의무), 백그라운드 위치
  사용 사유서, App Privacy 신고. → [IOS.md](IOS.md) §12

---

## 12. 함께 보면 좋은 문서

| 문서 | 내용 |
|---|---|
| **[WORD.md](WORD.md)** | **용어 사전** — 이 프로젝트에 쓰인 용어의 뜻과 **왜 그 선택을 했는지** |
| **[IOS.md](IOS.md)** | iOS 네이티브 이식 계획서 (단일 기준 문서) |
| [ios/README.md](ios/README.md) | iOS 앱 빌드·구조 상세 |
| [CLOUDFLARE.md](CLOUDFLARE.md) | Cloudflare R2 기저 타일 자체 호스팅 **구축 순서**(처음 하는 사람용) |
| [WORKLOG.md](WORKLOG.md) | 작업일지 (날짜별 생성·수정 기록) |
| [ISSUE.md](ISSUE.md) | 장기 미해결 이슈의 추적 기록 — **왜 오래 걸렸나**를 서술형으로 |
| [QA.md](QA.md) | 설계 질문/답변 기록 |
| [CLAUDE.md](CLAUDE.md) | 개발 지침 (iOS 이식 전제 규칙 등) |
