# 작업일지 (WORKLOG)

사용자가 **"작업일지 작성"** 이라고 요청하면, 해당 날짜(`## YYYY-MM-DD`) 아래에 그날 **작성·수정한 내용**을 기록한다. 최신 날짜가 위로 온다.

---

## 2026-07-20

맥 프록시 의존 완전 제거 — 타일·팩·날씨·글리프를 클라우드 직결/앱 번들로 이전(전부 HTTPS). 실기기 검증. iOS README 재작성.
이어 **지도 다운로드(오프라인 팩) 기능 신규 구현** — 다운로드→폰 로컬 설치→비행기 모드 렌더(S2 정석). 실기기 검증.
이어 **오프라인 팩 다듬기(삭제·저장된 지도 목록·온오프 하이브리드) + 탐험 바텀시트 개선 + 기록 탭 프로필 수정** 추가. 실기기 검증.

### 생성 / 추가 (다듬기·프로필)
- **네트워크 모니터(`NetworkMonitor.swift` 신규)**: `NWPathMonitor` → `isOnline`. 오프라인 팩 하이브리드 — 온라인이면 원격 전국 base(자유 팬), 오프라인이면 다운로드된 로컬 팩 base 로 렌더 전환(`ExploreView` offlineBaseURL 게이팅). 오버레이 geojson 은 설치 시 항상 로컬.
- **등반 탭 "저장된 지도" 목록(`DeungView.savedMaps`)**: 다운로드된 팩(`PackStore.downloaded` × 카탈로그) 목록. 탭→해당 산 선택 후 탐험 탭(`ContentView.onOpenMap`), 휴지통→삭제. 웹 renderSavedMaps 대응.
- **프로필 수정(`ProfileEditView.swift` 신규)**: 닉네임(Supabase `profiles`) + 아바타 이미지(PhotosPicker). 이미지 없으면 기본(person.circle). "기본 이미지로"·저장·로그아웃. 아바타는 **기기 로컬**(`avatar-<uid>.jpg`), 닉네임은 서버 동기화.

### 수정 / 변경 (다듬기·프로필)
- **`AuthStore.swift`**: `nickname`(profiles 조회/upsert)·`avatar`(로컬 파일) 상태 + `loadProfile`/`saveProfile`(닉네임 upsert + 아바타 로컬 저장/삭제) + `removeSavedPack`(saved_packs 삭제). 로그인/refresh 시 `loadProfile`, 로그아웃 시 초기화. `import UIKit`.
- **`RecordsView.swift`**: 계정 바를 이메일 단독 → **아바타 + 닉네임 + 이메일 + 수정** 으로. 탭→프로필 수정 시트(로그아웃도 시트로 이동).
- **`ExploreView.swift` 바텀시트 개선**: ① 경계 밖 **점진적 러버밴딩**(로그 감쇠)로 하드 클램프 제거, ② 스냅 스프링 → `interactiveSpring`(부드럽게), ③ ScrollView 가 드래그를 먹던 문제 → **`simultaneousGesture`** + 손잡이 히트영역 전폭 밴드로 확대(본문 어디서나 드래그, large 에선 상단 손잡이만 시트 이동·본문 스크롤), ④ **손잡이 탭 토글**(접힘↔완전 펼침 large), ⑤ peek 초기 상태 **상단 잘림 수정**(코스 자동 스크롤은 large 에서만·접으면 맨 위로 리셋), ⑥ **긴 코스명 레이아웃** — 난이도 배지를 코스명 옆 → **고도 스파이크 위(우측 열)** 로 이동해 이름이 좌측 전체 사용.

### 생성 / 추가 (오프라인 팩)
- **다운로드·로컬 설치(`PackStore.swift` 신규)**: 껍데기였던 "지도 다운" 버튼(동작 없는 Text)을 실제 기능으로. 산별 `packs/<코드>/{base.pmtiles + routes/spots/contours.geojson}` 를 `Application Support/packs/<코드>/` 에 설치(웹 IndexedDB → 네이티브 파일시스템, 웹 주석의 예고대로). base.pmtiles 는 `URLSessionDownloadTask` 델리게이트로 바이트 진행률(0→0.9), geojson 은 나머지(routes 필수). `@MainActor` 클래스 + `nonisolated` 델리게이트 → `Task { @MainActor }` hop. 경로조회(root/packDir/localFile/isDownloaded)는 `nonisolated`(MapView 가 소스로 사용).
- **오프라인 렌더(`MapView.swift`)**: 팩 설치된 산은 지도가 로컬 소스 사용 — 오버레이 geojson 은 `MLNShapeSource.url` 을 로컬 file URL 로 교체, base 벡터타일은 `MLNVectorTileSource.configurationURL` 불변이라 **오프라인 스타일 재로딩**(번들 스타일의 `sources.protomaps.url` → `pmtiles://<로컬 base.pmtiles>` 치환, `offline-<resource>-<코드>.json` 캐시). **로컬 `pmtiles://file:///…` 형식이 MapLibre Native 6.27 에서 동작함을 실기기로 확정.** 비행기 모드에서 기저지도+등산로+등고선 렌더(네트워크 0).

### 수정 / 변경 (오프라인 팩)
- **`Config.swift`**: 팩 파일 URL 헬퍼 정리 — 범용 `packURL(code,file)` + `baseTilesURL`(base.pmtiles) 추가, contours/routes/spots 를 그 위로 재정의.
- **`AuthStore.swift`**: `saveDownloadedPack(mountainId:)` — `saved_packs(user_id,mountain_id,pack_version)` upsert(로그인 시만; 로컬 설치는 계정 무관).
- **`ExploreView.swift`**: "지도 다운" 버튼을 상태별 렌더(`downloadButton`: 미다운→다운로드 / 진행 중→퍼센트+진행바 / 완료→다운됨 ✓) + `MapView` 에 `offlineBaseURL`(설치된 산의 로컬 base) 전달. `@StateObject PackStore.shared`.

