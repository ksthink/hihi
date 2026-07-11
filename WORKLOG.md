# 작업일지 (WORKLOG)

사용자가 **"작업일지 작성"** 이라고 요청하면, 해당 날짜(`## YYYY-MM-DD`) 아래에 그날 **작성·수정한 내용**을 기록한다. 최신 날짜가 위로 온다.

---

## 2026-07-11

### 수정 / 변경
- **지도 로드 속도 개선(부팅 4.34s → 3.46s 로컬 실측)**: `app.js` — 카탈로그·스팟 표시 설정·첫 산 팩 fetch 를 지도 타일 로드와 **병렬**로 시작(기존엔 map load 후 직렬 대기로 부팅 꼬리 ~2초). `fetchPack` 프라미스 공유 헬퍼로 첫 산 프리페치와 `loadPark`/`ensureParkOverlays` 의 중복 요청 방지(모킹 E2E 로 파일당 1회 fetch 검증)
- **타일 프록시 로컬 서빙**: `scripts/serve.py` — `/pmtiles/kr-base·kr-terrain` 을 로컬 원본(`data/tiles/`)이 있으면 R2 왕복 없이 디스크에서 Range 서빙(요청당 ~50ms → ~1ms, 접미 범위·416·ETag/304 지원). 파일 없으면 기존 R2 프록시 폴백
- **Vercel 타일 함수 서울 고정**: `vercel.json` — `regions: ["icn1"]` (기본 미국 동부(iad1) 왕복 제거, 다음 배포부터 적용)
- **초안 동시 저장 레이스 수정**: `scripts/draft_store.py`(`save`) — 모든 저장이 같은 `draft.json.tmp` 경로를 공유해 자동저장·명시 저장이 겹치면(스레드 병렬 서버) rename ENOENT("저장 실패" 에러, 원미산 GPX 등록 중 발생)가 나던 것을 `mkstemp` 호출별 고유 tmp + 원자 교체로 수정. 병렬 PUT 8~20건 × 다회 스트레스로 전건 200·무결성 검증

## 2026-07-10

### 생성 / 추가
- **100대 명산 분류(API 연동)**: `scripts/fetch_top100.py`(신규) — 산림청 100대 명산 API(`top100FamtListBasiInfoService`, 키는 `.env` `PEAK_POI_KEY`) → `cache/top100.json`. API `mtnCd` 가 부정확(중복 3쌍)해 **이름 + 봉우리-경계상자 포함 검사**로 로컬 산코드 매칭(86/100, 오매칭 5건 교정, 14건은 산림청 등산로 원천이 없는 국립공원 산). `scripts/admin_server.py` 검색 결과에 100대 명산 표시·정상 위경도·해발 보강(기존 해발 있으면 유지)
- **정상 스팟 자동 시드**: `scripts/draft_store.py`(`_summit_spot`) — 산 등록 시 100대 명산 API 정상 좌표로 `정상` 스팟 1개 자동 생성(주봉). 기존 산림청 공시 봉우리 벌크 시드(관악산 '정상' 5개 등 노이즈) 폐기
- **관리자 스팟 편집기**: `admin/admin.js`·`index.html`·`admin.css` — `정상`·`장소` 스팟의 추가(지도 클릭 또는 **위도·경도 직접 입력**, 한국 범위 검증)·이름 변경·분류 변경·주봉(▲) 지정·드래그 이동·삭제(주봉 삭제 시 승계)
- **코스 업로드 다중 포맷 + 폴더**: `scripts/gpx_match.py`(`parse_track` — 확장자·매직바이트 판별: GPX / SHP(pyshp, .shp 단독·.zip 번들) / GeoJSON(표준 + 산림청 ESRI JSON `paths` + GeometryCollection), EPSG:5186 자동 감지 변환), `admin/admin.js`(`handleTrackFiles` — 복수 파일·폴더 선택: 단일=미리보기 검토, 다중=비공개로 자동 추가 + 파일별 성공/실패 리포트, `PMNTN_SPOT_*` 부속파일 제외), `scripts/requirements.txt`(pyshp 추가)
- **전국 지형 타일(음영기복)**: `scripts/build_terrain.py`(신규) — Copernicus GLO-30 DEM → terrain-RGB PMTiles z5–12(`data/tiles/kr-terrain.pmtiles`, 273MB, 7,342타일) 빌드, R2 업로드. `basemap-style.js` hillshade 레이어(라이트/다크), `scripts/serve.py`·`api/tiles.js` 프록시 허용 목록에 지형 파일 추가, `app.js`·`admin/admin.js` 지형 소스 연결
- **전국 DEM 프리페치**: SRTM 캐시 35타일(733MB) 선다운로드 — 산 등록 시 DEM 단계가 즉시 캐시 히트(사실상 무시간)
- **관리자 지도 등고선**: `scripts/admin_server.py`(`/contours` — 배포 팩 재사용, 없으면 `cache/contours/` 생성), `admin/admin.js`(`loadContours`)
- **행정구역 라벨 단계 노출**: `basemap-style.js`(places-labels — 이 타일셋의 한국 행정지명은 전부 `locality` kind 라 피처별 `min_zoom` 으로 시·도→시·군·구→읍·면·동 순 노출, 국가명 제외), `app.js`(`minZoom: 6` — z5.5 클램프에서 정수 줌 5 평가로 시·도 라벨이 전멸하던 문제 해결)

