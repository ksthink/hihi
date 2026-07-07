# 하이하잇 (HiHeight) — 오프라인 우선 대한민국 등산 앱

> **"산에서는 네트워크도, 배터리도 아껴야 한다."**

하이하잇은 대한민국 명산의 등산로를 **탐험**하고, 지도를 **오프라인으로 저장**하고,
산행을 **기록**하는 모바일 등산 앱입니다.
현재는 **웹앱(MapLibre GL JS + PMTiles)** 으로 개발 중이며, 최종적으로는
**iOS 네이티브 앱(MapLibre Native + SwiftUI)** 으로 완성하는 것을 목표로 합니다.

🔗 **라이브 데모**: https://hihi.metaphr.dev
(폰에서는 전체화면, 데스크톱에서는 아이폰 프레임 안에 표시됩니다.)

---

## 목차
1. [무엇을 하는 앱인가](#1-무엇을-하는-앱인가)
2. [주요 기능](#2-주요-기능)
3. [어떻게 동작하나 (아키텍처)](#3-어떻게-동작하나-아키텍처)
4. [빠르게 실행하기](#4-빠르게-실행하기)
5. [배포 (Vercel)](#5-배포-vercel)
6. [산 데이터 추가하기 (관리자 콘솔)](#6-산-데이터-추가하기-관리자-콘솔)
7. [지도 자산은 전부 자체 호스팅](#7-지도-자산은-전부-자체-호스팅)
8. [저장소 구조](#8-저장소-구조)
9. [iOS 네이티브 이식 계획](#9-ios-네이티브-이식-계획)
10. [데이터 출처 · 라이선스](#10-데이터-출처--라이선스)
11. [함께 보면 좋은 문서](#11-함께-보면-좋은-문서)

---

## 1. 무엇을 하는 앱인가

### 세 가지 원칙
- **오프라인 우선** — 산에는 전파가 안 닿는 곳이 많습니다. 지도·등산로·시설 정보를 미리
  기기에 저장해 두고, 등반 중에는 **네트워크 없이** 동작하는 것이 목표입니다.
- **배터리 절약** — 등산에서 배터리는 안전입니다. 화면 소비를 줄이려고 **흑백(모노크롬) UI** 만
  씁니다. 다크 모드는 순수 검정(OLED 절전), 라이트 모드는 순수 흰색.
- **대한민국 특화** — 지도 범위를 남한 전역(제주·독도 포함)으로 제한하고, 명산의 등산로·등고선·
  시설을 산별 "팩" 단위로 관리합니다.

### 사용자 흐름
```
산 검색 → 지도·등산로 확인 → 지도 오프라인 저장 → 코스 선택 → 등반 시작(GPS 트래킹) → 기록 저장
```

---

## 2. 주요 기능

| 탭 | 핵심 기능 |
|---|---|
| **탐험** | 흑백 벡터 지도, 공식 탐방코스(국립공원공단), 등고선, 분기점·봉우리 라벨, 산 검색, **산 소개 카드**(높이·소개·관리주체), **오늘 날씨**(기상청 단기예보) |
| **추천** | 100대 명산 목록에서 산 선택, 추천 코스 카드 |
| **등반** | 코스 카드(거리·시간·난이도·고도 그래프), 저장된 지도 목록, **실시간 GPS 트래킹**, **현재 위치 국가지점번호** 표시 |
| **기록** | 이메일 로그인(Supabase Auth), 산행 기록 목록·통계 (본인만 조회, RLS 보호) |

**오프라인 지도 저장** (핵심 기능)
- 코스 목록의 **"지도 다운"** → 팩(기저 타일 + 등산로 + 시설 + 등고선)을 기기(IndexedDB)에 저장
- 저장된 지도를 열면 **네트워크 없이** 로컬 타일로 렌더 → 바로 등반 시작
- (웹의 한계는 iOS 파일시스템 단계에서 완전 해소 — 아래 [9번](#9-ios-네이티브-이식-계획) 참고)

**날씨 · 국가지점번호**
- 날씨: 검색한 산 위치 기준 기상청 예보. 탐험=실시간, 등반=출발 시점 오프라인 스냅샷
- 국가지점번호: 등반 중 현재 GPS 위치를 국가지점번호(예: `다사 5394 6231`)로 표시
  (UTM-K/EPSG:5179 정변환, `npn.js`)

---

## 3. 어떻게 동작하나 (아키텍처)

```
┌─ 프런트엔드 (빌드 없는 정적 파일) ──────────────────────┐
│  index.html · app.js · basemap-style.js · style.css      │
│  MapLibre GL JS + PMTiles + supabase-js (ESM)            │
└──────┬───────────────────┬──────────────────┬──────────┘
       │ 지도 타일·팩 파일   │ /api/weather     │ REST·Auth (DB만)
       ▼                   ▼                  ▼
  Cloudflare R2       기상청 프록시        Supabase (서울 리전)
  ├ kr-base.pmtiles   (api/weather.js)     ├ Postgres + RLS
  │  (기저 지도)                           │  mountains · mountain_info
  └ packs/<산코드>/…                       │  profiles · climb_records · saved_packs
     (오프라인 팩)                          └ (파일 없음 — 전부 R2로 이관)
  자체 호스팅 · egress 무료
```

- **프런트엔드**: 순수 정적 파일. 번들러·빌드 단계 없음. 브라우저 네이티브 ES 모듈.
- **지도 타일·팩 파일 = Cloudflare R2** (egress 무료 · 자체 호스팅):
  - **기저 지도**: 대한민국 전역 벡터 타일(`kr-base.pmtiles`, 505MB). PMTiles 는 HTTP Range 로
    **보이는 타일만** 받고, CORS 회피 위해 same-origin 프록시(`/pmtiles/*`)를 거칩니다.
  - **오프라인 팩**: `packs/<산코드>/`(등산로·시설·등고선 + per-산 base.pmtiles). 브라우저가
    **R2에서 직접 fetch**(R2 CORS 필요). 구축·이관 과정은 **[CLOUDFLARE.md](CLOUDFLARE.md)**
- **백엔드(Supabase) = 인증 + 관계형 DB 만** — 로그인, 기록 동기화, 산 카탈로그/정보.
  (파일 저장은 전부 R2로 이관 → Supabase 는 Auth·DB 전담)
  등반 런타임(지도·경로)은 항상 로컬이 담당하는 **로컬 우선(local-first)** 모델.
  - 모든 사용자 테이블에 **RLS(Row Level Security)** — 본인 데이터만 접근
  - 클라이언트는 **공개(publishable) 키만** 사용. **비밀(secret) 키는 `.env` 전용**(절대 커밋·프런트 금지)

---

## 4. 빠르게 실행하기

```bash
git clone https://github.com/ksthink/hihi.git
cd hihi
python3 scripts/serve.py        # 정적 서버 + /pmtiles 프록시 (포트 8890)
# → http://localhost:8890
```

> ⚠️ `python3 -m http.server` 로도 페이지는 뜨지만, `/pmtiles/*` 프록시가 없어 **기저 지도가
> 나오지 않습니다.** 반드시 `serve.py`(또는 관리자 서버 `admin_server.py`)를 사용하세요.

---

## 5. 배포 (Vercel)

`main` 브랜치에 push 하면 자동 재배포됩니다.

- `api/tiles.js` — `/pmtiles/*` 를 R2 기저 타일로 중계(Range 전달 + CDN 캐시)
- `api/weather.js` — 기상청 예보 프록시 (환경변수 `KMA_KEY`)
- `vercel.json` — `/pmtiles/*` → `/api/tiles` 리라이트
- `.vercelignore` — 파이프라인 스크립트·관리자 콘솔·문서를 배포에서 제외

**환경변수**
| 변수 | 용도 | 위치 |
|---|---|---|
| `KMA_KEY` | 기상청 API 키 | Vercel 환경변수 |
| 공개(publishable) 키 | Supabase 클라이언트 | 코드에 포함(공개키, RLS 보호) |
| secret 키·R2 키·`ADMIN_PASSWORD` | 시드·업로드·관리자 | **`.env` 전용 (커밋·Vercel 금지)** |

---

## 6. 산 데이터 추가하기 (관리자 콘솔)

산림청 등산로 원본은 코스가 과다하고 분기점이 부정확합니다. 그래서 운영자가 코스를
**선별·명명·보정**해서 배포하는 로컬 관리자 콘솔을 제공합니다.

```bash
bash scripts/setup_admin.sh                    # 최초 1회: .venv + go-pmtiles 설치
.venv/bin/python scripts/admin_server.py       # 0.0.0.0:8890 — 앱(/) + 관리자(/admin/) + API 통합
```

- 접속: `http://<호스트>:8890/admin/` → **비밀번호 로그인**(`.env` 의 `ADMIN_PASSWORD`).
  5회 실패 시 해당 IP **10분 잠금**. (localhost 는 인증 면제)
- 사용 순서:
  1. **검색** — 전국 5,360개 산에서 이름/산코드로 검색 → "추가"(스팟·범위 자동 구성)
  2. **큐레이션** — GPX 업로드로 코스 생성(맵매칭 미리보기), 이름·난이도·설명 편집, 분기점 정리
  3. **배포** — 등고선·기저 타일 생성 → Supabase 반영 → **사용자 앱은 새로고침만으로 반영**
     (앱이 `mountains` 카탈로그를 읽어 동작하므로 코드 재배포 불필요)

> **산 식별자 = 산림청 산코드 9자리.** 이 코드가 Storage 폴더명·DB·저장 팩 키에서 전부
> 공유되므로 한 곳이라도 다르면 연결이 끊깁니다. (자세한 팩 규격은 아래 [8번](#8-저장소-구조) 및
> `scripts/draft_store.py` 참고)

---

## 7. 지도 자산은 전부 자체 호스팅

외부 CDN이 파일을 지우면 지도가 깨집니다(실제로 Protomaps 데모버킷 삭제로 한 번 겪음).
그래서 지도에 필요한 자산은 **전부 자체 호스팅**합니다. iOS 이식 시 그대로 앱 번들이 됩니다.

| 자산 | 호스팅 | 비고 |
|---|---|---|
| 기저 지도 타일 | **Cloudflare R2** (`kr-base.pmtiles`) | egress 무료 · [CLOUDFLARE.md](CLOUDFLARE.md) |
| 오프라인 팩 파일 | **Cloudflare R2** (`packs/<산코드>/`) | egress 무료 · 브라우저 직접 fetch(R2 CORS) |
| 지도 라벨 글리프 | **리포 내 `fonts/`** (same-origin) | 나눔고딕코딩 라틴 글리프(PBF) |
| 지도 한글 폰트 | **리포 내 `fonts/`** (`.woff2`) | 나눔고딕코딩 (localIdeographFontFamily) |
| UI 폰트 | **리포 내 `fonts/`** (`.woff2`) | KakaoSmallSans |

**지도 라벨 폰트 구조** (참고)
- 한글·CJK → `localIdeographFontFamily` 가 기기 canvas 로 렌더 (자체 호스팅 woff2)
- 라틴·숫자·기호 → SDF 글리프 PBF (`fonts/Nanum Gothic Coding Regular/`)
- → 지도 전체가 **나눔고딕코딩**으로 통일됨

> 남은 외부 의존은 `maplibre-gl`·`pmtiles`·`supabase-js` 라이브러리(ESM CDN)뿐이며,
> 이는 iOS 에서 네이티브 SDK로 대체되는 부분입니다.

---

## 8. 저장소 구조

```
hihi/
├── index.html            앱 셸 (HTML)
├── app.js                앱 전체 로직 (지도·검색·등반·기록·오프라인·날씨·국가지점번호)
├── basemap-style.js      흑백 MapLibre 스타일 생성 buildStyle(url, theme)
├── style.css             흑백 디자인 시스템 (CSS 변수 = 디자인 토큰)
├── supabase-client.js    Supabase 초기화 + 인증 헬퍼 (공개 키)
├── weather.js            기상청 예보 도메인 로직 (격자변환·병합·아이콘)
├── npn.js                국가지점번호 변환 (WGS84 → UTM-K/EPSG:5179)
│
├── fonts/                자체 호스팅 폰트 + 지도 글리프 (§7)
│   ├── KakaoSmallSans-*.woff2            UI 폰트
│   ├── NanumGothicCoding-Regular.woff2   지도 한글 폰트
│   └── Nanum Gothic Coding Regular/*.pbf 지도 라틴 글리프
│
├── api/                  Vercel 서버리스 함수
│   ├── tiles.js          기저 타일 프록시 (→ Cloudflare R2)
│   └── weather.js        기상청 예보 프록시
│
├── admin/                관리자 콘솔 SPA (로컬 운영 도구, 배포 제외)
│   ├── index.html · admin.js · admin.css
│
├── scripts/              콘텐츠 파이프라인 + 서버 (앱에 포함 안 됨)
│   ├── serve.py              로컬 개발 서버 (정적 + /pmtiles 프록시)
│   ├── admin_server.py       관리자 서버 (serve.py 상속 + /admin + /api)
│   ├── r2_lib.py             R2 공용 헬퍼 (boto3 업로드) — 아래 스크립트들이 공유
│   ├── r2_upload.py          R2 대용량 업로드 CLI (kr-base.pmtiles)
│   ├── migrate_packs_to_r2.py 팩 파일 Supabase Storage → R2 일회성 이관
│   ├── draft_store.py        산별 큐레이션 초안 저장소
│   ├── gpx_match.py          GPX → 구간망 맵매칭
│   ├── publish_pack.py       배포: draft → geojson·등고선·타일 → R2 packs/
│   ├── pack_lib.py           공용 라이브러리 (좌표변환·그래프·DEM·프로파일)
│   ├── dem_cache.py          Copernicus DEM 타일 캐시
│   ├── seed_mountain_info.py 전국 산 정보(mountain_info) 시드
│   └── (그 외 변환·대안 파이프라인 스크립트)
│
├── supabase/schema.sql   DB 스키마 + RLS (Storage 버킷은 R2로 이관)
├── vercel.json           배포 리라이트
├── data/                 팩 원본 GeoJSON (일부 gitignore: tiles/, packs/)
│
└── 문서: README.md · CLOUDFLARE.md · WORKLOG.md · QA.md · CLAUDE.md
```

**백엔드 리소스** (Supabase = Auth + DB / Cloudflare R2 = 파일)
| 리소스 | 위치 | 내용 |
|---|---|---|
| `mountains` | Supabase DB | 팩 카탈로그 (id=산코드, name, region, elev, center, zoom, bbox, pack_version) |
| `mountain_info` | Supabase DB | 전국 산 정보 5,360건 (높이·관리주체·전화·소개) — 산 소개 카드 소스 |
| `profiles` · `climb_records` · `saved_packs` | Supabase DB | 사용자 데이터 (RLS: 본인만) |
| Auth | Supabase | 이메일 로그인·세션 |
| `packs/<산코드>/` | **Cloudflare R2** | `base.pmtiles`(오프라인 팩) · `routes`/`spots`/`contours.geojson` |
| `kr-base.pmtiles` | **Cloudflare R2** | 기저 지도 타일 |

---

## 9. iOS 네이티브 이식 계획

**전략: 웹에서 ~80% 설계·검증 → 맥북 로컬에서 MapLibre Native + SwiftUI 로 완성.**
상세 계획: `~/.claude/plans/moonlit-rolling-tulip.md`

| 항목 | 웹(현재) | iOS(계획) |
|---|---|---|
| 지도 스타일·타일·데이터 | MapLibre GL JS + PMTiles + GeoJSON | MapLibre Native 가 동일 소비 |
| 백엔드 | Supabase (스키마·RLS·Auth) + R2(파일) | `supabase-swift` 재사용 · R2는 파일 fetch/번들 |
| GPS 트래킹 | `watchPosition` (화면 켠 상태만) | CoreLocation **백그라운드** |
| 오프라인 저장 | IndexedDB (퇴거 가능) | 파일시스템 영구 저장 |
| 기저 타일 | Cloudflare R2 (프록시 경유) | 산별 추출본 **앱 번들** |
| 폰트·글리프 | 자체 호스팅(`fonts/`) | 앱 번들 그대로 복사 |
| CORS 프록시 | 웹 전용 (`serve.py`·`api/tiles.js`) | **불필요** (로컬 파일 range 접근) |

---

## 10. 데이터 출처 · 라이선스

- **기저 지도**: [Protomaps](https://protomaps.com) Basemap · © [OpenStreetMap](https://openstreetmap.org) 기여자
  (ODbL — 저작자 표시 및 파생 데이터 share-alike). 타일은 Cloudflare R2 에 자체 호스팅.
- **등산로·시설**: OpenStreetMap (ODbL) / 산림청·국립공원공단 공간정보 (약관 준수)
- **등고선·고도**: Copernicus GLO-30 DEM (AWS Open Data) / NASA SRTM (퍼블릭 도메인)
- **날씨**: 기상청 단기예보 (data.go.kr)
- **지도 폰트**: 나눔고딕코딩 (SIL Open Font License) — `fonts/NanumGothicCoding-OFL.txt`
- ⚠️ **등산로 라인은 개략 데이터입니다.** 실제 산행 시 국립공원공단 등 **공식 지도를 반드시 확인**하세요.
- 한국 정밀 국가기본도의 국외 반출 규제를 고려해, 지도 데이터 호스팅은 국내(서울) 리전을 권장합니다.

---

## 11. 함께 보면 좋은 문서

| 문서 | 내용 |
|---|---|
| **[CLOUDFLARE.md](CLOUDFLARE.md)** | Cloudflare R2 기저 타일 자체 호스팅 **구축 순서**(처음 하는 사람용) |
| [WORKLOG.md](WORKLOG.md) | 작업일지 (날짜별 생성·수정 기록) |
| [QA.md](QA.md) | 설계 질문/답변 기록 |
| [CLAUDE.md](CLAUDE.md) | 개발 지침 (iOS 이식 전제 규칙 등) |
| `~/.claude/plans/moonlit-rolling-tulip.md` | iOS 네이티브 이식 상세 계획서 |
