# 하이하잇 (HiHeight) — 오프라인 우선 대한민국 등산 앱

> **"산에서는 네트워크도, 배터리도 아껴야 한다."**

하이하잇은 대한민국 명산(현재 북한산·설악산)의 등산로를 탐험하고, 오프라인으로 저장하고,
등반을 기록하는 **모바일 등산 앱**입니다. 지금은 **MapLibre GL JS + PMTiles** 기반 웹앱으로
개발 중이며, 최종적으로는 **iOS 네이티브 앱(MapLibre Native + SwiftUI)** 으로 완성됩니다.

**라이브 데모**: https://hihi.metaphr.dev — 폰으로 접속하면 전체화면 앱 레이아웃,
데스크톱에서는 iPhone 17(402×874) 시뮬레이터 프레임으로 표시됩니다.

---

## 1. 프로젝트 취지

### 왜 만드는가
- **오프라인 우선** — 산에는 전파가 닿지 않는 구간이 많습니다. 지도·등산로·시설 정보를
  미리 기기에 저장해 두고, 등반 중에는 **네트워크 호출 0** 으로 동작하는 것이 목표입니다.
- **배터리 절약** — 등산에서 배터리는 안전 문제입니다. 화면 소비를 줄이기 위해
  **색상을 배제한 흑백(모노크롬) UI** 만 제공합니다. 다크 모드는 순수 검정 배경(OLED 절전),
  라이트 모드는 순수 흰색. 기저 지도도 흑백으로 렌더링합니다.
- **대한민국 지형 특화** — 지도 범위를 남한 전역(제주·독도 포함)으로 제한하고,
  한국 명산의 등산로·등고선·경로 지점을 산별 "팩" 단위로 관리합니다.

### 사용자 워크플로 (설계 기준)
1. 앱을 열고 산을 검색한다 → 지도와 등산로 목록이 보인다.
2. 마음에 드는 산을 **오프라인 저장**한다 → 지도·루트·시설 데이터가 로컬에 저장된다.
3. 저장된 코스를 골라 **등반 시작** → 완전 오프라인 상태에서 GPS 트래킹.
4. 등반이 끝나면 **기록**이 저장되고, 온라인이 되면 계정에 동기화된다.

---

## 2. 기능

### 탐험 (지도)
- PMTiles 벡터 기저 지도 — 흑백, 화이트/다크 테마 대응
- **북한산 등산로 40개 코스** (OSM 실데이터): 능선·계곡 등산로 22개 + 북한산둘레길 18구간
- **등고선 오버레이** (Copernicus GLO-30 DEM, 50m 간격): 100m 주 등고선(줌 10.5+), 50m 보조(12.5+), 고도 라벨(13.5+)
- **경로 지점**(분기점·시종점) 점 표시, 주요 봉우리(백운대·대청봉 등) 라벨
- 등산로 목록 바텀시트 — 코스별 난이도(보통/어려움/매우 어려움)·거리·시간·**고도 미니그래프**
- 코스 선택 시 해당 루트만 필터 표시 + 제목 블록에 "산이름 | 코스명"
- **산 검색** — 좌상단 돋보기, 한글 IME 대응 인라인 자동완성
- 지도 컨트롤: 나침반·현재위치·테마 토글(우하단), 축척(좌하단)

### 추천
- "대한민국 100대 명산" 목록(현재 북한산·설악산)에서 산 선택
- 추천 코스 카드 → 탭하면 해당 코스로 바로 이동

### 등반
- 상단 고정 카드: 선택 코스의 거리·예상 시간·난이도·**고도 정보**(최고/최저/누적상승) + 프로파일 그래프
- 카드 아래 **"저장된 지도"** 목록(용량·저장일·삭제) — 여러 개면 목록만 스크롤
- **등반 시작 → 지도 기반 실시간 트래킹**: 선택 코스만 표시된 지도로 전환 + 현재위치 추적,
  HUD(경과 시간·실측 이동거리·GPS 지점 수), 5m 필터로 GPS 트랙 기록
- **종료 시 실측 기록 저장** — 실측 거리(50m+)·소요 시간·GPS 트랙(`track` jsonb, 최대 2000지점)
- 웹 한계(iOS CoreLocation 에서 해소): 화면이 꺼지면 GPS 중단(백그라운드 추적 불가)