### 맥 의존 제거 (앞 항목)

### 생성 / 추가
- **지도 글리프 앱 번들 포함(오프라인)**: `fonts/MonaS12 {Regular,Bold}/` pbf 를 `ios/HiHeight/Resources/glyphs/` 로 복사해 번들. `gen-style.mjs` 가 `../fonts/` → `Resources/glyphs/` 복사(cpSync), `project.yml` 이 `type: folder`(폴더참조)로 `<fontstack>/<range>.pbf` 구조 보존해 번들(일반 그룹이면 루트 평탄화로 range 파일명 충돌). `ios/.gitignore` 에 `Resources/glyphs/` 추가(소스는 `fonts/` 에 있어 44MB 중복 방지·재생성물). 스타일은 상대경로 `glyphs/{fontstack}/{range}.pbf` → MapLibre Native 가 스타일 URL 기준으로 번들 해석. **S1 미검증 항목(번들 글리프 로딩)을 실기기로 해소.**

### 수정 / 변경
- **접속 상수 클라우드 직결(`Config.swift`)**: `proxyBase`(날씨) 맥 `.local`/localhost:8890 → **`https://hihi.ksthink.com`(Vercel `/api/weather`, HTTPS:443)**. `r2Public`(타일·팩·config) dev `pub-*.r2.dev`(레이트리밋·UA403) → **`https://hihi.metaphr.dev`(Cloudflare R2 커스텀 도메인 직결, §8-1)**. `#if targetEnvironment(simulator)` 분기 제거.
- **스타일 생성기(`gen-style.mjs`)**: 기본 `HIHEIGHT_BASE` → `https://hihi.metaphr.dev`. pmtiles 경로 프록시식 `/pmtiles/kr-base.pmtiles` → **R2 루트 `/kr-base.pmtiles`**(버킷 루트에 객체 존재). 팩 소스 `/data/packs/` → `/packs/`. 글리프 URL(프록시 절대경로) → **번들 상대경로**.
- **ATS 정합(`project.yml`)**: 모든 트래픽 HTTPS 가 되어 `NSAllowsArbitraryLoads` **제거**, `NSAllowsLocalNetworking` 만 유지(App Store 정합). 글리프 폴더참조 source 추가(+ 메인 source `excludes` 로 이중 포함 방지).
- **iOS README(`ios/README.md`) 재작성**: "S1 스파이크(버릴 앱)" → 현재 아키텍처("맥 의존 없음, 전부 HTTPS/번들") 문서로 갱신. 자원별 출처 표(R2/Vercel/번들/Supabase)·빌드/실기기 실행 명령·구조·App Store 남은 과제.
- **원인 규명 2건(맥 의존 제거 중)**: ① `hihi.metaphr.dev` 가 R2 Active 인데도 계속 Vercel(`DEPLOYMENT_NOT_FOUND`)로 가던 원인 = **Vercel 프로젝트에 남은 `*.metaphr.dev` 와일드카드 도메인**(TLS 인증서 `*.metaphr.dev` 로 확정). 제거 후 R2 직결(server: cloudflare, 루트 pmtiles 206). ② 날씨를 EC2 admin_server(`13.209.31.163:8890`)로 했더니 맥은 되고 실기기는 실패 = **비표준 포트 8890 모바일망 차단** → Vercel 443 로 전환.
- 검증: 실기기(iPhone 12 mini) 빌드·설치·실행 — **날씨·타일·라벨 전부 정상**, 맥 서버 무관하게 동작.

## 2026-07-19

현재 위치 버튼에 나침반(헤딩) 추적 통합 — 네이티브.

### 수정 / 변경
- **위치 버튼 = 정북 추적 ⇄ 나침반 추적 순환**: 기존엔 버튼을 누르면 항상 현위치 중심 + 정북(direction=0)·수평 복원만 했으나(주석만 "나침반 통합"), 실제 나침반 회전을 구현. 누를 때마다 `MLNUserTrackingMode` 를 순환 — 1번=`.follow`(현위치 중심·North Up·수평 복원), 2번=`.followWithHeading`(기기 나침반 방향으로 지도 회전·위치 아이콘 빔으로 자동 전환), 3번=다시 `.follow`(정북 복원). MapLibre 내장 모드라 별도 `CLLocationManager` 헤딩 구독·추가 권한 불필요(기존 `NSLocationWhenInUseUsageDescription`). 등반 중(`tracking`)엔 현위치 추적 유지하되 사용자가 고른 나침반 모드는 존중(`.none` 으로 떨어지면 다음 GPS 갱신에 정북 복귀). `MapView.swift`(`applyUserState` 재작성·`wasTracking` 추가)
- 검증: 시뮬레이터 + 실기기(iPhone 12 mini) 빌드 성공·설치·실행. 나침반 회전은 자기 센서 기반이라 실기기에서만 실제 동작(시뮬레이터는 헤딩 고정).

## 2026-07-15

탐험/등반 날씨 미표시 원인 규명·수정 + 지도 코스 선택 UX 웹 동등화(선택 강조·탭 선택·번호 배지) + 등반 탭 제목/카드 정리 — 네이티브.

