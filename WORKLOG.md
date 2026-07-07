# 작업일지 (WORKLOG)

사용자가 **"작업일지 작성"** 이라고 요청하면, 해당 날짜(`## YYYY-MM-DD`) 아래에 그날 **작성·수정한 내용**을 기록한다. 최신 날짜가 위로 온다.

---

## 2026-07-07

### 생성 / 추가
- `weather.js` — 기상청 단기예보 도메인 모듈(LCC 격자변환 `dfsXy`, 발표시각 계산, 초단기+단기예보 병합, 흑백 SVG 아이콘, 시간대별 스트립 렌더). iOS 이식 1:1 참조용
- `api/weather.js` — 기상청 프록시 서버리스(CORS 회피 + 인증키 서버측 은닉, `KMA_KEY`)
- `npn.js` — 국가지점번호 도메인 모듈. WGS84→UTM-K(EPSG:5179) 정변환 + 국가지점번호 산출. Redfearn·Krüger 두 급수 교차검증(전국 오차 <0.1mm), 규정 예시('다사') 격자 일치 확인
- `api/tiles.js` — Protomaps 기저 타일 프록시 서버리스(최신 날짜 빌드 자동 탐지 + Range 전달)
- 산 소개 카드: `index.html`(#mi-sec), `app.js`(`loadMountainInfo`/`renderMountainInfo`) — Supabase `mountain_info`를 산코드로 조인, 산이름·높이 한 줄 + 소개 100자+더읽기(본문 클릭 접힘) + 관리주체 우측 배치·클릭 시 전화번호 팝업·번호 클릭 자동복사
- 등반 국가지점번호 표시: `index.html`(#npn-box, top-overlay 내), `app.js`(`updateNpn` + `watchPosition` 매 위치 갱신) — 등반 시작 시 지도 우측 상단 산·코스 박스 아래에 현재 위치 국가지점번호
- 지도 폰트 자체 호스팅: `fonts/NanumGothicCoding-Regular.woff2`(654KB) + `fonts/Nanum Gothic Coding Regular/*.pbf`(fontnik 생성, 라틴·기호 13범위) + OFL 라이선스. 구 Noto Sans 글리프 제거
- `CLOUDFLARE.md`(신규 문서) — 기저 타일 R2 자체 호스팅 구축 순서 가이드(버킷 생성→공개URL→CORS→API토큰→추출→업로드→앱연결→검증, 처음 하는 사람용)

### 수정 / 변경
- 기상청 날씨 기능: `index.html`(#wx-explore-sec/#wx-climb/#wx-hud), `app.js`(`loadWeather`·`wxCache`·localStorage 스냅샷·`renderClimbWeather`), `style.css`(.wx-*) — 탐험=온라인 실시간, 등반=오프라인 스냅샷, 산 위치 격자 기준, 제목 "〈산이름〉 부근 오늘 날씨", 2시간 간격
- 관리자 콘솔 보안/편집: `scripts/admin_server.py`(비밀번호 로그인 `/api/login`, IP별 5회 실패 시 10분 잠금), `admin/admin.js`(로그인 게이트·로그아웃·코스명 인라인 수정 버그 수정)
- 탐험 검색·코스 표시: `app.js`·`style.css` — 빈 입력 시 목록 미노출(자동완성만, sr-typed 검정/sr-ghost 회색), 검색·전체코스 시 `fitBounds`로 화면 최적화, 선택 코스 검정·나머지 회색(trail-hl), 지도 코스 선택 시 목록 `scrollIntoView`
- 등반 탭 헤더: `index.html`·`app.js`(`updateClimb`)·`style.css` — "등반 | 〈산이름〉" 반전 강조 배지(라이트=검정배경 흰글씨/다크=흰배경 검정글씨)
- 등반 시작 HUD 날씨 제거: `app.js`(`startClimb`에서 wx-hud 숨김) — 출발 전 등반 카드에서만 확인
- 데이터 내보내기(GeoJSON) 섹션 삭제: `index.html`, `app.js`(`download` 헬퍼·리스너 제거)
- 지도 기저 타일 자체 호스팅(Cloudflare R2): `demo-bucket.protomaps.com/v4.pmtiles`(고정 파일) 삭제 대응
  - `scripts/build_forest_pack.py`용 `tools/pmtiles`로 한국 영역 base 추출(bbox 124.5,33–132,43.5 · maxzoom 14 · 505MB)
  - `scripts/r2_upload.py`(신규) boto3 멀티파트 업로드로 R2 버킷 `hihi`에 `kr-base.pmtiles` 업로드(egress 무료), 공개 URL `pub-…r2.dev` + CORS
  - `scripts/serve.py`·`api/tiles.js`·`vercel.json`: 프록시를 R2 고정 객체로 재지정(same-origin·Range 전달, `hiheight/1.0` UA — R2 pub 은 기본 urllib/UA 차단). CDN Cache-Control 추가
  - `app.js` `PMTILES_URL` → `/pmtiles/kr-base.pmtiles`. R2 자격증명은 `.env`만(커밋 금지). 프록시는 웹 전용 계층(iOS 는 로컬 번들 range 접근)
- 지도 글리프 CDN 제거: `basemap-style.js` `glyphs` → `/fonts/{fontstack}/{range}.pbf` (protomaps.github.io 의존 제거, same-origin 정적)
- 지도 라벨 폰트 나눔고딕코딩 통일: `basemap-style.js`·`app.js`·`admin/admin.js` `text-font` → `Nanum Gothic Coding Regular`, `localIdeographFontFamily` → Nanum(한글, 자체 woff2 canvas 렌더), `style.css`·`admin/admin.css` @font-face 추가. 라틴은 fontnik SDF 글리프 — 지도 전체가 나눔고딕코딩. 구글 CDN 미사용
- `README.md` 전면 재작성 — 누구나 이해하도록 구조화(목차·기능표·아키텍처 다이어그램·자체 호스팅·저장소 구조·iOS 이식 로드맵). R2·자체 호스팅 최신 반영, 관련 문서 링크
- 지도 라벨 크기·위계 정비: 전체 축소→위계 조정→20% 확대. base `locality`(잡지명)를 봉우리보다 작게(kind별 match), MapLibre 공식 검증기로 유효성 확인. `temple-names` 레거시 필터 현대 문법화
- 봉우리 강조: 정상(`peaks.geojson` `main:true` = 대청봉·백운대) 14.4px·나머지 11px(case), **볼드**(나눔고딕코딩 Bold 자체 호스팅 `fonts/Nanum Gothic Coding Bold/` + `NanumGothicCoding-Bold.woff2` + @font-face 700), 지명 앞 삼각형(라이트 ▲/다크 △, 테마 전환 시 재부착)
- 팩 파일 저장소 R2 이관: 기존 6산 24파일(base.pmtiles·routes/spots/contours) Supabase Storage → R2 `hihi/packs/` 복사(Supabase 원본은 폴백 유지). `app.js` `packUrl` → R2 직결(base.pmtiles 8.5MB는 Vercel 4.5MB 한도 초과라 프록시 불가), `publish_pack.py` `_upload` → R2. **Supabase 는 이제 Auth+DB 전담**. `scripts/r2_lib.py`·`migrate_packs_to_r2.py`(신규), .venv boto3 추가. R2 CORS 는 프로덕션·localhost 허용(로컬 IP 접속은 `*` 필요)

## 2026-07-04

### 생성 / 초기 구축
- MapLibre GL JS + PMTiles 기반 대한민국 등산 웹앱 **하이하잇** 초기 구축 (index.html, app.js, basemap-style.js, style.css)
- PMTiles 기저지도 로드용 로컬 정적 서버 + CORS 프록시 `scripts/serve.py` (포트 8890)
- 아이폰(402×874) 시뮬레이터 프레임 + 모바일 레이아웃, 하단 탭바(탐험/추천/등반/기록)
- 흑백(라이트/다크) 전용 테마, 난이도 막대 미터
- 데이터 파이프라인 스크립트 `scripts/*.py`: Overpass(OSM), SRTM DEM 등고선/고도, EPSG:5186→WGS84 변환
- `data/*.geojson`: 등산로(북한산 40코스), 스팟(경로지점), 등고선, 봉우리
- iOS 네이티브 이식 타당성 계획(`~/.claude/plans/moonlit-rolling-tulip.md`), 프로젝트 지침 `CLAUDE.md`
- GitHub 저장소 `ksthink/hihi` 초기 커밋/푸시

### 수정 / 반복 개선
- 등산로 데이터 여러 차례 교체: 홍은동 자락(산림청) → 백운대 라우팅 추출 → OSM 둘레길 → **OSM 능선·계곡 등산로 + 북한산둘레길**(최종)
- 스팟: 시설(화장실·음수대 등) → **분기점·시종점(경로 지점)** 으로 교체, 점 크기 축소, 표시 토글 제거(기본 표시)
- 등반 뷰에 고도 정보(최고/최저·누적상승·프로파일 그래프) 추가, 탐험 목록 카드 우측에 고도 미니그래프
- 지도 이동 범위 대한민국으로 제한(maxBounds/minZoom)
- 지도 컨트롤 정리: 확대/축소 버튼 제거, 나침반·현재위치를 하단 우측으로, 순서 조정
- 이모지 전면 제거, 탐험 상단 산 토글 제거 → 추천 탭 "대한민국 100대 명산" 선택 방식으로 전환

### UI/UX 다듬기 (초기 커밋 이후)
- 제목 블록 도입/개선: "산이름 | 코스명" 한 줄(하이하잇 제거), 반투명 배경(60%), 라이트=테두리 없음·다크=흰 아웃라인, 폰트 크기(80%)·굵기(800), 다크모드 색 대응 (index.html, style.css, app.js)
- 지도 컨트롤 정리: 확대/축소 버튼 제거, 나침반·현재위치를 하단 우측으로(순서 조정), 축척을 하단 좌측으로 이동, 화이트/다크 토글을 나침반 위 MapLibre 컨트롤 버튼으로 통합 (app.js, style.css, index.html)
- 난이도 개편: 시트 난이도 범례 제거, 표시 라벨 변경(초급→보통·중급→어려움·고급→매우 어려움; 데이터 값은 유지) (index.html, app.js, style.css)
- 시설(경로 지점) 표시 토글 제거 → 기본 표시 (index.html, app.js, style.css)
- 산 검색 추가: 좌상단 돋보기 버튼 → 검색창, 한글 IME 대응 인라인 자동완성 + 결과 하이라이트 (index.html, app.js, style.css)

### Supabase 백엔드 연동 (계정 · 기록 저장 · 오프라인 저장)
- 생성: `supabase-client.js` — Supabase 클라이언트(anon 키) + 이메일/비밀번호 인증 헬퍼(signUp/signIn/signOut)
- 생성: `supabase/schema.sql` — `mountains`/`profiles`/`climb_records`/`saved_packs` 테이블 + RLS(본인 데이터만) + `packs` Storage 버킷. 붙여넣기 안전(큰따옴표 미사용), 실제 Postgres(도커)로 검증
- 생성: `scripts/upload_packs.py` — service_role 키(env)로 `data/*.geojson` 를 Storage `packs/` 업로드 + `mountains` 시드
- 수정: `app.js` — 기록 스텁(`RECORDS`) → `climb_records` SELECT(async)·요약 집계, 이메일+비밀번호 로그인/가입/로그아웃(`setupAuth`), `등반 시작·종료` → 세션 기록 INSERT(`saveClimb`), `오프라인 저장`(`dl-save`) → Storage 취득 + `saved_packs` upsert, 미사용 상수(`UPSTREAM_PMTILES_URL`) 제거
- 수정: `index.html` — 기록 탭 계정 UI(로그인/가입/로그아웃), 요약 통계 id 부여, 다운로드 섹션을 "오프라인 저장"으로 개편
- 수정: `style.css` — 인증 UI 흑백 스타일 추가
- 수정: `.gitignore` — `.env`/`*.env` 시크릿 커밋 차단
- 검증: 스키마/RLS 실제 Postgres 검증(EXIT 0), 프로젝트에 대한 RLS 무단쓰기 차단(401/42501) 확인, 실계정 스모크 테스트(로그인→기록 INSERT/SELECT→RLS 격리→saved_packs→정리) 통과
- 고지(iOS 이식): CDN ESM `@supabase/supabase-js` 는 이식 시 `supabase-swift` 로 치환(스키마·RLS 재사용), 브라우저 오프라인 캐싱은 범위 밖(iOS 파일시스템), Storage 리전 서울 권장. 상세는 이식 계획서 부록 A

### 팩 시드 · 키 회전 · Vercel 배포
- 생성: `QA.md` — 질문/답변 기록 파일(팩 시드·"3/3" 의미, 등산 팩 추가 방법, Vercel env 안전성)
- 생성: `vercel.json` — `/pmtiles/*` → Protomaps 리라이트(serve.py CORS 프록시를 Vercel rewrite 로 대체)
- 생성: `.vercelignore` — scripts/·supabase/·문서 배포 제외 (이후 인라인 주석이 패턴을 무효화하던 버그 수정)
- 수정: `supabase-client.js` — 레거시 anon 키 폐기에 따라 신규 publishable 키(sb_publishable_)로 교체
- 수정: `scripts/upload_packs.py` — 시드 키를 `SUPABASE_SECRET_KEY`(sb_secret_, 신규 체계) 우선 사용
- 작업: 북한산 팩 시드 실행 — Storage `packs/bukhansan/` 에 routes/spots/contours 업로드 + `mountains` 카탈로그(북한산 627KB·설악산) 시드 → 오프라인 저장 "팩 3/3" 확인
- 작업: Supabase 키 회전 — 채팅에 노출된 service_role 대응, 레거시 API 키(anon/service_role) 비활성화 → 신규 publishable/secret 체계 전환, 폐기·신규 키 동작 모두 검증
- 작업: Vercel 배포(A안) — `https://hihi.metaphr.dev` 가동. 정적 파일 200·pmtiles 리라이트 206·신규 키 반영·제외 파일 404 전부 검증. main 푸시 시 자동 재배포
- 설정: Supabase Authentication URL Configuration 에 `https://hihi.metaphr.dev` 리다이렉트 URL 추가(가입 확인 메일 복귀 경로)

### 폰트 · 문서 · 등반 트래킹
- 수정: 전체 UI 폰트를 **Kakao Small Sans** 로 교체 — weight 3단계 구분(Bold 700 제목·버튼·수치 / Regular 400 본문·메타 / Light 300 설명·힌트), 지도 한글 라벨(localIdeographFontFamily)도 통일 (style.css, app.js)
- 생성: `fonts/KakaoSmallSans-{Light,Regular,Bold}.woff2` — CDN @import 를 **로컬 번들 @font-face** 로 교체(외부 폰트 의존 해소, iOS 번들 그대로 사용) (style.css)
- 수정: `README.md` 전면 개편 — 취지/기능/아키텍처 다이어그램/파이프라인/로드맵/셋업 + **§7 저장소 구조 정밀화**(파일별 이관·치환·폐기 표기, GeoJSON 스키마 표, app.js↔iOS 매핑) + **팩 업로드 규격(Pack Specification)**
- 수정: `QA.md` 에 "Vercel env 안전성", "등산 팩 추가 방법" 항목 추가
- 생성: **등반 모드 — 지도 기반 실시간 트래킹** (index.html #climb-hud, app.js, style.css): 등반 시작→지도 전환(선택 코스만)+현재위치 추적, HUD(경과시간·실측 이동거리·GPS 지점), watchPosition 트랙 기록(5m 필터·최대 2000지점)→`climb_records.track` 저장, 현재위치 점 흑백화. **폰 실측 테스트로 GPS 정확 동작 확인**

### 오프라인 지도 다운로드 (핵심 기능)
- 생성: 시트 헤더 **"지도 다운"** 버튼 + Wi-Fi 경고 모달(카탈로그 실측 용량 표시) + 다운로드 진행 패널(산 이름·용량·**프로그레스바**, base.pmtiles 바이트 단위) (index.html, app.js, style.css)
- 생성: **IndexedDB 로컬 팩 저장소**(`hiheight-packs`) — base.pmtiles Blob + routes/spots/contours 저장, 완료 시 `saved_packs` 기록 + **등반 탭 자동 이동**
- 생성: 등반 탭 **"저장된 지도"** 목록(용량·저장일·삭제) — 클릭 시 `pmtiles://local-<id>` 로컬 Blob 소스로 **네트워크 없이 지도 렌더** + 최근 코스 자동선택 → 바로 등반 시작 (app.js: downloadPack/openSavedMap/renderSavedMaps/useBaseFor)
- 수정: 스팟·등고선 **북한산 하드코딩 → 산별 오버레이(parkOverlays) 일반화**, 기존 "오프라인 저장" 버튼(dl-save)은 새 플로우로 대체 (app.js)
- 생성: 북한산 기저 타일 추출 `data/tiles/bukhansan-base.pmtiles` (go-pmtiles, bbox z0~15, 8.5MB, gitignore) → Storage `packs/bukhansan/base.pmtiles` 업로드, `upload_packs.py` 에 base.pmtiles + Content-Type 분기 추가, 카탈로그 용량 8,959KB 갱신
- 수정: 저장된 지도·다운로드를 **로그인 계정 기준 게이트** — 로그아웃 시 숨김(팩은 기기 유지), 로그인 시 본인 saved_packs 교차 목록만, 비로그인 다운로드는 로그인 유도. **폰 테스트 정상 동작 확인**
- 수정: README 팩 규격에 base.pmtiles 반영(§4), 구조도·CDN 의존 현황 갱신(§7)

### 등반 탭 개편 · 인트로 · 버그 수정
- 수정: 등반 탭 레이아웃 개편 — 등반 안내/시작 카드를 **상단 고정 + 컴팩트화**(패딩·폰트·그래프 축소, 높이 약 절반), **저장된 지도를 카드 아래로 이동**해 남은 공간 전부 사용, 지도 여러 개일 때 **목록만 내부 스크롤** (index.html, style.css)
- 생성: **인트로 스플래시** — "끊임없이 걷다, 오롯이 몰입하다" 페이드인 → 하이-하잇(HI-Hike) → 페이드아웃 후 탐험 진입. 라이트/다크 대응, 지도 초기 로딩 가림 겸용 (index.html, style.css, app.js)
- 수정: 로그인 후에도 이메일/비밀번호 입력폼·로그인/가입 버튼이 남아있던 버그 — `.auth-out/.auth-in` 의 `display:flex` 가 `hidden` 을 덮어쓰는 문제, `[hidden]{display:none}` 가드 추가 + 동일 유형 전수 점검 (style.css)
- 검증: 폰 테스트 — 지도 다운로드→오프라인 등반 플로우·계정 게이트·인증 폼 정상 동작 확인

### 비고
- 이 항목은 초기 구축 백필(세션 전체 요약). 이후는 날짜별로 그날 변경분만 기록.