### 기록 (계정)
- **이메일 + 비밀번호 회원가입/로그인** (Supabase Auth)
- 등반 기록 목록 + 요약 통계(총 산행·총 거리·누적 고도)
- 기록은 서버(Postgres + RLS)에 저장 — **본인만 조회 가능**, 새로고침/재접속에도 유지

### 인트로
- 접속 시 스플래시: "끊임없이 걷다, 오롯이 몰입하다" → **하이-하잇(HI-Hike)** 순차 페이드인
  → 탐험 화면 진입 (라이트/다크 대응, 초기 지도 로딩 가림 겸용)

### 오프라인 지도 저장 (핵심 기능)
- **로그인 필요** — 저장된 지도 목록은 본인 계정(`saved_packs`) 기준으로만 노출,
  로그아웃 시 숨김(팩 파일은 기기에 유지되어 재로그인 시 재표시)
- 코스 목록 상단 **"지도 다운"** → Wi-Fi 경고 모달(실제 팩 용량 표시) → 확인 시 다운로드
- 다운로드 중: 산 이름·용량·**프로그레스바**(타일은 바이트 단위 진행률)
- 팩(기저 타일 base.pmtiles + 등산로·시설·등고선)이 **기기(IndexedDB)에 저장**되고,
  완료 시 **등반 탭으로 자동 이동** → **"저장된 지도" 목록**에 추가(용량·저장일·삭제)
- 저장된 지도 클릭 → **네트워크 없이 로컬 타일로 지도 렌더**(`pmtiles://local-<id>`) +
  최근 코스 자동선택 → 바로 **등반 시작** 가능
- 웹 한계(iOS 파일시스템에서 해소): 앱 셸·글리프 폰트는 네트워크 필요 → 페이지가 열린
  상태의 오프라인 지도 사용까지 지원. IndexedDB 는 브라우저 용량 정책에 따라 퇴거될 수 있음

---

## 3. 아키텍처

```
┌─ 프런트엔드 (정적, 빌드 없음) ──────────────────┐
│  index.html · app.js · basemap-style.js · style.css │
│  MapLibre GL JS 4.7 + pmtiles 3.2 (CDN ESM)          │
│  supabase-client.js (@supabase/supabase-js, CDN ESM) │
└──────────────┬───────────────────┬──────────────┘
               │                   │
   /pmtiles/*  │                   │  REST / Auth / Storage
   (리라이트)   ▼                   ▼
   Protomaps demo bucket      Supabase (서울 권장)
   (기저 벡터 타일)            ├ Postgres + RLS
                              │  mountains / profiles /
                              │  climb_records / saved_packs
                              └ Storage: packs/<산>/…
```

- **프런트**: 순수 정적 파일. 번들러/빌드 스텝 없음. 브라우저 네이티브 ES 모듈.
- **기저 타일**: PMTiles 는 HTTP Range 요청으로 필요한 타일만 읽음.
  - 로컬 개발: `scripts/serve.py` 가 정적 서빙 + `/pmtiles/*` CORS 프록시
  - 배포(Vercel): `vercel.json` 의 rewrite 가 같은 역할 (same-origin → CORS 문제 없음)
- **백엔드(Supabase)**: 온라인 기능 전용 — 계정, 기록 동기화, 팩 배포.
  등반 런타임(지도·경로)은 항상 로컬이 담당하는 **로컬 우선(local-first)** 모델.
  - 모든 사용자 테이블에 **RLS(Row Level Security)** — `auth.uid() = user_id` 본인만 접근
  - 클라이언트는 **publishable 키**(공개, RLS 보호)만 사용.
    **secret 키는 로컬 시드 스크립트 전용**(절대 커밋/프런트 금지)

---

## 4. 데이터 파이프라인 (`scripts/`)

산 하나의 "팩" = `routes.geojson`(등산로) + `spots.geojson`(경로 지점) + `contours.geojson`(등고선).