### 생성 / 추가
- **지도 코스 선택 강조·상호작용(웹 applyTrailFilter/focusTrail 이식)**: 선택 코스=검정(`trail-hl` 런타임 필터), 미선택=회색(`trail-line` faded 런타임 색), 선택 배지 반전(`badge-N`↔`badge-N-sel`). 지도에서 등산로/배지 **탭 → 코스 선택**(`UITapGestureRecognizer`+`visibleFeatures`, 얇은 선 탭용 `trail-hit` 넓은 투명선). `MapView.swift`(`applyTrailSelection`·`handleTap`·`onCourseTapped`), `gen-style.mjs`(`trail-hl`·`trail-hit`), `ExploreView.selectCourse`(목록·지도 탭 공통 헬퍼)
- **번호 배지 코스당 1개·직립**: `symbol-placement:line-center`(코스 갈래마다 중복·라인 방향 회전) → **코스 중점 포인트 소스**(`course-nos`)로 전환. 코스 midpoint(가장 긴 하위선의 반거리 지점, 웹 lineMidpoint)를 `Course.mid`로 계산하고 `MapView.setCourseNos`가 런타임 주입. `Course.swift`·`gen-style.mjs`
- **바텀시트 목록 자동 스크롤**: 지도에서 코스 선택 시 시트를 올려(medium) 선택 코스로 스크롤(`ScrollViewReader`+`onChange(climb.course?.id)`). `ExploreView.swift`

### 수정 / 변경
- **날씨 미표시 — 근본원인=맥 LAN IP 변경**: 맥 WiFi IP 가 `192.168.0.143`→`172.28.59.10` 으로 바뀌었는데 `Config.proxyBase` 가 옛 IP 하드코딩이라 날씨 프록시(URLSession) 요청만 낡은 주소로 멈춤(코스·등고선은 R2 클라우드라 무관 → "이것만 되고 저것만 안 됨"의 정체). **시뮬레이터=`localhost`(IP 변경 무관)/실기기=현재 LAN IP** 로 `#if targetEnvironment(simulator)` 분기. 진단 중 `-999 cancelled`/hang 로그로 좁힘. (`Config.swift` 는 머신별 IP라 커밋 제외)
- **등반 탭 제목·카드**: 상단 제목에서 산이름 배지 제거(제목 "등반"만), 코스 카드 상단을 코스명 → **"산이름 | 코스명"**(산이름 볼드). `DeungView.swift`
- **빌드 함정(반복 확인)**: 시뮬레이터 증분 빌드가 리소스/코드 변경을 스테일하게 유지 → **앱 삭제(uninstall) 후 재설치**·필요 시 clean 빌드로 확실히 반영. 스타일 재생성은 sim=localhost / device=LAN IP 로 각각

## 2026-07-14

지형 전용 기저 모드·정보 카드 정리·UI 폰트 MonaS12 전환·일출/일몰 — 웹·네이티브 동시 반영.
이어 코스 시종점 보물지도 기호·탐험 검색 UX 우측 확장·지도 컨트롤 웹 아이콘 동등화·어트리뷰션 옆펼침·검색 중 하단 UI 숨김(키보드 밀림 해결) 반영.

### 생성 / 추가
- **지형 전용 기저 모드 + OSM 토글**: 저데이터·저배터리 취지로 OSM 벡터 채움·건물·도시POI·경계를 걷어내고 음영기복 + 최소 오리엔테이션(물길·얇은 도로·지명·사찰·편의시설)만 남긴 기저(11 레이어). 기본값 = 지형 전용, 토글로 OSM 전체(39 레이어) 복귀. 웹 `basemap-style.js`(`buildStyle` 5번째 인자 `baseMode`, 지형 레이어 필터 `TERRAIN_DROP`, 케이싱 없는 단선 도로색 `troad`)·`app.js`(`baseMode` 상태·`buildCurrentStyle` 헬퍼·`BaseControl` 토글 버튼·`applyBaseMode`). 네이티브 `gen-style.mjs`(테마×모드 4벌 `basemap-{theme}[-osm].json`)·`ExploreView.swift`(`@AppStorage("hiheight-basemode")`·`styleResource` 조립·지도 컨트롤 토글)
- **일출·일몰 표시**: 탐험 탭 산 소개 카드 헤더 우측에 `일출 HH:MM  일몰 HH:MM`(로컬 계산·오프라인·네트워크 불필요, Almanac for Computers 알고리즘, KST). 웹 `app.js` `sunTimes()` + `ios/HiHeight/SunTimes.swift`(신규, 동일 로직 포팅)
- **UI 폰트 MonaS12**: `fonts/MonaS12.ttf`·`MonaS12-Bold.ttf`(원본 2 weight) 도입. 웹은 한글+라틴 서브셋 woff2(`MonaS12-subset.woff2`·`MonaS12-Bold-subset.woff2`, 각 ~140KB), 네이티브는 서브셋 ttf(`Resources/fonts/MonaS12*.ttf`, 8.9MB→1.7MB·3.0MB→1.6MB). 웨이트 속성 매핑(semibold+ → Bold, 그 외 → Regular)
- **지도 폰트도 MonaS12**: fontnik(SDF)로 `fonts/MonaS12 Regular/`·`fonts/MonaS12 Bold/` 글리프 PBF 각 256파일(전 BMP, 한글 포함) 생성 — 웹은 라틴, 네이티브는 한글까지 이 PBF 로 렌더
- **지도 컨트롤 웹 아이콘(네이티브)**: 웹 컨트롤 아이콘 SVG(지형 △·OSM 접힌 지도·달·해)와 MapLibre geolocate ◎ 를 Chrome 헤드리스로 정확히 래스터 → `ios/HiHeight/Resources/ctrl-{terrain,osm,moon,sun,locate}.png`(template 틴트). SF Symbol 근사 대신 웹과 픽셀 동등