### 수정 / 변경
- **모바일에서 코스 선을 탭해도 선택 안 되던 문제**: `app.js`(trail-hit — 투명(불투명도 0.001) 넓은 히트 라인 레이어, 줌별 16→28px) — PC 커서로는 되고 손가락으로는 빗나가던 히트 영역 확대
- **레거시 봉우리 경로 제거**: `data/peaks.geojson` 삭제, `app.js` peak-symbols 레이어·로더 제거(백운대·대청봉 하드코딩 표시 제거) — 봉우리는 팩 스팟(`정상`)으로 일원화
- **코스 상태 명칭 초안 → 비공개/공개**: `admin/` — 비공개 코스는 번호 '–' 표시, 코스 번호는 공개만 순서대로 부여
- **북한산 삭제 + 레거시 재이식 경로 제거**: `scripts/admin_server.py` — 구 KNPS 이식 코스가 점 간격 104m(산림청 6.7m)로 조악했음(사용자가 GeoJSON 품질 이상으로 정확히 감지 — 실검증: SHP=JSON 바이트 동일, 문제는 원천). 다른 산 전수 점검, 레거시 import 분기 삭제로 재발 차단
- 지도에서 교회 라벨 제외: `basemap-style.js`(temple-names — 이름에 교회·성당·채플·예배·기도원·교당·모스크·회당·선교 포함 시 제외)
- **최대 축소 시 제주도가 하단 시트에 가려지던 문제**: `app.js` — `maxBounds` 남한 최적화([[121.5,28.3],[134.0,39.2]], 북부 접경 여유·북한 제외) + 카메라 하단 패딩 304px(`setPadding`, 등반 모드에서는 0으로 토글). 헤드리스 실측으로 제주 노출 검증
- **흑백 가독성 개편**: `basemap-style.js` — 명도 위계 재배치(물을 최암 채움으로, 도로 위계 3단, 등산로 진하게 #3f3f3f, 하천 굵게), 음영기복(hillshade) 도입
- **줌 전환 시 얼룩 폴리곤 수정 3종**(`46fae42`): OSM 숲 채움 완전 폐기, 국립공원(landuse-park, kind=park 포함) `minzoom:13` 한정, 고줌 hillshade 페이드(exaggeration z13→16→0 + 레이어 maxzoom 16)

### ⚠ 미해결 리포트 — 줌 전환 시 얼룩 폴리곤(축척 10km→5km 구간)
**증상**: 지도를 축척 10km→5km(줌 10→11) 구간으로 확대할 때 지형과 무관해 보이는 회색 폴리곤이 갑자기 나타나고, 이후 줌 단계마다 형태가 달라짐. `46fae42` 배포 후에도 사용자 화면에서 지속 보고됨.

**배포 상태(검증됨)**: 프로덕션 `hihi.metaphr.dev/basemap-style.js` 를 직접 조회해 수정 3종이 모두 반영돼 있음을 확인(landuse-park `minzoom:13`, hillshade `maxzoom:16`+페이드, 숲 레이어 부재). 즉 "수정이 배포 안 됨" 가설은 소거.

**소거된 원인들**:
1. OSM 숲 채움(`88970a1` 에서 도입된 것이 최초 얼룩의 주범) — 완전 제거됨
2. 북한산 등 국립공원 폴리곤(kind=park, z10→11 에서 커버리지 8→27칸 급증 실측 — 증상 시점과 정확히 일치했던 후보) — z13 미만 렌더 금지됨
3. 도심 residential 채움(외부 AI 진단) — 본 앱은 urban 계열을 칠하지 않음(earth 단색), 실측으로 반증
4. 고줌 hillshade 오버줌 blob — 페이드 처리(단, 이는 z13+ 증상용이라 z10~11 증상과는 별개)

**로컬 실측**: 고양~북한산 z9.5~12 grid `queryRenderedFeatures` 스캔에서 남은 fill 히트는 `landuse-farm`(농지) 미량뿐.

**남은 원인 후보(우선순위)**:
1. **landuse-farm**(farmland·grass·orchard, `#ececec` vs 대지 `#f4f4f4`) — 김포·고양 평야 등에서 줌마다 타일 상세도가 달라져 폴리곤 형태가 변함. z10→11 에서 타일 데이터가 세밀해지는 시점과 증상 발생 시점이 일치. **다음 조치 1순위: 농지 채움 제거(또는 z13+ 한정)**
2. **hillshade 자체의 지각 문제** — z10~11 은 exaggeration 0.35 고정 구간인데, 줌이 오를 때마다 DEM 타일 해상도(z≤12)가 바뀌며 음영 덩어리 형태가 변함 → "폴리곤이 변한다"로 인지될 수 있음. 확인법: hillshade 만 끈 빌드와 비교
3. **클라이언트 캐시** — 모바일 브라우저가 구버전 `basemap-style.js` 를 캐시했을 가능성. 시크릿 창 또는 강력 새로고침으로 교차 확인 필요

**다음 진단에 필요한 정보**: 증상 화면 스크린샷 + 위치(지명/좌표) + 발생 축척. 해당 지점을 헤드리스 브라우저로 재현해 픽셀 단위로 레이어를 특정할 수 있음.

## 2026-07-09

### 생성 / 추가
- **코스 선택 시각 피드백(색 반전)**: `app.js`(`makeBadge(no, sel)` — 선택 배지 `badge-N-sel` 변형: 검정 원+흰 숫자, 다크만 흰 테두리; `applyTrailFilter`에서 선택 코스만 반전 아이콘으로 교체하는 icon-image 표현식 주입, `styleimagemissing` 정규식 `-sel` 확장), `style.css`(선택된 목록 항목 `.t-no` 색 반전: 흰 원+검정 숫자+링) — 지도 배지·목록 번호가 선택 상태를 함께 표시
- **관리자 사이드 패널 폭 조절**: `admin/`(#side-resize) — 편집 패널과 지도 경계를 드래그해 폭(상하 모드는 높이) 조절, localStorage 기억(상하/좌우 배치 공통)
- **코스 자동 번호 + 드래그 정렬**: `admin/admin.js`(`renumberCourses` — 번호=목록 순서, 위에서부터 1; GPX 수락·삭제·드래그 정렬·초안 열 때마다 재부여, 레거시 초안 번호 구멍도 정규화), 코스 항목 그립(⠿) 드래그로 순서 변경 → DOM 순서를 draft 에 반영 후 번호 재부여·자동저장(그립을 잡을 때만 draggable — 코스명 입력과 충돌 없음, Firefox `setData` 대응), `admin/admin.css`(.c-grip·li.dragging 스타일)

### 수정 / 변경
- 선택된 코스 목록 아웃라인 두껍게: `style.css`(`.trail-item.selected` — box-shadow 겹침 2.5px, 레이아웃 안 밈)
- **수작업 코스 입력(클릭 컴포저) 제거**: `admin/index.html`([＋ 코스 등록] 버튼·컴포즈 박스 UI), `admin/admin.js`(S.compose/S.networkFC 상태, 40m 스냅 스티칭 `stitchPicked`·`havM`, `renderCompose`/`startCompose`/`exitCompose`/`composeClick`, 컴포즈 전용 레이어 6종(network-hover/network-hit/compose-line/compose-ends-dots·labels)·소스 2개, 각 핸들러의 컴포즈 가드), `admin/admin.css`(#compose-box 블록) — 회색 구간망 표시(network-line)·`/network` 엔드포인트는 GPX 매칭 검토 배경으로 유지, 코스 입력 수단은 GPX 업로드로 일원화
- `scripts/admin_server.py` — DEM 준비 잡 안내 문구를 [코스 등록] → GPX 업로드 기준으로 갱신
- `admin_data/412900401/draft.json` — 청계산 초안 코스 번호(no 1~5) 순서 기준 정규화(관리자 열람 시 자동저장 반영분)

## 2026-07-08

### 생성 / 추가
- **수작업 코스 입력(클릭 컴포저)**: `admin/index.html`(#compose-box), `admin/admin.js`(`startCompose`/`composeClick`), `admin/admin.css` — [코스 등록] 버튼 → 회색 구간망을 시점→종점 순서로 클릭해 코스 구성. 끝점 40m 스냅 방향 자동 정렬(첫 구간 역방향 클릭도 보정), 비연결 구간은 새 파트+경고, 검정 미리보기+누적 거리, [마지막 취소]/[완성]/[버리기]. 완성 시 코스 번호 자동 부여 + recompute 로 거리·고도·난이도 자동 계산
- **코스 번호 체계**: draft 코스 `no` → `scripts/draft_store.py` `to_pack`(routes properties `no` 전달 + 번호순 정렬) → `app.js` 지도 번호 배지(`makeBadge` 캔버스 아이콘 — 흰 원+검정 숫자, 라이트=검정 테두리, 글리프 실측으로 원 정중앙, `styleimagemissing` 즉석 생성으로 테마 자동 대응) + 코스 목록 번호 배지(`style.css` .t-no) + **배지 클릭 = 코스 선택**(목록 하이라이트·스크롤 연동). 번호 없는 레거시 팩은 피처 순서 폴백
- **시점·종점 마커**: `app.js`(course-ends 소스/레이어) — 코스 선택 시에만 출발(채움 원)·도착(링) 표시
- **팩 주도 봉우리**: `app.js`(spot-peaks 레이어 — 팩 spots 의 `정상` 분류를 ▲/△ 봉우리로 렌더), `scripts/draft_store.py`(스팟 `main` 위계 전달) — 관리자에서 정상 스팟만 찍으면 앱에 봉우리 표시. 지리산 천왕봉 정상 스팟 R2 배포
- **앱에서 삭제(전파 삭제)**: `scripts/r2_lib.py`(`delete_prefix`), `scripts/publish_pack.py`(`unpublish`), `scripts/admin_server.py`(DELETE = Supabase 카탈로그 행 + R2 팩 파일 + 로컬 초안), `admin/`(prod-del 버튼·결과 알림) — 기존 "초안 제거(로컬만)"가 앱에 반영 안 되던 문제 해결
- **관리자 2단 레이아웃**: `admin/` — 상단(검색 + 지역 필터 + 관리 산 목록)/하단(편집 패널) 분할·각각 독립 스크롤, 구분선 드래그 크기 조절, 편집 패널 드래그로 좌우↔상하 배치 전환(드롭 미리보기·⧉ 토글·localStorage 기억)
- **지역 필터(6권역)**: `admin/admin.js` — 전체·수도권·강원·충청·전라·경상·제주 버튼(개수 표시), 광역시는 소속 권역에 흡수(부산·울산·대구→경상, 광주→전라, 대전·세종→충청, 인천→수도권), 전체 보기 시 권역 소제목 그룹핑
- **산 이름 편집**: `admin/`(#m-name) — 등록 후에도 이름 수정 가능(빈 이름 방지, 제목·목록 즉시 반영, 배포 시 카탈로그 upsert)

### 수정 / 변경
- `scripts/publish_pack.py` — pmtiles extract 소스를 삭제된 `demo-bucket.protomaps.com` → **로컬 마스터 `data/tiles/kr-base.pmtiles`**(수십 ms, 네트워크·UA 차단 무관)로 교체, maxzoom 14 정합, 실패 메시지에 stdout 포함(go-pmtiles 는 stdout 에 로깅). 지리산(488605302) 첫 배포 성공
- `scripts/admin_server.py` — 산 등록 시 **자동 코스 시드(forest_auto) 폐기** → DEM 프리페치만. (지리산 116km 괴물 코스 원인 규명: 파편화 구간망에서 최대 연결요소만 사용 + 가짜 정상으로 Dijkstra 스티칭 — 천왕봉 조각은 통째로 버려짐)
- `scripts/gpx_match.py` — `compute_stats` 거리를 파트별 합산(수작업 코스의 비연결 갭을 직선으로 가산하지 않음)
- 지리산 데이터 정리 — forest_auto 코스 8개 삭제(초안 리셋), 천왕봉 정상 스팟 재삽입, 고아 배포본 지리산(482202301, 통영 사량도) 카탈로그·R2 완전 삭제
- `README.md` — 관리자 사용 순서를 수작업 컴포저 기준으로 재작성(등록=회색 구간망만 → 코스 등록 클릭 입력 → 큐레이션 → 배포), "앱에서 삭제" 안내, 탐험 기능에 코스 번호 배지·시종점 마커 반영

### 추가 (같은 날 후속)
- **컴포저 개선 3종**: `admin/admin.js`·`index.html` — ① 시점·종점 수동 변경([시점↔종점 뒤집기] 버튼 + 컴포즈 중 시점(검정)·종점(흰) 마커 실시간 표시, 코스 도구에도 [시점↔종점] 추가 — 방향 뒤집고 통계 재계산) ② 담긴 구간 재클릭=해제(내부를 `stitchPicked` 클릭목록 재구성 방식으로 교체 — 중간 구간 해제에도 안전) ③ 호버 아웃라인(`network-hover` — 회색 구간에 마우스 올리면 검정 아웃라인으로 선택 대상 미리보기)
- **스팟 표시 정책 변경**: `app.js` — 분기점·시종점 지도 표시 제외(`SHOWN=[]`), 편의시설 5종 아이콘 신설(조망점=부챗살·화장실=WC·정자=지붕+기둥·헬기장=원H·음수대=물방울 — `makePoiIcon` 캔버스 확장, 흑백·테마 자동). 정상(▲) 제외 스팟은 **축척 30m 수준(z18)부터** 노출. 실제 헤드리스 브라우저(Playwright)로 5/5 아이콘 생성·렌더 검증
- **빈 배포 허용**: `scripts/publish_pack.py`(ready 0개 가드 제거 — 삭제한 코스를 앱에서 내리는 용도), `admin/admin.js`(빈 배포 확인창 문구), `app.js`(`fitPark` — 코스 0개 산은 카탈로그 중심/줌으로 이동 폴백). 안산 v2 빈 배포로 검증(R2 routes 0피처)
- `scripts/admin_server.py` — `log_message` 404 응답 시 TypeError(HTTPStatus 비문자열) 수정

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