| 스크립트 | 역할 |
|---|---|
| `osm_trails.py` | Overpass(OSM)에서 능선 등산로(`highway=path` + 이름) + 둘레길(`route=hiking`)을 코스로 변환. `sac_scale` 로 난이도 산정 |
| `make_contours_copernicus.py` | **등고선 생성(현행)**: Copernicus GLO-30 DEM(AWS Open Data, COG)에서 산 bbox 등고선 → shapely 단순화 (rasterio/contourpy/shapely). 무료·저장자유, 전 세계 커버 |
| `make_contours.py` | 등고선 생성(대안): SRTM 1-arcsec DEM 50m (numpy/contourpy) |
| `add_elevation.py` | 각 코스에 고도 프로파일·최고/최저·누적상승 계산(DEM 이중선형 보간) |
| `convert_spots.py` | 산림청 Esri JSON 스팟을 EPSG:5186 → WGS84 역투영 변환(외부 의존성 없음) |
| `upload_packs.py` | 팩을 Supabase Storage 에 업로드 + `mountains` 카탈로그 시드 (secret 키 env 필요) |
| `serve.py` | 로컬 개발 서버 (정적 + PMTiles CORS 프록시, 포트 8890) |

### 새 산 추가하는 법 (요약 — 상세는 `QA.md`)
1. **생성**: 위 파이프라인으로 `data/<산>-routes/-contours(/-spots).geojson` 생성
2. **등록**: `app.js` 의 `PARKS` 와 `FAMOUS` 에 산 추가
3. **시드**: `upload_packs.py` 의 `PACKS`/`MOUNTAINS` 에 추가 후 실행

```bash
# 시드 실행 (secret 키는 로컬 .env 로만 — 커밋 금지)
export SUPABASE_URL=https://<프로젝트>.supabase.co
export SUPABASE_SECRET_KEY=sb_secret_...
python3 scripts/upload_packs.py
```

> ⚠️ 현재 스팟·등고선 로드는 북한산 하드코딩 상태라, 두 번째 산부터는
> 산별 로드 일반화 작업이 1회 필요합니다 (`QA.md` 2026-07-04 항목 참고).

### 팩 업로드 규격 (Pack Specification)

팩을 업로드/추가할 때 반드시 아래 규격을 따릅니다. 웹앱·시드 스크립트·(향후) iOS 가
모두 이 규격을 전제로 동작합니다.

**① 식별자 (`mountain_id`) = 산림청 산코드 9자리**
- 전국 산 코드 원천: `scripts/MNT_CODE.xlsx`(목록 2,931산) + `scripts/mnt.xlsx`(산정보 4,704산,
  항공본부) → `scripts/convert_mnt_codes.py` 병합 → `data/mnt-codes.json`
  (5,360산 `{code, name, region, elev?}`, 공통 코드는 산정보가 정본)
- **대표 코드 규칙**: 산림청 체계엔 "산 전체" 코드가 없고 조사구역/봉우리 단위다.
  따라서 **산의 대표 코드 = 주봉(정상) 코드 중 산정보가 충실한 쪽**으로 정한다.
  예: 북한산→**백운대 `113050202`**(835.6m) · 설악산→**대청봉 `428302602`** · 지리산→**천왕봉 `488605302`**
- **산 이름은 전국 중복이 317건**(가야산·지리산 등) — 이름을 키로 쓰지 말 것. 표시할 때는
  `region` 을 함께 노출해 구분한다.
- 이 코드가 Storage 폴더명 · `mountains.id` · `app.js` `PARKS`/`MNT` 키 · `saved_packs.mountain_id` ·
  `climb_records.mountain_id` · IndexedDB 팩 키로 **전부 공유**됩니다 (한 곳이라도 다르면 연결이 끊어짐)
- 로컬 데이터 파일명은 가독성을 위해 로마자 유지 가능 (`data/bukhansan-routes.geojson`) —
  코드→파일 매핑은 `PARKS[<코드>].file` 이 담당

**② Storage 파일 레이아웃** — 버킷 `packs` (공개 읽기), **파일명 고정**

```
packs/<mountain_id>/base.pmtiles       필수 — 기저 벡터 타일 (bbox 추출본, z0~15)
packs/<mountain_id>/routes.geojson     필수 — 등산로 코스
packs/<mountain_id>/spots.geojson      선택 — 경로 지점
packs/<mountain_id>/contours.geojson   선택 — 등고선
```
- Content-Type: pmtiles = `application/octet-stream`, GeoJSON = `application/geo+json` (`x-upsert: true`)
- 파일명은 앱(`app.js` `downloadPack`)이 위 이름을 그대로 조회하므로 변경 금지
- `base.pmtiles` 생성(go-pmtiles CLI):
  ```bash
  pmtiles extract https://demo-bucket.protomaps.com/v4.pmtiles \
    data/tiles/<id>-base.pmtiles --bbox=<minLon>,<minLat>,<maxLon>,<maxLat> --maxzoom=15
  ```
  (북한산 기준 약 8.5MB. `data/tiles/` 는 gitignore — Storage 로만 배포)