### 수정 / 변경
- **관리 주체 토글·산 설명 미표시**: 산 소개 카드에서 관리 알약(전화 토글)·산 설명(더 읽기) 렌더 제거(표시만 숨김, `mountain_info` 로딩은 유지 — 재노출 시 렌더만 복구). 웹 `app.js` `renderMountainInfo` 축소, 네이티브 `ExploreView.swift` infoSheet 헤더 정리(`telPill`·`descView`·표시 상태 제거, 미사용 `import UIKit` 정리)
- **UI 폰트 전면 교체(→MonaS12)**: 웹 `style.css`(`@font-face` MonaS12 2 weight + body `font-family`, `font-weight:300` 요청은 브라우저 폰트 매칭으로 400 폴백), 네이티브 `Font+Kakao.swift`(`.kakao` 매핑 YK Green Forest→MonaS12)·`project.yml`(`UIAppFonts`)
- **미사용 폰트 정리**: KakaoSmallSans(웹 woff2 3 + 네이티브 ttf 3)·YK Green Forest ttf 3·Mulmaru(잔여 사본 포함) 삭제. `README.md` UI 폰트 표기 MonaS12로 갱신
- **지도 라벨 MonaS12 전환 + Nanum 완전 제거**: 웹 `localIdeographFontFamily`·`text-font`·코스 배지 캔버스 폰트 → MonaS12(`app.js`), 지도 스타일 `text-font` → MonaS12(`basemap-style.js`·`gen-style.mjs`). 나눔고딕코딩 PBF 2폴더(512)·woff2·`style.css @font-face` 삭제. **주의**: `MonaS12.ttf`(Regular)의 COLR/CPAL 컬러 테이블이 MapLibre Native CoreText SDF 렌더를 크래시시켜(`EXC_BREAKPOINT`) 제거 후 서브셋 재생성. 폰트 라이선스 표기는 확인 필요(README ⚠️)
- **코스 시종점 마커 → 보물지도 기호**: 출발/도착 텍스트 라벨을 시작 ○(빈 링)·끝 굵은 X("X marks the spot")로. 웹 `app.js`·네이티브 `gen-style.mjs`(circle 링 + `text-font` MonaS12 Bold "X")·`MapView.swift`(시종점 label 제거). ※ 사용자 제공 `svg/o.svg`·`x.svg` 를 SDF 아이콘화하는 방안을 시도했으나 MapLibre Native 가 작은 링 구멍을 메꿔(커버리지 기반 재-SDF) 되돌림
- **탐험 검색 UX 우측 확장**: 버튼 아래 드롭다운 → 버튼 클릭 시 입력창이 우측으로 확장(알약형 바)되고 입력 시 결과 목록. 폼 컨트롤이라 `font-family:inherit` 안 먹던 검색 폰트를 MonaS12 로 명시. 웹 `index.html`·`style.css`·`app.js`(`#search.open` 클래스 토글), 네이티브 `ExploreView.swift`(`searchBar`/`searchResults`, `@FocusState`)
- **지도 컨트롤 아이콘 웹 동등화(네이티브)**: 지형 ⛰→△·현재위치 ➤→◎·테마 달/해를 웹 아이콘 이미지로 통일(크기 통일), 나침반 버튼 제외(웹 기준), 버튼 프레임 42→36. `ExploreView.swift`(`ctrlImageButton`, SF `ctrlButton` 제거)
- **어트리뷰션 ⓘ 커스텀(네이티브)**: MapLibre 팝업 대신 2배 크기 + 탭 시 좌측으로 펼쳐 표기(`Protomaps © OpenStreetMap · © Copernicus DEM`). `MapView.swift`(기본 ⓘ `showsAttributionButton=false`)·`ExploreView.swift`(`attributionControl`)
- **검색 중 하단 UI 숨김·키보드 밀림 해결(네이티브)**: 실기기 검색 시 소프트 키보드가 하단 네비바·범례·컨트롤을 위로 밀던 문제 — 검색 모드에서 이들 숨김(`ContentView` 네비바 `safeAreaInset` 비움·`ExploreView` 범례/컨트롤/ⓘ) + ZStack `ignoresSafeArea(.keyboard)`. 검색 상태를 `@Binding` 으로 상향. 검색 종료 시 복원
- **빌드 함정 기록**: `gen-style.mjs` 재생성 후 증분 빌드가 번들 리소스(`basemap-*.json`)를 재복사하지 않아 스타일 변경이 기기에 반영 안 되는 문제 확인 → 리소스 변경 시 **clean 빌드** 필요

## 2026-07-13

iOS 네이티브 앱(`ios/`) 이식 — S1 스파이크부터 4탭 기능·디자인 웹 동등까지. 개발환경 EC2→맥북 이전.

