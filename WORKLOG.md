# 작업일지 (WORKLOG)

사용자가 **"작업일지 작성"** 이라고 요청하면, 해당 날짜(`## YYYY-MM-DD`) 아래에 그날 **작성·수정한 내용**을 기록한다. 최신 날짜가 위로 온다.

---

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

### 비고
- 이 항목은 초기 구축 백필(세션 전체 요약). 이후는 날짜별로 그날 변경분만 기록.