**③ GeoJSON 본문 규격**
- 좌표계: **WGS84(EPSG:4326)**, 좌표 순서 **[경도, 위도]** — 국내 좌표계(EPSG:5186 등)는
  업로드 전 반드시 변환 (`convert_spots.py` 참고)
- 최상위: `FeatureCollection`
- geometry / properties 필드 정의는 **§7.2 데이터 스키마** 를 그대로 준수
  - `routes`: `MultiLineString` + 필수 `name`(고유)·`difficulty`(초급/중급/고급)·`distance_km`,
    권장 `time_hr`·`kind`·`desc`·`min_elev`·`max_elev`·`ascent`·`descent`·`profile[48]`
  - `spots`: `Point` + `category`(분기점/시종점 …)·`detail`·`etc`
  - `contours`: `LineString` + `elev`(m)·`idx`(0=50m 보조, 1=100m 주선)
- `routes` 의 `name` 은 **산 내에서 고유**해야 함 (코스 선택·필터·기록이 name 기준)

**④ `mountains` 카탈로그 행 규격** — 팩 업로드와 함께 upsert

| 필드 | 타입 | 규격 | 예시 |
|---|---|---|---|
| `id` | text | ① 의 mountain_id | `"bukhansan"` |
| `name` | text | 한글 산 이름 | `"북한산"` |
| `region` | text | 지역 표기 | `"서울·경기"` |
| `elev` | int | 최고봉 고도(m) | `836` |
| `center` | jsonb | `[경도, 위도]` — 지도 초기 중심 | `[126.990, 37.672]` |
| `zoom` | real | 지도 초기 줌 | `11.3` |
| `bbox` | jsonb | `[minLon, minLat, maxLon, maxLat]` — 타일 추출·카메라 제한용 | `[126.90, 37.59, 127.06, 37.75]` |
| `pack_version` | int | 팩 버전 — **내용 변경 시 +1** (클라이언트가 saved_packs 의 버전과 비교해 갱신 감지) | `1` |
| `pack_size_kb` | int | 팩 총 용량(KB) — 시드 스크립트가 자동 계산 | `627` |

**⑤ `scripts/upload_packs.py` 등록 형식** — 새 산은 두 곳에 추가

```python
PACKS = {
    "488605302": {   # ← mountain_id = 산코드 (지리산_천왕봉, data/mnt-codes.json 에서 조회)
        "data/tiles/jirisan-base.pmtiles": "base.pmtiles",
        "data/jirisan-routes.geojson":   "routes.geojson",    # 로컬 경로: Storage 파일명
        "data/jirisan-spots.geojson":    "spots.geojson",     # (없으면 줄 생략)
        "data/jirisan-contours.geojson": "contours.geojson",
    },
}
MOUNTAINS = [
    {"id": "488605302", "name": "지리산", "region": "전남·전북·경남", "elev": 1915,
     "center": [127.731, 35.337], "zoom": 11.0,
     "bbox": [127.62, 35.27, 127.83, 35.42], "pack_version": 1},
]
```

**⑥ 체크리스트 (업로드 전)**
- [ ] `mountain_id` 가 `data/mnt-codes.json` 에 있는 **산코드 9자리**인가? (이름 슬러그 금지)
- [ ] 좌표가 WGS84 [lng, lat] 인가? (한국이면 lng 124~132, lat 33~39 범위)
- [ ] `routes` 의 코스 `name` 이 산 내 고유한가?
- [ ] `difficulty` 값이 `초급/중급/고급` 중 하나인가? (표시 라벨과 혼동 금지)
- [ ] 산코드가 `PARKS`/`MNT`(app.js)·`PACKS`/`MOUNTAINS`(시드)에서 동일한가?
- [ ] 내용이 바뀐 재업로드라면 `pack_version` 을 올렸는가?