### 생성 / 추가
- **개발환경 이전 마무리**: `scripts/setup_admin.sh` — go-pmtiles darwin-arm64 자산명 수정(1.31.0, 하이픈). 맥북 로컬 `.venv`(rasterio/GDAL arm64 wheel) + `tools/pmtiles` + `admin_server`(8890) 구동, R2 CORS·mountain 원본 복사 검증
- **S1 스파이크 + M1 지도**: `ios/project.yml`(XcodeGen — MapLibre 6.27 + Supabase 2.51), `ios/gen-style.mjs`(웹 `buildStyle()` 재사용 → `basemap-{light,dark}.json`, 프록시 URL 절대화), `MapView.swift`(MLNMapView 브리지 — 카탈로그 주도 카메라·소스 URL 스왑), 등고선·등산로(난이도별 굵기)·스팟(coalesce 오버라이드)·시종점 오버레이. `CatalogStore`·`Mountain`·`Config`·`Course`·`Sparkline`
- **M2 UI 셸 4탭 + 탐험 바텀시트**: `ContentView.swift`(TabView 탐험·추천·등반·기록), `ExploreView.swift`(지도+검색+산소개 시트), `MountainInfo.swift`(소개·관리주체), `NPN.swift`(국가지점번호 — npn.js 직역), `Weather.swift`(기상청 단기예보 — weather.js 직역), `RecoView.swift`+`Curation.swift`(추천 PICK 캐러셀)
- **M3 계정·기록**: `AuthStore.swift`(supabase-swift — 로그인/가입/기록조회·삭제), `RecordsView.swift`(인증폼+합계+목록, List 스와이프 삭제), `ClimbRecord.swift`, `RecCalendar`(산행 달력 — 기록 있는 날 점), 기록 루트 보기(트랙 점선 `rec-track` + fitBounds)
- **등반 탭 + M5-S1/S2 트래킹**: `DeungView.swift`(선택 코스 카드 — 거리·시간·난이도 미터·고도), `ClimbStore.swift`(CoreLocation 전경 트래킹 — 라이브 트랙·HUD·경과/이동거리/GPS지점), 종료 시 `climb_records` 저장(elevStats 이동평균 누적상승/하강, track jsonb)
- **M2-S4b 공식 추천 아코디언**: `RecoView` — 100대 명산·BAC·KNPS 카테고리(`Mountain.lists`), 펼침 멤버 목록
- **지도 컨트롤(웹 오버레이 정합)**: 테마 토글(라이트/다크 — `@AppStorage`+`preferredColorScheme`), 현재위치 버튼(나침반 통합 — 탭 시 정북·수평 복원), 커스텀 단일 스케일바, 저작권 ⓘ(MapLibre 내장), 코스 번호 배지(런타임 `makeBadge` UIImage + `symbol-placement:line-center`)
- **KakaoSmallSans 폰트**: `Font+Kakao.swift` — 웹 woff2를 fonttools로 ttf 변환(`Resources/fonts`), `UIAppFonts` 등록, 전 UI `.system`→`.kakao`(3 weight 근접 매핑), 탭바 라벨 포함
- **코스 fitBounds**: `Course.bbox`(지오메트리 전체 경계), 등산로 카드 탭·추천 진입 시 지도를 코스 전체 범위로 프레이밍(`MapView.fitCourseTick`, 가시 영역 정밀 패딩)
- **탭 상단 고정 헤더**: `ScreenHeader.swift`(신규) — 웹 `.view-head` 재현(스크롤 무관 상단 고정 + 하단 헤어라인). 추천·등반·기록 탭 적용
- **인트로 스플래시**: `SplashView.swift`(신규) — 웹 `#splash` 이식(태그라인→브랜드 "하이-하잇/HI-Hike"→© metaphr 순차 페이드인, 2.8s 노출 후 페이드아웃). `ContentView` 전체화면 오버레이
- **등반 날씨 예보 스트립**: `WeatherStrip.swift`(신규) — 웹 `renderStrip` 칩(지금/N시·아이콘·기온·강수%), 등반 카드에 선택 산 기준 표시. 데이터는 admin_server `/api/weather` 프록시(웹 동일 계약), `Config.weatherURL`
- **YK Green Forest(유한) 폰트**: `Resources/fonts/YKGreenForest-{Light,Medium,Bold}.ttf`(신규) — 3 weight 실 face, `project.yml` `UIAppFonts` 등록

### 수정 / 변경
- **로그인 세션 버그 2건**: `AuthStore` — ① signIn/signUp 반환 세션 직접 사용(currentUser 재조회 타이밍 의존 제거) ② 세션 저장소 Keychain→`UserDefaultsLocalStorage`(서명 없는 시뮬레이터는 Keychain 쓰기 실패로 로그인 유실) + `refresh()` `currentUser`(동기)→`await auth.session`(콜드스타트 유지)
- **탐험 시트 웹 정합**: `ExploreView` — 산 설명 "더 읽기"(100자 컷 인라인), 날씨 "부근 오늘 날씨"+프레임 카드+"{시}시 기준" 캡션, 등산로 프레임 카드(좌측 강조선·난이도 바 미터·`fmtNum`), 헤더 관리 알약(전화 복사)·지역/명산 배지 제거, 상단 "산이름 | 코스명" 반투명 사각형 박스, 국가지점번호는 등반 중 GPS 위치로만 표시, 날씨 카드 소형화
- **고도 프로파일**: `Sparkline.swift` — 선만 그리던 것을 채움 영역(prof-area 10%)+선(prof-line)의 `ProfileView`로(웹 profileSVG 정합)
- **SwiftUI 버그 수정**: 산행 달력에서 빈칸·날짜 `ForEach` id 충돌로 1·2일 셀이 드롭되던 문제 → 단일 배열+인덱스 id
- **검증 기법**: 시뮬레이터 GPS 주입(`simctl location`)·위치 권한(`simctl privacy`)·임시 `@State`/`.task` 자동 구동 후 스크린샷 — 등반 트래킹·기록 저장·루트 표시·코스 프레이밍 검증. 검증용 더미 기록은 삭제 기능으로 정리

