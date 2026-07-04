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
- **등고선 오버레이** (SRTM DEM 생성): 100m 주 등고선(줌 10.5+), 50m 보조(12.5+), 고도 라벨(13.5+)
- **경로 지점**(분기점·시종점) 점 표시, 주요 봉우리(백운대·대청봉 등) 라벨
- 등산로 목록 바텀시트 — 코스별 난이도(보통/어려움/매우 어려움)·거리·시간·**고도 미니그래프**
- 코스 선택 시 해당 루트만 필터 표시 + 제목 블록에 "산이름 | 코스명"
- **산 검색** — 좌상단 돋보기, 한글 IME 대응 인라인 자동완성
- 지도 컨트롤: 나침반·현재위치·테마 토글(우하단), 축척(좌하단)

### 추천
- "대한민국 100대 명산" 목록(현재 북한산·설악산)에서 산 선택
- 추천 코스 카드 → 탭하면 해당 코스로 바로 이동

### 등반
- 선택 코스의 거리·예상 시간·난이도·**고도 정보**(최고/최저/누적상승) + 고도 프로파일 그래프
- **등반 시작/종료** — 종료 시 등반 기록이 계정에 저장됨(웹 단계: 시간·코스 통계 기준)

### 기록 (계정)
- **이메일 + 비밀번호 회원가입/로그인** (Supabase Auth)
- 등반 기록 목록 + 요약 통계(총 산행·총 거리·누적 고도)
- 기록은 서버(Postgres + RLS)에 저장 — **본인만 조회 가능**, 새로고침/재접속에도 유지

### 오프라인 저장
- 탐험 시트의 **"이 산 오프라인 저장"** — 서버(Supabase Storage)에서 그 산의 팩
  (routes/spots/contours GeoJSON)을 받아오고, 계정에 "저장한 산"으로 기록
- 웹 단계에서는 **배포 경로 검증 + 저장 표시**까지 구현
  (실제 기기 캐싱은 iOS 파일시스템 단계에서 완성 — §5 로드맵 참고)

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
| `make_contours.py` | SRTM 1-arcsec DEM(AWS elevation-tiles-prod)에서 50m 간격 등고선 생성 (numpy/contourpy, venv 필요) |
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
| 등반 GPS 트래킹 | 시작/종료 시간만 기록 | CoreLocation 실시간 트랙 + 백그라운드 위치 |
| 오프라인 저장 | 배포 검증 + 저장 표시 | 파일시스템에 팩 실저장 (Application Support) |
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

## 7. 저장소 구조

| 경로 | 설명 |
|---|---|
| `index.html` | 앱 셸 — 시뮬레이터 프레임, 4개 뷰(탐험/추천/등반/기록), 탭바 |
| `app.js` | 지도·오버레이·코스 선택·검색·인증·기록·오프라인 저장 로직 |
| `basemap-style.js` | Protomaps v4 스키마용 흑백 MapLibre 스타일(라이트/다크) |
| `style.css` | 흑백 테마 변수 + 모바일 레이아웃 |
| `supabase-client.js` | Supabase 클라이언트 + 인증 헬퍼 |
| `supabase/schema.sql` | DB 스키마(테이블·RLS·버킷) — SQL Editor 에서 1회 실행 |
| `data/*.geojson` | 등산로·경로지점·등고선·봉우리 (산별 팩 원본) |
| `scripts/*.py` | 데이터 파이프라인 + 로컬 서버 + 시드 |
| `vercel.json` / `.vercelignore` | 배포 설정 |
| `WORKLOG.md` | 작업일지 (날짜별 생성/수정 기록) |
| `QA.md` | 프로젝트 질문/답변 기록 |
| `CLAUDE.md` | 개발 지침 (iOS 이식 염두 규칙 등) |

---

## 8. 데이터 출처 · 라이선스 · 주의

- **기저 지도**: [Protomaps](https://protomaps.com) PMTiles · © [OpenStreetMap](https://openstreetmap.org) 기여자 (ODbL — 저작자 표시 및 파생 데이터 share-alike)
- **등산로**: OpenStreetMap (ODbL)
- **등고선/고도**: NASA SRTM 1-arcsec (퍼블릭 도메인, AWS Open Data 배포)
- **경로 지점**: 산림청 등산로 공간정보 (해당 약관 준수)
- ⚠️ **등산로 라인은 개략 데이터입니다.** 실제 위치·거리와 다를 수 있으니
  산행 시 국립공원공단 등 공식 지도를 반드시 확인하세요.
- 한국 정밀 국가기본도의 국외 반출 규제를 고려해, 지도 데이터 호스팅은 국내(서울) 리전을 권장합니다.