---

## 5. 개발 계획 (로드맵)

### 전략: 웹에서 ~80% → iOS 네이티브로 완성
UI/UX·데이터 모델·백엔드를 웹에서 빠르게 설계·검증한 뒤,
맥북 로컬에서 **MapLibre Native iOS + SwiftUI** 로 이식해 완성합니다.
상세 이식 계획: `~/.claude/plans/moonlit-rolling-tulip.md` (+ 부록 A: Supabase 연동).

### 그대로 이관되는 것
- 지도 스타일 JSON(흑백 라이트/다크) · PMTiles · GeoJSON 데이터 → MapLibre Native 가 동일 소비
- Supabase 스키마·RLS·Storage → `supabase-swift` SDK 로 재사용 (백엔드 재작업 없음)
- 데이터 파이프라인(`scripts/`) → 명산 팩 빌드 도구로 유지

### iOS 에서 새로 구현되는 것 (현재 웹은 스텁/부분 구현)
| 기능 | 웹(현재) | iOS(계획) |
|---|---|---|
| 등반 GPS 트래킹 | watchPosition 실시간 트랙(화면 켠 상태만) | CoreLocation + **백그라운드 위치** |
| 오프라인 저장 | IndexedDB 팩 실저장 + 로컬 타일 렌더(퇴거 가능) | 파일시스템 영구 저장 (Application Support) |
| 기저 타일 | Protomaps CDN (리라이트 경유) | 산별 `pmtiles extract` 로컬 번들 |
| 글리프 폰트 | protomaps.github.io CDN | 앱 번들 포함 |
| 테마/상태 저장 | localStorage | UserDefaults / SwiftData |

### 다음 할 일 (웹 단계)
- [ ] 새 명산 팩 추가(지리산·한라산 등) + 스팟/등고선 산별 로드 일반화
- [ ] 보관함(저장한 산) UI — 기록 탭과 분리 검토
- [ ] 설악산 실데이터 교체(현재 샘플)
- [ ] (선택) 기저 타일 자가호스팅 — `pmtiles extract` → Supabase Storage (iOS 준비 겸용)

---

## 6. 로컬 개발

```bash
git clone https://github.com/ksthink/hihi.git
cd hihi
python3 scripts/serve.py          # 정적 서버 + PMTiles CORS 프록시 (포트 8890)
# → http://localhost:8890
```

> `python3 -m http.server` 로도 페이지는 뜨지만 `/pmtiles/*` 프록시가 없어
> 기저 지도가 나오지 않습니다. 반드시 `serve.py` 를 사용하세요.

### 배포 (Vercel)
`main` 브랜치에 push 하면 자동 재배포됩니다.
- `vercel.json` — `/pmtiles/*` 를 Protomaps 로 리라이트 (로컬 프록시의 배포판)
- `.vercelignore` — 파이프라인 스크립트·SQL·문서를 배포에서 제외
- 환경변수 불필요: publishable 키는 공개키(RLS 보호)라 코드에 포함되어 있습니다.
  secret 키는 어떤 경우에도 Vercel/프런트에 두지 않습니다 (`QA.md` 참고).

### Supabase 셋업 (새 프로젝트 기준)
1. Supabase 프로젝트 생성 (**서울 리전 권장** — 한국 지도 데이터 규제 리스크 완화)
2. SQL Editor 에서 `supabase/schema.sql` 실행 → 테이블 4개 + RLS + `packs` 버킷
3. `supabase-client.js` 의 URL·publishable 키를 본인 프로젝트 값으로 교체
4. `scripts/upload_packs.py` 로 팩 시드 (secret 키는 env 로만)
5. Authentication → URL Configuration 에 배포 도메인 추가 (가입 확인 메일 복귀 경로)

---

## 7. 저장소 구조 (상세)

> iOS 이식 시 시행착오를 줄이기 위한 **정밀 구조도**입니다. 각 항목에 이식 처리 방식을 표기합니다.
> **[이관]** 그대로 재사용 · **[치환]** 네이티브 대응물로 교체 · **[폐기]** 웹 전용 · **[도구]** 콘텐츠 빌드용(앱 외부)

### 7.1 전체 트리