#### 웹 동등화 후속 (실기기 배포 기반)
- **하단 네비 커스텀·기기 적응**: `ContentView` — 네이티브 탭바(iOS26 글래스 플로팅) 숨기고 웹식 평평·불투명 하단 바 직접 구현(`UIDesignRequiresCompatibility` opt-out, 아이콘 위치 교정·패딩 조정). 바텀시트 peek·지도 오버레이를 전체 화면 높이 비율(≈32%)로 — 전 기기 동일 비율(`ExploreView`)
- **추천 탭 웹 정합**: `RecoView.swift` — 노출 매거진 PICK 캐러셀(82% 정사각·스냅·점 인디케이터·가운데 설명), 다크 아코디언(공식 추천 3종), "지난 매거진 보기" 아카이브
- **기록 탭 웹 UI 이식**: `RecordsView.swift` — 계정바·합계·달력·기록행을 elevated 카드(웹 `.auth-in`/`.rec-summary`/`.rec-cal`/`.rec-item`)로, 구분자 `|`·시간 `H:MM`·날짜 `yyyy.MM.dd`, 달력 today 테두리 링(채움원 아님)
- **등반 탭 웹 정합**: `DeungView.swift` — 코스 미선택도 카드 상시 표시(stat "–"+날씨 스트립+비활성 회색 버튼+안내), 헤더 산 배지(`.mtn-badge` 검정 배지), 난이도 점→3막대 미터, 거리 원본 표기(`%g`)
- **기록 삭제 안 되던 문제 수정**: `RecordsView`·`AuthStore` — 커스텀 드래그 스와이프가 ScrollView 세로 스크롤과 충돌해 실기기에서 안 열리던 것 → 네이티브 `List.swipeActions` 복귀, 달력 `LazyVGrid`→비지연 VStack/HStack Grid(List self-sizing 재귀 루프 회피), `deleteRecord` 낙관적 제거 + `.select()` 0행 감지 복원·안내
- **등반 HUD 하단 잘림 수정**: `ExploreView` — 지도가 세이프에어리어 무시(전체화면)라 트래킹 HUD "등반 종료" 버튼·위치 안내가 하단 네비 뒤로 잘리던 것 → `safeAreaInsets.bottom` 만큼 띄워 네비 위에 오게
- **등반 날씨칩 높이 균일화**: `WeatherStrip` — 강수확률(30%) 줄을 조건부 렌더해 강수 있는 칩만 커지던 것 → 빈칸으로 자리 항상 확보
- **UI 폰트 전면 교체**: `Font+Kakao.swift`·`project.yml` — KakaoSmallSans→Mulmaru(단일 웨이트)→최종 YK Green Forest(Light/Medium/Bold 실 face). `Font.kakao` 헬퍼 재지정으로 89개 호출부 전부 반영
- **등산로/코스 팩 R2 직결**: `Config.swift` — 등산로(routes/contours/spots)를 로컬 맥 프록시 `data/packs`에서 읽어 EC2 관리자 배포가 미반영되던 것 → 웹과 동일한 R2 `packs/<코드>/` 직결로 변경(관리자 배포 즉시 반영). PMTiles·날씨는 개발 단계라 프록시 유지
- **탐험 바텀시트 3단계 + 실시간 추종**: `ExploreView` — peek↔full 2단계(손 떼야 스냅)→peek·medium(~52%)·large(~88%) 3단계, 드래그 실시간 추종 + 경계 러버밴딩 + 놓을 때 예상 종점(속도 반영) 스냅

---

## 2026-07-12