```
hihi/
├── index.html              [치환→SwiftUI] 앱 셸. ⚠️ 시뮬레이터 크롬(.sim-window/.statusbar/
│                             .island/.home-indicator)은 목업 — iOS 에서 전량 폐기
├── app.js                  [치환→Swift]  전체 앱 로직 (§7.3 내부 구조 참고 — 인터랙션 스펙으로 사용)
├── basemap-style.js        [이관]        buildStyle(url, theme) → 흑백 MapLibre 스타일 JSON.
│                             출력 JSON 을 MapLibre Native 가 그대로 소비 (glyphs URL 만 로컬로 교체)
├── style.css               [치환→SwiftUI] 흑백 디자인 시스템. CSS 변수(:root/--*)가 디자인 토큰 원본
├── supabase-client.js      [치환→supabase-swift] URL·publishable 키·인증 헬퍼.
│                             스키마/RLS/버킷은 그대로 재사용 (백엔드 재작업 없음)
│
├── fonts/                  [이관] UI 폰트 — iOS 앱 번들에 그대로 포함 (CDN 미의존)
│   ├── KakaoSmallSans-Light.woff2     (300 — 설명·힌트)
│   ├── KakaoSmallSans-Regular.woff2   (400 — 본문·메타)
│   └── KakaoSmallSans-Bold.woff2      (700 — 제목·버튼·수치)
│
├── data/                   [이관] 명산 팩 원본 — MLNShapeSource 로 그대로 로드 (§7.2 스키마)
│   ├── bukhansan-routes.geojson    북한산 등산로 40코스 (OSM, 190KB)
│   ├── bukhansan-spots.geojson     경로 지점 221개: 분기점·시종점 (38KB)
│   ├── bukhansan-contours.geojson  등고선 343개: 50m 간격 (397KB)
│   ├── peaks.geojson               주요 봉우리 7개 (북한산+설악산 공용)
│   ├── seoraksan-routes.geojson    설악산 대청봉 등산로 57구간 (산림청 변환, 미큐레이션)
│   ├── seoraksan-spots.geojson     설악산 대청봉 스팟 45개 (분기점·시종점)
│   ├── seoraksan.geojson           (레거시 샘플 4코스 — 미사용, 삭제 후보)
│   ├── bukhansan.geojson           (레거시 샘플 3코스 — 미사용, 삭제 후보)
│   ├── mnt-codes.json              전국 산 카탈로그 5,360건 {code,name,region,elev?} — id 표준의 원천
│   └── tiles/                      (gitignore) base.pmtiles 추출본 — Storage 로만 배포
│
├── supabase/
│   └── schema.sql          [이관] DB 스키마 + RLS + packs 버킷. 새 환경 셋업 시 1회 실행
│
├── scripts/                [도구] 콘텐츠 파이프라인 — 앱에 포함되지 않음, 맥북에서도 그대로 사용
│   ├── serve.py                    [폐기 예정] 로컬 개발 서버(정적+PMTiles CORS 프록시, :8890).
│   │                                 iOS 는 로컬 파일 접근이라 프록시 개념 자체가 없음
│   ├── osm_trails.py               ★ 등산로 생성(현행): Overpass 결과 → routes.geojson
│   ├── make_contours_copernicus.py ★ 등고선 생성(현행): Copernicus GLO-30(COG) → bbox 등고선 (rasterio/contourpy/shapely)
│   ├── make_contours.py            등고선 생성(대안): SRTM DEM 50m (venv: numpy/contourpy)
│   ├── add_elevation.py            ★ 고도 주입: 코스에 profile/ascent/min·max_elev (venv)
│   ├── convert_spots.py            ★ 스팟 변환: 산림청 Esri JSON, EPSG:5186→WGS84 (의존성 없음)
│   ├── convert_seoraksan.py        설악산 산림청 Esri JSON(등산로+스팟) → WGS84 GeoJSON 변환
│   ├── raw_428302602_geojson/      설악산 대청봉 산림청 원본(Esri JSON, EPSG:5186)
│   ├── MNT_CODE.xlsx               산코드 목록 원본(산림청, 2,931산)
│   ├── mnt.xlsx                    산정보 원본(산림청 항공본부, 4,704산 — 소재지·높이·설명)
│   ├── convert_mnt_codes.py        ★ 산코드 병합 변환: 두 xlsx → data/mnt-codes.json (openpyxl)
│   ├── upload_packs.py             ★ Supabase 시드: 팩 업로드 + mountains 카탈로그
│   │                                 (env: SUPABASE_URL, SUPABASE_SECRET_KEY)
│   ├── osm_routes.py               (대안) OSM route=hiking 릴레이션 → 코스
│   ├── extract_routes.py           (대안) 산림청 네트워크에서 Dijkstra 로 코스 추출
│   ├── convert_baegundae.py        (대안) 백운대 Esri JSON 변환
│   ├── convert_routes.py           (대안) 홍은동 자락길 변환
│   ├── osm_dulle.json / osm_named.json / osm_named_geom.json   Overpass 원본 캐시
│   ├── route_raw.json / spots_raw_북한산.json / baegundae_*.json 산림청 원본 캐시
│   └── (gitignore: *.hgt DEM 원본, dl_gpx.bin, __pycache__/)
│
├── vercel.json             [폐기] 배포 설정 — /pmtiles/* → Protomaps 리라이트 (웹 전용)
├── .vercelignore           [폐기] 배포 제외 목록 (⚠️ gitignore 문법 — 인라인 주석 금지)
├── .gitignore              공통 (.env 시크릿 차단 포함)
│
├── README.md · WORKLOG.md(작업일지) · QA.md(질문/답변) · CLAUDE.md(개발 지침)
└── (외부) ~/.claude/plans/moonlit-rolling-tulip.md   iOS 이식 계획서 + 부록 A(Supabase)
```

### 7.2 데이터 스키마 (GeoJSON properties) — iOS 모델 정의 시 그대로 사용

**`data/<산>-routes.geojson`** — geometry: `MultiLineString`

| 필드 | 타입 | 의미 |
|---|---|---|
| `name` | string | 코스명 (앱 전역에서 **코스 식별자**로 사용 — 선택/필터/기록) |
| `difficulty` | string | 데이터 값 `초급`/`중급`/`고급` — **표시 라벨은 별도**(보통/어려움/매우 어려움, app.js `DIFF_LABEL`) |
| `distance_km` | number | 코스 길이(km) |
| `time_hr` | number | 예상 소요(시간) |
| `kind` | string | 코스 유형 (능선·계곡 등산로 / 둘레길) |
| `desc` | string | 설명 |
| `segments` | number | 병합된 OSM way 수 (참고용) |
| `min_elev` / `max_elev` | number | 최저/최고 고도(m) |
| `ascent` / `descent` | number | 누적 상승/하강(m) |
| `profile` | number[48] | 등간격 고도 샘플 — 스파크라인 그래프용 |

**`data/<산>-spots.geojson`** — geometry: `Point`

| 필드 | 타입 | 의미 |
|---|---|---|
| `id` | string | 원본 스팟 ID |
| `category` | string | `분기점`/`시종점` 등 — 지도 표시는 app.js `SHOWN` 목록으로 필터 |
| `detail` / `etc` | string | 팝업 상세 텍스트 |

**`data/<산>-contours.geojson`** — geometry: `LineString`

| 필드 | 타입 | 의미 |
|---|---|---|
| `elev` | number | 등고선 고도(m) |
| `idx` | 0\|1 | `0`=50m 보조선(줌 12.5+), `1`=100m 주선(줌 10.5+, 라벨 13.5+) |

**`data/peaks.geojson`** — geometry: `Point` — `name`, `elev`(m), `park`(소속 산 id)

### 7.3 `app.js` 내부 구조 (이식용 인터랙션 스펙)