### 생성 / 추가
- **지도 글리프 전 범위 자체 호스팅**: `fonts/Nanum Gothic Coding {Regular,Bold}/` — fontnik 으로 0–65535 전 256범위 × 2웨이트 pbf 생성(17.6MB). **역 이름 미표시의 실제 원인 수리**: 누락 범위(변형 선택자 등) 404 하나가 해당 타일의 모든 레이어 파싱을 죽여(buckets 0) 서울역 일대 라벨이 통째로 증발하던 버그 원천 차단
- **기저지도 POI 표시 시스템**: `basemap-style.js` — 도시 POI 텍스트 레이어 `poi-urban`(학교·관공서·병원·아파트단지·공원·마트·문화체육, kind 매핑) + 관리자 설정·타일 내장 중요도(`min_zoom`)의 이중 줌 게이트. 설정은 `admin_data/poi-display.json` + R2 `config/poi-display.json`(앱 부팅 fetch, localStorage 캐시), 관리자 "기저지도 POI 표시" 섹션에서 편집
- **표시 설정 v2(분류별 줌·기호·크기·볼드)**: 스팟·기저지도 POI 설정값을 `{zoom, icon, size, bold}` 객체로 확장(레거시 숫자 하위호환 정규화 — `basemap-style.js` `normPoiDisplay`·`app.js` `normSpotDisplay`·`scripts/admin_server.py` `_norm_display_cat`). 관리자 두 섹션 모두 4컨트롤 편집 + **편집 지도 라이브 미리보기**(저장 전 즉시 반영)
- **스팟별 표시 오버라이드**: 관리자 스팟 행마다 표시 줌·기호·크기·볼드 지정(`disp_zoom/disp_icon/disp_size/disp_bold`, 비우면 분류 설정 따름) — draft 저장(`admin/admin.js`) → 발행 `spots.geojson` properties(`scripts/draft_store.py`) → 앱 레이어 coalesce 소비(`app.js`)
- **큐레이션 시스템(추천 모음)**: 관리자 "큐레이션" 메뉴 — 목록·새 등록·산/코스 통합 검색 추가·수정·삭제, `admin_data/curations.json` + R2 `config/curations.json`. API `GET/PUT /api/config/curations`·`GET /api/course-search`·`POST /api/mountain-image`(산 커버 이미지 → R2 `images/mountains/`) (`scripts/admin_server.py`)
- **앱 추천 탭 "하이하잇 PICK" 캐러셀**: `app.js`·`style.css` — 첫 큐레이션을 정사각 이미지 캐러셀로(수동 스와이프 스냅 + 점 인디케이터, 100대 명산 위 배치). 슬라이드 4요소(전부 선택 입력, 비면 미표시): 좌상단 반투명 배지(부가설명) → 큰 제목 → 중앙 하단 가운데 정렬 설명 → 좌하단 © 로고. 배경 = 업로드한 산 사진(없으면 무채색 그래디언트 폴백). 2번째+ 큐레이션은 카드 리스트, 미배포 시 내장 RECO 폴백
- **공식 추천 카테고리 확장(BAC 명산100·국립공원공단 공식탐방로)**: 산별 분류 체계 — 관리자 산 편집에 체크박스 2개(`admin/index.html`·`admin.js`, `mountain.lists` 배열 — 100대 명산은 기존 `famous` 컬럼 유지), 배포 upsert 에 `lists` 포함(`scripts/publish_pack.py`, 컬럼 부재 시 기존 폴백), `supabase/migrations-002-lists.sql`(신규) + `schema.sql`. 앱 추천 탭은 공식 추천 아코디언 3종을 카테고리별 생성(`app.js` `OFFICIAL_LISTS`·`renderFamous`, 빈 분류는 "등록된 산 준비 중"). 마이그레이션 실행(SQL Editor) 후 계양산 v11 재발행으로 BAC 분류 앱 반영 확인
- **PICK 슬라이드 출처 요소**: 사진 저작자 표기용 `credit` — 관리자 항목 입력란 추가, 앱 우하단(로고와 같은 라인·10px 포맷, 길면 말줄임) 렌더 (`admin/admin.js`·`app.js`·`style.css`·`scripts/admin_server.py`)
- **매거진 아카이브**: 앱 추천 탭은 노출 매거진(`curations[0]`) 1세트만 캐러셀, 아래 "지난 매거진 보기" 목록(제목·대표산) — 누르면 그 매거진이 캐러셀로 전환(`app.js`). 관리자는 노출 큐레이션만 펼침("노출 중" 배지), 지난 큐레이션은 목록 행 → 클릭 시 편집 블록(수정·삭제·접기·**"노출로 지정"** 승격) (`admin/admin.js`·`admin.css`)
- **기록 스와이프 삭제**: 등산기록 행 왼쪽 스와이프(포인터 이벤트, 터치·마우스 공용, 세로는 스크롤 양보, 한 번에 한 행) → 삭제 버튼 노출 → confirm 후 Supabase `climb_records` 영구 삭제 + 목록·합계 갱신 (`app.js`·`style.css`). 임시 계정 E2E(로그인→스와이프→confirm→DB 삭제)로 검증
- **기록 탭 산행 달력**: 합계 카드 아래 월 달력 카드 — 기록 있는 날 점(●) 표시(로컬 날짜 기준 집계), 요일 헤더·오늘 링·‹ › 월 이동, 로그아웃 시 숨김 (`app.js` `renderRecCalendar`·`index.html`·`style.css`). 임시 계정으로 7월 2건·6월 1건 점 표시·월 이동 E2E 검증
- **등반 기록 루트·고도 저장/표시**: 트랙 점을 `[lng,lat,고도|null,unix초]` 로 확장(iOS CoreLocation 공용 포맷 — `supabase/schema.sql` 주석으로 계약화, 원본 고해상 트랙은 클라우드 미업로드·기기 로컬 GPX 원칙 명시). 저장 시 `elevStats`(이동평균 평활 → 누적 상승/하강·최고/최저) — 고도 샘플 충분하면 실측 `ascent_m`, `track.elev` 요약 포함. 기록 목록에 ↑상승고도·"루트 ›" 표기, 탭하면 탐험 지도에 점선 트랙 렌더(`rec-track` 소스/레이어, 산 전환 시 클리어) + 트랙 범위 fitBounds, 스와이프 직후 click 억제 (`app.js`·`style.css`). 단위(상승 계산·폴백) + 합성 트랙 E2E 검증
- **등반 중 라이브 루트**: `app.js` — GPS 갱신마다 지나온 실측 트랙을 본선색(라이트 검정/다크 흰색)으로 그리고, 선택 코스(지나갈 곳)는 등반 중 짙은 회색(라이트 #666/다크 #969696)으로 낮춰 진척 대비. `applyClimbRoute` 단일 경로로 시작·갱신·종료(클리어+색 복원)·테마 전환 재부착까지 처리. GPS 모킹 E2E(시작→이동 6점→다크 전환→종료) 전 상태 검증

### 수정 / 변경
- **스팟 앵커 점 가시화**: `app.js` `spots-dots` — 반지름 1.2~1.8px(사실상 비가시) → 2.4~3.8px + 헤일로 링 1.4, 라벨 오프셋 0.9 (라벨이 가리키는 실제 위치 특정)
- **추천 탭 다듬기**: `index.html`·`style.css` — 부제("대한민국 명산과 추천 코스") 제거, PICK 슬라이드 폰트 크기 조정(배지 10 · 제목 23 · 설명 13 · 로고 10px)
- **탭 본문 스크롤바 숨김**: `style.css` `.view-body` — 아코디언 펼침 시 데스크톱 클래식 스크롤바가 생기며 콘텐츠 폭이 순간 줄던 레이아웃 점프 해소(iOS 오버레이 스크롤 관례, 펼침 전후 폭 동일 실측)
- **기록 삭제 버튼 라운드 개선**: `style.css`·`app.js` — 삭제 버튼을 전 모서리 라운드로 카드 뒤까지 확장해 곡면 틈을 채움(맞물린 토글 형태), 닫힘 상태 버튼 숨김으로 모서리 1px 비침 방지(픽셀 실측 0)
- **기록 목록 산 이름 표기**: `app.js` — "산 이름 | 코스명" 형식(산 이름은 카탈로그에서, 미등록 산코드는 코스명만 폴백)
- **기록 실측 거리·시간 표시**: `app.js` — 저장 시 `distance_km` 를 항상 실측 이동거리로(실측 50m 미만이면 코스 계획 거리로 대체하던 로직 제거), 목록·총 거리 합계는 트랙 있는 기록이면 트랙에서 실거리 재계산(계획 거리로 저장된 구형 기록 교정). 계획거리 17.65km 오염 기록 → 실거리 1km 교정 E2E 검증
- **iOS 네이티브 원칙 점검**: CLAUDE.md 6개 원칙 대비 전수 스캔 — 이번 세션 작업은 이식성 개선 방향(글리프 자체 호스팅·데이터 주도·R2 직결) 확인, 이탈 1건 발견: **산림청·국립공원공단 출처 표기 누락**(정보 패널 footer 추가 필요 — 미조치), 큐레이션 업로드 사진 저작권은 운영 책임(credit 요소로 표기 수단 마련)
- **개발 서버 캐시 정책**: `scripts/serve.py` — 정적 파일 `Cache-Control: no-cache`(글리프만 1일). 헤더 부재 시 브라우저 휴리스틱 캐시가 구 `basemap-style.js` + 신 `app.js` 를 섞어 모듈 임포트 에러 → **인트로에서 앱이 멈추던 문제** 수리
- **부팅 레이스 2건 수정**: `app.js` — ① 조기 `styledata` 가 스팟 설정 로드 전에 오버레이 레이어를 만들어 설정이 기본값으로 굳던 잠복 버그(설정 확보 후 부착 게이트) ② `isStyleLoaded()` 는 타일 스트리밍 중 false 라 `once("load")` 콜백이 유실되는 함정 — load 발생 플래그로 대체
- **관리자 편집 지도 개편**: `admin/admin.js` — 스팟(정상·장소) 편집 레이어가 표시 설정·스팟별 오버라이드를 앱과 동일 규칙으로 미리보기, 기저지도 POI 설정 변경 시 스타일 재생성 + 편집 소스/레이어 자동 재부착(styledata 기반 — 전국 뷰에서 map load 미발화 대응, 이벤트 바인딩도 load 비의존화)
- **운영 이슈 수리(발행 서버 상주 코드)**: `scripts/*.py` 수정이 이미 떠 있는 admin_server(systemd `hiheight-admin`) 프로세스에 반영되지 않아 스팟 오버라이드가 빠진 팩(v4·v5)이 발행됨 — 서버 재시작 후 계양산 v6 재발행으로 해소. **scripts/ 수정 후엔 `systemctl restart hiheight-admin` + 재발행 필요**
- **추천 탭 정리**: `index.html`·`style.css` — 추천 코스(큐레이션)를 100대 명산 위로 배치, "추천 코스" 고정 헤더(h2) 제거(큐레이션 그룹 제목이 대체)
- **GPX 갭 채움 회랑 검사**: `scripts/gpx_match.py`(`GAP_FILL_CORRIDOR_M=80`) — 대체 그래프 경로의 모든 점이 원본 갭 궤적 80m 안일 때만 채택. 길이 비 밴드는 통과하지만 옆으로 크게 벗어난 다른 길로 바꿔치기되던 계양산 2차 사례 차단
- **GPX 맵매칭 갭 채움 상한(긴 미매칭 구간 원본 보호)**: `scripts/gpx_match.py`(`GAP_FILL_MAX_M=1000`) — 계양산 GPX 업로드가 램블러 원본과 다르게 저장되던 원인 규명: 산림청 구간망에 없는 서남쪽 순환 3.96km(둘레길·마을길)가 우연히 비슷한 길이(비 0.92)의 구간망 경로로 대체됨(길이 비만 보는 우회비로는 어떤 값에서도 못 거름 — 실측). 갭 채움을 1km 이하 짧은 GPS 드리프트 보정으로 한정, 그보다 긴 미매칭 구간은 GPX 원 좌표 유지
- **계양산 코스 재매칭 복원**: `admin_data/282600201/draft.json` — 새 로직으로 재매칭 재적용(14.97→15.36km). 원본→저장 코스 이탈: 중앙값 2m·최대 25m·100m 이상 이탈 0%(수정 전 25%) 검증
- **스냅·우회비 설정 UI 제거**: `admin/index.html`(스냅(m)·우회비 입력 행, [재매칭] 버튼), `admin/admin.js`(입력 참조·재매칭 핸들러) — 기본값으로만 사용해 왔고 실제 문제(계양산)는 값 조정으로 해결 불가였음. 서버 기본값(25m/1.6)으로 일원화, `/gpx?tau=&detour=` API 파라미터는 예외 상황 튜닝 경로로 유지

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