| 블록 | 핵심 심볼 | iOS 대응 |
|---|---|---|
| 설정 | `PMTILES_URL`, `PARKS{center,zoom,bbox,file}`, `DIFF_LEVEL/DIFF_LABEL`, `SHOWN` | 상수/Config 구조체 |
| 테마 | `theme`, `applyTheme()`, localStorage `hiheight-theme` | UserDefaults + ColorScheme |
| 지도 | `map`(maxBounds 한국, minZoom 5, hash), `ThemeControl` | MLNMapView 카메라 제한 |
| 오버레이 | `ensureOverlays()` — 등고선 3레이어·trail casing/line(난이도별 굵기)·spots·peaks | MLNStyleLayer 1:1 이식 |
| 코스 상태 | `currentPark`, `selectedName`, `trailCache`, `applyTrailFilter()`, `focusTrail()` | 앱 상태(@Observable) |
| 목록/추천 | `renderTrailList()`, `FAMOUS`, `RECO`, `profileSVG()` | SwiftUI List + Path 스파크라인 |
| 검색 | `setupSearch()` — 접두 우선 매칭, 한글 IME 조합 대응 자동완성 | 네이티브 검색(IME 이슈 없음) |
| 인증 | `setupAuth()`, `currentUser`, onAuthStateChange | supabase-swift Auth |
| 등반 | `startClimb()/stopClimb()`(HUD·watchPosition 트랙), `saveClimb()` → climb_records INSERT | CoreLocation 백그라운드 트래킹 |
| 기록 | `renderRecords()` — SELECT + 요약 집계 | SwiftUI + supabase-swift |
| 오프라인 | `downloadPack()`(프로그레스 다운로드)·`idb*`(IndexedDB)·`openSavedMap()`(로컬 타일 렌더)·`renderSavedMaps()` | 파일시스템 저장 + 번들 타일로 승격 |
| 시트 | `setupSheet()` 드래그 바텀시트 | `.presentationDetents` |

### 7.4 Supabase 리소스 (백엔드 — iOS 와 공유)

| 리소스 | 내용 |
|---|---|
| `mountains` | 팩 카탈로그 (id=산코드/name/region/elev/center/zoom/bbox/pack_version/pack_size_kb) |
| `mountain_info` | 전국 산 카탈로그 5,360건 = 산정보 4,704(높이·관리주체·설명 포함) + 목록 전용 656(이름·소재지만) 병합 — data/mnt-codes.json 과 동일 기준. 공개 읽기, 시드: `scripts/seed_mountain_info.py` |
| `profiles` | 사용자 프로필 (RLS: 본인만) |
| `climb_records` | 등반 기록 (started/ended_at, distance_km, ascent_m, duration_s, track jsonb — RLS: 본인만) |
| `saved_packs` | 저장한 산 (user_id+mountain_id PK — RLS: 본인만) |
| Storage `packs/` | `packs/<산id>/routes.geojson`·`spots.geojson`·`contours.geojson` (공개 읽기) |
| 키 정책 | 클라이언트 = **publishable 키만**. secret 키는 시드 스크립트 env 전용(커밋 금지) |

### 7.5 외부(CDN) 의존 현황 — iOS 이식 시 전부 해소 대상

| 의존 | 현재(웹) | iOS 처리 |
|---|---|---|
| `maplibre-gl@4.7.1` ESM | jsdelivr CDN (app.js import) | MapLibre Native SDK |
| `pmtiles@3.2.1` ESM | jsdelivr CDN | Native PMTiles 리더 |
| `@supabase/supabase-js@2` ESM | jsdelivr CDN | supabase-swift |
| 기저 타일 | 온라인 탐색: Protomaps demo(리라이트) / **오프라인: Storage 팩 base.pmtiles → IndexedDB** ✅ | 산별 추출본 번들·파일시스템 |
| 지도 글리프 폰트 | protomaps.github.io (basemap-style.js `glyphs`) | 앱 번들 PBF |
| ~~UI 폰트~~ | ~~CDN~~ → **fonts/ 로컬 번들 완료** ✅ | 번들 그대로 복사 |

---

## 8. 데이터 출처 · 라이선스 · 주의

- **기저 지도**: [Protomaps](https://protomaps.com) PMTiles · © [OpenStreetMap](https://openstreetmap.org) 기여자 (ODbL — 저작자 표시 및 파생 데이터 share-alike)
- **등산로**: OpenStreetMap (ODbL)
- **등고선/고도**: NASA SRTM 1-arcsec (퍼블릭 도메인, AWS Open Data 배포)
- **경로 지점**: 산림청 등산로 공간정보 (해당 약관 준수)
- ⚠️ **등산로 라인은 개략 데이터입니다.** 실제 위치·거리와 다를 수 있으니
  산행 시 국립공원공단 등 공식 지도를 반드시 확인하세요.
- 한국 정밀 국가기본도의 국외 반출 규제를 고려해, 지도 데이터 호스팅은 국내(서울) 리전을 권장합니다.
