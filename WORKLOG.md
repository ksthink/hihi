# 작업일지 (WORKLOG)

사용자가 **"작업일지 작성"** 이라고 요청하면, 해당 날짜(`## YYYY-MM-DD`) 아래에 그날 **작성·수정한 내용**을 기록한다. 최신 날짜가 위로 온다.

---

## 2026-07-23

네이티브 앱의 **온·오프라인 경계 정리**와 **기저지도 POI 누락** 수정으로 시작해, 하루 대부분을 **관리자 콘솔 개편**에 썼다.
표시 설정 단위 통일 → 배포 버전 표시 → 화면 구조 개편(상단 탭 + 지도 오버레이) → **큐레이션 편집기를 앱 슬라이드 그대로** 순으로 이어졌다.

### 생성 / 추가
- **`PackPromptView.swift` 신규 — 지도 저장 권유 팝업**: 팩이 없는 산에서 등반을 시작하면 "등반 중 배터리 절약을 위해 지도 다운을 권장합니다"를 묻고 **저장 / 무시**(무시 = 온라인 모드). 처음엔 `confirmationDialog` 로 냈으나 시스템 대화상자라 앱 UI·폰트와 겉돌아 **앱 스타일 팝업으로 재작성**. 내려받는 동안 창을 닫지 않고 진행률을 그 자리에 보여준다.
- **기저지도 POI 아이콘 등록(`MapView.registerPOIIcons`)**: MapLibre Native 에는 웹의 `styleimagemissing` 훅이 없어 아이콘을 미리 만들어 넣어야 한다. SF Symbols 10종(전철역·버스정류장·주차장·화장실·대피소·약수터·전망대·헬기장·안내소·사찰)을 UIImage 로 렌더해 `style.setImage(_:forName:)` 등록. 외곽선은 8방향 오프셋 드로잉으로.
- **관리자 배포 버전 표시(`admin_server.py` `GET /api/version` + `#app-version`)**: EC2 에서 `git pull` 이 실제로 반영됐는지 화면에서 바로 확인. 요청 시점에 `git` 로 읽고 5초 캐시.
- **관리자 상단 탭 구조(`admin/index.html`)**: `#topbar`(산 편집 / 큐레이션) + `#editor-panel`(산 목록 / 등산로 / 스팟 서브탭) + 지도 위 `#mapcfg` 오버레이 + 전체 폭 `#curation-view`.
- **큐레이션 드래그 정렬(`admin.js` `makeSortable`·`attachGrip`)**: 코스 목록의 잡이 방식을 일반화해 **항목 카드끼리**(캐러셀 순서)와 **큐레이션끼리**(맨 위 = 앱 노출) 양쪽에 적용. 세로 목록은 위/아래로, 카드 그리드는 같은 줄이면 좌/우로 삽입 위치를 판정한다.

### 수정 / 변경
- **★ 큐레이션 편집기를 앱 슬라이드 그대로(`admin.js` `itemCard`·`admin.css`)**: 항목 하나가 `부가설명 (좌상단 반투명 배지)` 처럼 **위치를 설명하는 플레이스홀더 4행**이었다 — 운영자가 결과를 머릿속으로 조립해야 했고 사진은 「이미지 ✓」 글자로만 확인됐다. 앱 캐러셀과 같은 정사각 카드를 그리고 **각 글자를 앱에서 놓이는 그 자리에 투명 입력으로** 얹었다(`style.css` 의 `.ps-*` 와 대응). 배경이 곧 커버 사진이고, **카드에 사진 파일을 끌어 놓으면 업로드**된다. 제목·설명은 앱처럼 여러 줄로 감기도록 `textarea` + 자동 높이.
  - ⚠️ **숨겨진 탭에서는 `scrollHeight` 가 0** 이라 그때 잰 높이로 칸이 찌그러진다. `growField` 는 `offsetParent` 가 없으면 손대지 않고, 탭이 보이는 시점(`showTab`)과 재렌더 때 다시 잰다. 처음 검증에선 우연히 드러나지 않아, 브라우저 프로필 캐시를 지우고 재검증해 잡았다.
  - 지난 큐레이션 접힌 행에 **커버 썸네일** — 펼치지 않고 내용을 알아본다.
- **★ 관리자 지도에 POI 아이콘이 통째로 안 나왔다(`poi-icons.js` 신설)**: 기호를 켜도 아무 변화가 없었다. 앱은 외부 스프라이트 없이 `styleimagemissing` 때 캔버스로 아이콘을 즉석 생성하는데(`app.js`), **그 생성기가 app.js 안에만 있었다** — `admin.js` 에는 핸들러가 0개라 스타일이 `icon-image: "poi-station"` 을 요구해도 아무도 만들어 주지 않고 MapLibre 가 조용히 건너뛰었다. `makePoiIcon`·`POI_TEXT`·`attachPoiIcons` 를 **`poi-icons.js` 공용 모듈로 분리**해 웹앱과 관리자가 같은 것을 쓰게 했다(app.js 91줄 감소).
- **기호 고르개(`admin/symbols.js`·`scripts/gen_symbols.py` 신설)**: 기호 칸을 자유 입력에서 **버튼 → 형태별 탭 고르개**로 바꿨다. 쓸 수 있는 문자가 정해져 있는데 직접 타이핑하게 두면 안 그려지는 글자를 넣기 쉬웠다 — 고르개는 애초에 되는 것만 보여 준다. 끔·기본 아이콘·문자를 버튼 하나로 고른다(체크박스+입력칸 2개 → 버튼 1개).
  → **목록은 손으로 고르지 않았다.** `scripts/gen_symbols.py` 가 **글리프 PBF 를 직접 읽어** Regular·Bold 양쪽에 비트맵이 있는 것만 남긴다(18묶음 1696자). ⚠️ **폰트 cmap 을 믿으면 안 된다** — MonaS12 는 `♨ ⛰ ☎ ♻ ⚠ ✈ ☕ ♠♣♥♦ 〒` 처럼 cmap 에는 있는데 **글리프 속이 빈** 문자를 여럿 갖고 있고, 그런 걸 넣으면 지도에서 조용히 사라진다. 실제로 이 세션 초반에 `♨ ⛰` 를 예시로 안내했다가 발견해 고쳤다.
- **기호를 문자로 지정할 수 있게(`basemap-style.js`·`admin.js`·`admin_server.py`)**: `icon` 을 3상으로 넓혔다 — `false`=끔 / `true`=기본 아이콘 / **문자열=그 글자를 이름 앞에**. 스팟 정상의 `▲` 와 같은 방식이라 새 기법이 아니다. **아이콘이 아예 없던 도시 POI 7분류**(학교·관공서·병원·아파트단지·공원·마트쇼핑·문화체육)가 이걸로 처음 기호를 갖는다 — 그동안은 체크박스가 비활성이었다.
  → ⚠️ **BMP(U+0000–FFFF) 문자만 된다.** 자체 호스팅 글리프 PBF 가 256개 파일(U+FFFF)에서 끝나 **이모지는 웹·네이티브 모두 아무 경고 없이 사라진다**. 관리자 입력에서 막고 서버 검증(`_norm_display_cat`)에서 한 번 더 막는다 — 조용히 사라지는 실패가 이 프로젝트에서 가장 비싼 실패라서.
  → ⚠️ **네이티브에는 아직 안 간다.** `ios/gen-style.mjs` 가 `poiDisplay: null` 로 기본값을 빌드 시점에 굽고 있어(원래부터의 미착수 항목), 문자 기호는 웹·관리자에만 반영된다.
- **★ 관리자 지도에서 전철역·버스정류장·도시POI 미리보기가 아예 불가능했다(`admin.js`)**: 표시 설정에서 전철역을 "항상"으로 바꿔도 지도에 나타나지 않았다. 설정 전달·`setStyle` 재생성은 정상이었고, **`stations` 레이어 자체가 없었다** — `buildStyle()` 의 `baseMode` 기본값이 `"terrain"` 이고 지형 모드는 `TERRAIN_DROP` 으로 `stations`·`bus-stops`·`poi-urban`·`admin-labels` 를 걷어낸다. 앱은 `buildCurrentStyle()` 에서 `baseMode` 를 넘기는데 관리자만 인자를 빠뜨려 늘 지형 모드였다. **11개 분류 중 9개가 미리보기 불가**(편의시설·사찰만 보였다).
  → 관리자 지도는 POI 설정을 보는 화면이므로 `ADMIN_BASE_MODE = "city"` 로 고정(초기 스타일·`applyPoiEditorStyle` 양쪽). 레이어 23→36개, 전철역이 서울 z10부터 렌더됨을 실측.
  → ⚠️ **"항상"은 줌 제한을 푸는 것일 뿐 데이터를 만들지는 않는다** — 타일의 역 POI 가 z10부터라 그 아래에서는 여전히 비어 있다.
- **관리자 폰트를 앱 폰트(MonaS12)로 통일(`admin.css`)**: 본문·입력·버튼·셀렉트에 더해 **`.maplibregl-map` 이 Helvetica Neue 를 걸고 있어** 줌 버튼·저작권 표시가 시스템 글꼴로 남아 있었다. 자식에 `font-family: inherit` 만 주면 그 Helvetica 를 물려받으므로 **뿌리인 `.maplibregl-map` 부터** 되돌려야 한다(CDN 규칙이 더 구체적이라 `!important` 도 필요).
- **관리자 편집 지도의 낡은 폰트 참조(`admin.js` 글리프 스택)**: `fda8709`(폰트 MonaS12 통일) 이후에도 Nanum Gothic Coding 참조가 남아 `/fonts/NanumGothicCoding-Regular.woff2` 와 글리프가 404 → **편집 지도 라벨이 통째로 안 그려지고 있었다.** 증상이 "라벨이 원래 없는 것"처럼 보여 오래 방치돼 있었다.
- **표시 설정 단위 통일(`admin.js`·`app.js`·`basemap-style.js`·`admin_server.py`)**: 스팟과 기저 POI 의 줌 단위가 서로 달라 헷갈렸다 — `ZOOM_OPTS`(끔·항상·z10~z18, 축척 병기)로 통일하고 크기는 **8·10·12·14 네 단계**로 단순화. 값 변경 시 옆 지도에 즉시 반영되도록 연결.
  - ⚠️ 정규화 정규식이 너무 넓어 **등고선 minzoom·도로 라벨 줌·텍스트 크기·오류 문구까지 함께 바꿔 버렸다.** `git checkout` 으로 되돌리고 DEFAULT 블록에만 한정해 다시 적용.
- **탐험 = 온라인 우선 / 등반 = 저장된 지도 전용(`ExploreView.swift`·`MapView.swift`)**: 지도가 저장돼 있어도 탐험에서는 온라인을 먼저 쓰고, **등반 시작 이후에만** 로컬 팩만 쓴다. 등반 중에는 `.task` 안의 네트워크 요청도 막는다(`guard !climb.tracking`). `MapView.offline` → `useLocalPack` 으로 이름을 바꿔 "오프라인 상태"와 "로컬 팩 사용"을 구분.
- **전철역·주차장 등이 앱에만 안 나오던 문제**: 처음엔 팩 스팟 레이어(`spots-facilities`)를 추가했으나 **엉뚱한 곳을 고친 것**이었다 — 주차장·전철역은 팩 스팟이 아니라 **기저지도 POI** 다(북한산 팩 스팟은 정상·장소 2건뿐). 위의 아이콘 등록으로 바로잡음(build 191).
- **기록 탭 로그인 입력창 폰트(`RecordsView.swift`)**: 아이디·비밀번호의 플레이스홀더와 입력 글자에 앱 폰트·색·테두리 적용.

---

## 2026-07-22

**"선택한 코스가 아닌 1번 코스로 등반이 시작된다"** 를 추적해 원인 3건을 각각 수정(build 177~180). 실기기 검증 완료.
증상은 하나였지만 원인이 겹쳐 있어 네 번에 걸쳐 올렸고, **마지막(180)이 주범**이다.
이어 **★ 얼룩 폴리곤(2026-07-10 최초 보고, 12일 미해결) 원인 규명·수정**(build 185·186). 상세 경위는 **[ISSUE.md](ISSUE.md)** 신설.

### 생성 / 추가 (얼룩 폴리곤)
- **`ISSUE.md` 신규 — 장기 미해결 이슈 추적 기록**: 해결까지 오래 걸렸거나 여러 번 오진한 이슈를 서술형으로 남긴다. "무엇을 고쳤나"보다 **"왜 오래 걸렸나"** 에 무게를 둔다. 얼룩 폴리곤(12일·오진 6회)과 코스 선택(원인 3중첩) 두 건을 기록.
- **웹 레이어 숨기기 디버그 훅(`app.js`, `?hide=`)**: `?hide=landuse-park`(한 레이어) · `?hide=earth,water`(여러 개) · `?hide=*fill`(채움 전부). `styledata` 마다 재적용해 테마·베이스 전환 후에도 유지되고, 파라미터가 없으면 리스너를 달지 않아 평상시 동작에 영향 없음. **이 도구가 12일 교착의 전환점이었다** — 사용자가 실기기에서 `?hide=*fill` → 얼룩 사라짐, `?hide=water` → 얼룩 사라짐 두 줄을 확인해 주면서 즉시 특정됐다.

### 수정 / 변경 (얼룩 폴리곤)
- **★ 진짜 원인: `water` fill 이 하천 중심선까지 채우고 있었다(`basemap-style.js`)**. water 소스레이어에는 면뿐 아니라 **선(LineString)과 점이 섞여 있는데**(실측 z12~14: 면 32 · **선 52** · 점 4), water 레이어가 기하 타입을 가리지 않고 `fill` 로 그려 **열린 선을 삼각분할**하고 있었다. 그 선들만 골라 채움으로 렌더해 제보된 얼룩과 동일한 쐐기·삼각형을 재현.
  → `filter: ["match", ["geometry-type"], ["Polygon","MultiPolygon"], true, false]`. 하천 선은 `rivers` 레이어(physical_line)가 이미 담당하므로 잃는 표현 없음. 다른 채움 소스레이어(earth·landuse·landcover·buildings)는 전부 면만 있어 같은 위험 없음을 확인.
  → 모든 관찰이 설명된다: 축척마다 모양 변화(줌별 선 단순화)·완벽한 직선 가장자리(삼각분할)·웹과 네이티브 공통(같은 스타일·같은 tessellation)·하천 주변 집중.
- **음영기복 복구(07-20 이전 원본 값)**: 얼룩을 쫓다 껐던 것을 되돌리고, 오진 과정에서 넣은 두 차례 완화(176 대비 축소·182 하이라이트 정렬)도 함께 되돌렸다 — 둘 다 얼룩에 효과가 없었고 지형 입체감만 깎았다. `hillshade` paint 가 원본과 일치함을 diff 로 확인. `HILLSHADE` 상수는 남겨 둠(dem 소스+레이어를 한 줄로 게이트).
- **⚠️ 오진 6회의 근본 이유 — 검사 도구 자체의 사각지대**: 타일 데이터를 여러 각도로 검사해 전부 "정상"이 나왔다(과대 폴리곤 없음·꼭짓점 최대 934·좌표범위 정상·자기교차 0·구멍 위치 정상·레이어별 독립 렌더 정상). 그런데 직접 짠 MVT 파서에 `if gtype != 3: continue`(폴리곤만) 가 있었다. **채움을 조사하니 폴리곤만 보면 된다는 가정** 때문에 선을 처음부터 한 번도 보지 않았고, 그 위에 가설을 여섯 번 쌓았다. 검사가 계속 정상이라고 답하면 **검사 대상 자체를 의심할 것**.

### 수정 / 변경 (코스 선택)
- **★ 선택한 코스가 탭 전환마다 1번으로 초기화(`ExploreView.swift`, build 180 — 주범)**: `.task(id:)` 는 **id 가 바뀔 때만 도는 게 아니라 뷰가 사라졌다 다시 나타날 때마다 재실행된다**(`.task` 는 disappear 에서 취소되고 appear 에서 다시 시작). 코스 자동선택이 무조건 `?? courses.first` 로 덮어써서, 탐험에서 5번을 골라 [등반 시작]을 눌러도 `onStart` 가 `tab = 0` 으로 돌아오는 순간 1번(원효봉)으로 바뀌어 있었다. **탭을 오가기만 해도** 초기화되므로 큐레이션과 무관한 경로였다.
  → 우선순위를 **큐레이션 지정 > 이미 고른 코스 유지 > 복구된 세션 > 첫 코스** 로. 산이 바뀌면 이전 코스명이 새 목록에 없어 자연히 첫 코스로 떨어진다.
  → **등반 중에는 `climb.course` 를 아예 건드리지 않는다.** 세션 코스가 바뀌면 HUD 뿐 아니라 저장되는 기록의 코스명·계획고도까지 어긋난다(누적고도 부풀림과 같은 계열의 위험).
- **낡은 오프라인 팩 탓에 새 코스가 지도에 안 나옴(`MapView.applyOverlay`, build 179)**: 같은 코스 데이터를 두 곳에서 다르게 읽고 있었다 — 코스 목록·헤더·시종점 마커는 `PackLoader` 가 **원격 R2**, 지도의 코스 선·번호 배지는 `applyOverlay` 가 **로컬 팩**. R2 팩은 07-20 21:11 에 갱신됐지만 **팩 버전 관리가 없어 재다운로드를 유도할 계기가 없다** → 한번 받으면 이후 추가된 코스가 영원히 안 보인다(북한산 "아인쌤 야호~" 추가 후 실제로 발생). 기저 타일과 같은 하이브리드로 통일: `offline ? (로컬 ?? 원격) : (원격 ?? 로컬)`. `Coordinator.offline` 은 `offlineBaseURL != nil` 로 판단하며 `apply(mountain:)` 보다 먼저 반영.
  - ⚠️ **한계: 오프라인 상태에서는 여전히 낡은 팩을 본다.** 근본 해결인 팩 버전 추적(카탈로그 `pack_version` 비교 → 갱신 알림/자동 재다운로드)은 미착수. `Mountain` 모델이 `pack_version` 을 디코드하지 않고 `AuthStore` 는 `pack_version: 1` 하드코딩 상태.
- **추천 큐레이션이 지정한 코스가 선택되지 않음(build 177·178)**: 큐레이션 카드가 `onOpen(it.code)` 로 **산코드만** 넘기고 코스명을 버려, 산만 맞고 코스는 늘 1번이 잡혔다. `onOpen` 을 `(산코드, 코스명?)` 으로 바꾸고 `ClimbStore.wantedCourseName`(@Published) 에 담아 ExploreView 가 팩 로드 후 매칭. `applyWantedCourse` 는 **목록에서 못 찾으면 소비하지 않는다** — 산 전환 직후엔 아직 이전 산의 목록일 수 있어, 지워버리면 로드 완료 후 task 가 쓸 값을 잃는다.
  - ⚠️ 178 의 진단("산 id 가 안 바뀌어 task 가 안 돈다")은 **틀렸다**. id 와 무관하게 매번 재실행되고 있었고, 그 잘못된 전제 위에 179 까지 쌓았다. 177·178 자체는 유효한 수정이나 이 증상의 주원인은 아니었다.

### 교훈
- **`.task(id:)` 는 "id 가 바뀔 때만"이 아니다** — 뷰 재등장마다 재실행된다. 초기화 성격의 코드를 여기 두면 사용자의 선택을 매번 덮어쓴다. TabView 안에서는 특히 그렇다.
- **같은 데이터를 두 경로로 읽지 말 것** — 목록은 원격, 지도는 로컬이면 "목록엔 있는데 지도엔 없는" 유령 증상이 난다.
- **빌드 성공은 검증이 아니다.** 이번에 세 번 연속 "BUILD SUCCEEDED" 만 확인하고 실제 진입 경로를 따라가지 않아 같은 증상으로 네 번 올렸다.

---

## 2026-07-21

**얼룩 폴리곤 버그(2026-07-10 부터 미해결) 원인 규명 + 음영기복 대비 완화**(build 176).

### 수정 / 변경 (얼룩 폴리곤)
- **정체: 잘못 칠해진 폴리곤이 아니라 "칠해지지 않은 평지"였다(`basemap-style.js`)**. Copernicus DEM 은 수역을 상수 고도로 평탄화한다(서울 z12 타일 실측: 고도가 정확히 3.0m 인 픽셀 8.4%, 3.5m 3.5%, 사방이 모두 같은 값 10.6%). MapLibre 음영 셰이더는 음영 강도에 `sin(경사)` 를 곱하므로 **경사 0 인 면은 완전 투명 → 밑바탕색 그대로** 남는다. 그 결과 강 유역이 "질감 없는 매끈한 면 + 급경사 가장자리의 또렷한 윤곽선"이 되어 폴리곤처럼 읽혔다.
- **소거 근거(PMTiles 에서 MVT 직접 디코딩)**: ① `landcover` 소스레이어는 해당 지역 타일에 **아예 없음** → `landcover-grass` 는 무효 레이어 ② 우리가 칠하는 `landuse`(park·farmland·grass·orchard)는 전부 2% 미만이고, 정작 거대 폴리곤은 `wood` 27.8%·`cemetery` 14.7%·`forest` 9.7% 인데 **모두 미채색** ③ 사용자 확인 — 지형 모드로 바꿔도 유지(`dropTerrain` 이 hillshade 는 남긴다), 축척마다 모양 변화(DEM 해상도가 줌마다 달라짐). WORKLOG 2026-07-10 의 1순위 후보였던 `landuse-farm` 은 1.2% 로 반증.
- **조치는 얼룩 제거가 아니라 대비 완화**: 산지에 얹히는 하이라이트를 밑바탕 `earth` 색 쪽으로 낮춰 평지와의 낙차를 줄이고 저줌 강조도 함께 낮춤. 라이트 `#ffffff→#fbfbfb`·shadow `#6e6e6e→#8a8a8a`·강조 `0.35→0.24`, 다크 `#3d3d3d→#2b2b2b`·강조 `0.40→0.28`. **지형 입체감과의 맞교환**이라 값과 근거를 주석으로 남겼다(더 낮추면 띠는 옅어지고 능선 판독은 어려워진다).

### 기타
- 이날 GitHub·R2·Apple 로의 **HTTPS 가 전부 TLS 단계에서 끊기는 네트워크 장애**를 겪음(DNS·ICMP 는 정상). 맥 네트워크 문제로 확인돼 복구 후 재개.
- ⚠️ 업로드 결과를 `grep|tail` 로 파이프하면 **종료 코드가 tail 것으로 바뀌어 실패가 성공으로 보인다**. 실제로 한 번 오보했다 — 이런 확인에는 파이프를 쓰지 말 것.

---

## 2026-07-20

맥 프록시 의존 완전 제거 — 타일·팩·날씨·글리프를 클라우드 직결/앱 번들로 이전(전부 HTTPS). 실기기 검증. iOS README 재작성.
이어 **지도 다운로드(오프라인 팩) 기능 신규 구현** — 다운로드→폰 로컬 설치→비행기 모드 렌더(S2 정석). 실기기 검증.
이어 **오프라인 팩 다듬기(삭제·저장된 지도 목록·온오프 하이브리드) + 탐험 바텀시트 개선 + 기록 탭 프로필 수정** 추가. 실기기 검증.
이어 **등반 GPS 동기화·정확도 개선 + 로그인 세션 복원 + 지도 다운 로그인 필수** 수정. 실기기 검증.
이어 **등반 루트 점선/실선 구분 + 종료 오터치 방지 팝업 + 등반 중 네비바 숨김** 추가.
이어 **세션 복구·백그라운드 위치(S3) + 누적고도 버그 수정 + 커스텀 스와이프 삭제 + 프로필 사진 크롭 + 기록 필터·정렬 + 시트 2단계화**.
이어 **용어 사전(WORD.md) 신규**.
이어 **TestFlight 내부 배포 파이프라인 구축 — 앱 아이콘·업로드 스크립트 신규, 실제 업로드 성공(build 166)**.
이어 **글리프 용량 분석(미적용 결론) + 큐레이션 캐시 버그 수정 + 빌드 버전 반영 버그 수정 + 추천 당겨서 새로고침**. 실기기 검증(build 171).
이어 **시종점 O/X → 출발/도착 텍스트 복원 + 기록 트랙에도 시종점 마커 + README 새로 작성**(build 174·175).

### 수정 / 변경 (시종점 표기·문서)
- **코스 시종점을 "출발/도착" 텍스트로 되돌림(`39babea` revert — `app.js`·`ios/gen-style.mjs`·`MapView.swift`)**: 보물지도 기호(시작 ○ 빈 링·끝 굵은 X)를 이전 표기로 복귀. 점 마커도 출발=검정 채움/도착=흰 채움으로. **곁가지로 iOS 스타일에서 Bold 를 쓰는 레이어가 0 개가 됨**(`course-ends-x` 가 유일한 사용처였다) → `gen-style.mjs` 글리프 주석을 사실에 맞게 정정. 웹은 이 라벨에 Bold 를 쓰지만 한글은 `localIdeographFontFamily` 가 기기 폰트로 그려 글리프가 불필요하다.
- **기록 트랙에도 출발·도착 마커(`rec-ends`)**: 기록 탭에서 저장된 루트를 열면 트랙 선만 있고 시작/끝을 알 수 없었다. 선택 코스(`course-ends`)와 동일한 모양으로 추가하되 **소스는 분리** — 코스 선택과 기록 보기가 동시에 켜질 수 있어 한 소스를 공유하면 서로 덮어쓴다. 레이어 순서는 `rec-track-casing → rec-track → rec-ends-dots → rec-ends-labels`(마커가 선 위). 웹은 시종점 FC 생성을 `endsFC(startPt,endPt)` 로 뽑아 코스·기록이 공유(문구가 한 곳에만 있어 한쪽만 바뀌지 않는다), iOS 는 기존 `endsGeoJSON` 재사용.
- **`README.md` 새로 작성**: "웹앱 개발 중, iOS 는 계획" 시점에 멈춰 있어 `ios/` 가 문서에 아예 없었다. ⚠️ **라이브 데모 URL 이 404 였다** — `hihi.metaphr.dev` 는 R2 버킷이라 웹앱이 없고, 실제 주소는 Vercel 의 `hihi.ksthink.com`. iOS 를 1급 시민으로 반영(§2 진행 현황·§6 빌드/TestFlight 절차 신설, 아키텍처를 웹·iOS 병렬로), 폐기된 계획서 경로 제거 후 IOS.md 로 일원화. 이번 세션에 겪은 함정(R2 `Cache-Control` 필수·Explicit App ID·`$(MARKETING_VERSION)` 참조·빌드번호 중복·글리프 폴더참조·admin 서버 재시작·iOS 는 수동 배포)을 문서에 못박음.

### 수정 / 변경 (큐레이션 캐시 버그)
- **admin 에서 큐레이션을 바꿔도 앱 추천 탭에 몇 시간 반영되지 않던 버그 수정(`scripts/r2_lib.py`·`ios/HiHeight/Curation.swift`)**: 원인은 **R2 가 `Cache-Control` 을 아예 보내지 않는 것**. 명시적 만료가 없으면 클라이언트가 **휴리스틱 캐싱**((now − Last-Modified) × 10%)을 적용하는데, 파일이 7일 전 수정 상태여서 **약 17시간 동안 서버에 재검증조차 하지 않았다**. `URLCache` 는 디스크에 있어 **앱을 강제 종료해도 살아남는다**(그래서 "앱 껐다 켜도 그대로"). 웹은 `fetch(url, {cache:"no-cache"})` 로 피해 갔으나 네이티브는 기본 정책이라 직격.
  - **서버**: `r2_lib.cache_control_for(key)` 신설 — `*.json`·`*.geojson` → `no-cache`(쓰기 전 재검증, 안 바뀌었으면 304 라 저렴), `*.pmtiles` → 미지정(수백 MB·Range 요청이라 매 요청 재검증은 손해). `upload_bytes`/`upload_file` 이 이를 기본값으로 쓰므로 **호출부(admin_server·publish_pack·upload_packs) 수정 없이 전부 자동 적용** — 호출부마다 인자를 넣는 방식은 하나 빠뜨리면 조용히 재발하므로 채택하지 않음.
  - **앱**: `cachePolicy = .reloadIgnoringLocalCacheData`(문서 1KB 미만) — 서버 헤더가 빠져도 안전하도록 이중 방어.
  - **기존 R2 객체 소급 적용**: 헤더는 다음 업로드부터 붙으므로 EC2 에서 `copy_object(MetadataDirective="REPLACE")` 로 기존 `*.json`·`*.geojson` 전체에 헤더 부여(내용 보존). config 2종 + 팩 geojson 확인 완료, `kr-base.pmtiles` 는 정책대로 제외됨을 검증. ⚠️ `git pull` 만으로는 안 되고 **admin 서버 재시작 필요**(파이썬이 로드한 모듈을 캐시).
- **추천 탭 당겨서 새로고침(`RecoView.swift`)**: 캐시를 무시해도 **다시 받는 시점**이 앱 재실행뿐이었다 — `TabView` 는 한번 만든 탭 뷰를 살려두므로 `.task` 가 앱 실행당 한 번만 돈다. `.task`/`.refreshable` 공용 `reload()` 로 일원화하고, 매거진이 삭제돼 목록이 짧아진 경우 `magIndex` 범위 이탈 방지 + 캐러셀 위치 재설정. 탭 전환마다 자동 재요청하는 안도 있었으나 큐레이션이 자주 바뀌지 않아 사용자 주도 방식을 택함.

### 수정 / 변경 (빌드 버전 반영)
- **빌드 버전이 Info.plist 에 반영되지 않던 문제(`ios/project.yml`)**: TestFlight 업로드가 `bundle version must be higher than the previously uploaded version: '1'` 로 거부돼 드러났다. `info.properties` 에 `CFBundleVersion`·`CFBundleShortVersionString` 참조가 없어 **XcodeGen 이 자기 기본값(1 / 1.0)을 Info.plist 에 리터럴로 박았고**, 그 결과 `project.yml` 의 `MARKETING_VERSION` 도 `testflight.sh` 의 `xcodebuild CURRENT_PROJECT_VERSION` 오버라이드도 **전부 무시**됐다. **build 166 은 0.1.0(166) 이 아니라 실제로는 1.0(1) 로 올라가 있었다.**
  - `$(MARKETING_VERSION)`·`$(CURRENT_PROJECT_VERSION)` 참조 추가 → `CURRENT_PROJECT_VERSION=169` 빌드가 `1.0 (169)` 로 나오는 것을 확인.
  - `MARKETING_VERSION` 을 **1.0 으로 정정** — 이미 업로드된 빌드와 App Store Connect 버전 레코드가 1.0 이라 0.1.0 으로 내리면 버전이 역행한다.
  - ⚠️ 업로드 결과를 `grep|tail` 로 파이프하면 **종료 코드가 tail 것으로 바뀌어 실패가 성공으로 보인다**. 스크립트는 `set -euo pipefail` 로 정상이었고 확인 방식이 문제였음.

### 기록 (글리프 용량 — 분석만, 미적용)
- **`ios/gen-style.mjs` 주석으로 근거 보존**: 글리프 44MB = 앱 설치크기 58MB 의 76%. ① **Bold 16.5MB 가 문자 `X` 하나를 위해** 실려 있다(Bold 를 쓰는 레이어는 `course-ends-x` 뿐이고 text-field 가 리터럴). ② Regular 의 가나·키릴·아랍 2.6MB 도 렌더 대상 아님 — 기저지도 MVT 에 `name:ja`/`name:zh` 가 있으나 스타일이 읽는 키는 `name:ko`/`name` 뿐(원격 PMTiles 에서 전국 104개 타일을 받아 MVT 를 직접 파싱해 확인: 렌더 문자 = 한글 664종·ASCII 69종·한자 3종(`道林里`)·전각 `ｅ`).
- **미적용 결론**: pbf 압축률이 높아 **다운로드는 9.7MB→7.8MB 로 1.9MB 만** 준다. 얻는 건 설치 19MB 절감뿐인데 오프라인 팩이 그보다 크고, 실수하면 희귀 한자 지명이 □ 로 조용히 깨진다. 착수 적기: poi-display 볼드 설정 반영 / 용량 민원 / App Store 정식 출시.
- **함께 남긴 경고**: `poi-display.json` 을 반영하면 사찰·전철역 등에 볼드가 켜져 **한글 Bold 글리프가 필요해진다**. 줄일 거면 "Bold 가 리터럴 아닌 text-field 에 쓰이면 빌드 실패" 가드를 함께 넣을 것.

### 생성 / 추가 (TestFlight)
- **앱 아이콘(`Assets.xcassets/AppIcon.appiconset` + `scripts/make_app_icon.py` 신규)**: 지금까지 아이콘이 아예 없었다 — **없으면 App Store Connect 가 업로드를 거부**한다("Missing app icon"). 앱의 흑백 원칙대로 검정 바탕 + 흰 능선 + 주봉 정상 위치 마커(산 + 내 위치를 한 형태로). 1024 단일 크기·**알파 채널 없음**(App Store 필수). 실루엣 안에 등고선을 넣는 안도 만들었으나 홈화면 크기(120px)에서 층층이 뭉쳐 폐기. SVG 렌더러(ImageMagick)의 `clip-path` 지원이 불안정해 **Pillow 로 직접 합성**(4배 슈퍼샘플 후 축소).
- **업로드 스크립트(`ios/testflight.sh` + `ios/ExportOptions.plist` 신규)**: 아카이브 → App Store Connect 전송을 한 줄로. `destination: upload` 라 export 와 동시에 전송된다. 인증은 **App Store Connect API 키(.p8)** — `ASC_KEY_ID`/`ASC_ISSUER_ID`/`ASC_KEY_PATH` 환경변수. 배포 인증서·프로비저닝 프로파일은 `-allowProvisioningUpdates` 가 자동 발급하므로 수동 생성 불필요. 빌드번호는 **`git rev-list --count HEAD`** 로 단조 증가(같은 번호 재업로드는 애플이 거부). ⚠️ **커밋 없이 재실행하면 번호가 그대로라 거부된다.**

### 수정 / 변경 (TestFlight)
- **`project.yml`**: `ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon` 추가, **`ITSAppUsesNonExemptEncryption: false`** 추가 — 통신이 표준 HTTPS(TLS)뿐이라 수출규정 면제 대상이며, 박아두면 업로드마다 암호화 설문을 받지 않는다. 서명 주석도 "개인팀(무료)" → TestFlight 배포 전제로 갱신.
- **`ios/.gitignore`**: `build-device/`·`build-sim/`(`-derivedDataPath` 지정 빌드 산출물) 무시 추가.

### 배포 환경 확정 (TestFlight)
- **와일드카드 App ID 로는 TestFlight 불가**: 기존 실기 빌드는 `977YU63XXZ.*`(iOS Team Provisioning Profile: \*)로 되고 있었으나, **App Store/TestFlight 배포는 명시적(Explicit) App ID 필수** → `dev.metaphr.hiheight` 를 포털에 신규 등록. 백그라운드 위치는 App ID capability 가 필요 없어 추가 권한 없이 등록.
- **배포 방식 = 내부 테스터**: 지정된 팀원에게만 시험 배포 → **Beta App Review 없음**(업로드 처리 5~15분 후 즉시 설치 가능), 최대 100명. 대신 테스터가 App Store Connect 사용자로 들어온다. 외부 테스터(이메일 초대·공개링크 OFF)는 첫 빌드 심사 1~2일 + 백그라운드 위치 사유서가 필요해 제외.
- **업로드 검증 완료**: `ARCHIVE SUCCEEDED` → `Upload succeeded` → `EXPORT SUCCEEDED`, **build 166** 수신 확인. 앱 레코드 = 하이하잇 / ID 6792697435 / SKU hiheight.
- **알려진 경고(무해)**: MapLibre 가 미리 컴파일된 바이너리 프레임워크라 **dSYM 미포함** → MapLibre 내부 크래시는 심볼화 안 됨(앱 Swift 코드는 정상). 내부 테스트 단계에선 방치.
- 버전 표기는 App Store Connect 레코드가 1.0, 앱은 `MARKETING_VERSION 0.1.0` 로 불일치하나 TestFlight 표시만 다를 뿐 업로드에 무관 — 0.1.0 유지 선택.

### 생성 / 추가 (문서)
- **`WORD.md` 신규 — 프로젝트 용어 사전**: 이 저장소에 실제로 등장한 용어만 8개 분야(지도 기술 / 데이터·좌표계 / 오프라인 / iOS 네이티브 / 백엔드·인프라 / 보안 / 빌드·배포 / 이 프로젝트만의 약속)로 정리. 각 항목에 뜻과 함께 **"왜 이 선택을 했나"(결정 배경)** 를 남겨 나중에 되짚을 수 있게 했다. 프록시 2종의 목적 구분(CORS 회피=네이티브에서 소멸 / 키 은닉=영구 유지), 키 배치표, S1·S2·S3 현황, 겪은 삽질의 원인(포트 8890 셀룰러 차단·Vercel 와일드카드 도메인 잔재·누적고도 2404m) 포함.
- **`README.md` 11장 문서 표 갱신**: WORD.md 링크 추가. 존재하지 않는 `~/.claude/plans/moonlit-rolling-tulip.md` 행을 이를 대체한 **IOS.md** 로 교체(CLAUDE.md 가 명시한 단일 기준 문서인데 표에서 빠져 있었다).

### 생성 / 추가 (S3·UX)
- **강제 종료 세션 복구(`ClimbStore` + `ClimbResumeView.swift` 신규)**: 앱 스위처 강제 종료는 종료 콜백이 보장되지 않고 사용자가 종료한 앱은 위치 이벤트로 재실행되지도 않는다 → "종료를 막는" 대신 **진행 중 계속 append**. `climb-session.ndjson`(1행=메타{산·코스·계획고도·코스거리·시작시각}, 이후=`[lng,lat,고도,unix초]`)에 GPS 점마다 기록, 깨진 마지막 줄은 관대 파싱. 재실행 시 감지해 **앱 UI 팝업**(시스템 다이얼로그 아님)으로 **이어서 계속 / 종료하고 저장 / 삭제** 제시(모호한 "나중에"는 제거). IOS.md §9 S3 "앱 강제종료/재실행 시 세션 복구" 충족.
- **백그라운드 위치(§7-1)**: `allowsBackgroundLocationUpdates` + `pausesLocationUpdatesAutomatically = false`(등산 중 iOS 자동 일시정지로 트랙 끊김 방지), `project.yml` 에 `UIBackgroundModes: location` + 사유 문구 갱신. ⚠️ 백그라운드 모드 없이 위 속성을 켜면 크래시하므로 항상 짝을 맞출 것. **배터리 예산(4시간 ≤25%)은 실산행 1회로만 검증 가능 — 미검증.**
- **커스텀 스와이프 삭제(`SwipeToDeleteRow.swift` 신규, 기록·등반 탭 공용)**: 시스템 `swipeActions` 는 행 옆에 나란히 놓이는 구조라 ①왼쪽 모서리 각짐 ②카드와의 틈 ③겹침 효과 불가 — 셋을 동시에 못 풀어 직접 구현. ZStack 2층으로 **카드가 빨간 삭제 버튼 위로 미끄러지는** 효과, 모서리 반경 파라미터로 카드와 일치(기록 14·저장된 지도 12). 세로 스크롤 충돌을 피하려 **가로 우세 드래그**(`|dx|>|dy|`, 최소 12pt)일 때만 반응, 열린 상태에서 카드 탭 시 닫힘.
- **프로필 사진 크롭(`AvatarCropView.swift` 신규)**: 사진 선택 시 전체화면 조정 — **원형 가이드**(원 밖 딤) + 드래그 이동 + 핀치 확대(1~5배) + 슬라이더 + "원래 크기로". 편집 화면과 **동일한 뷰 구성을 `ImageRenderer` 로 렌더**해 보이는 그대로 512px 원형 저장. 미리보기 탭으로 기존 사진 재조정.
- **기록 날짜 필터·정렬**: 캘린더에서 **기록 있는 날만 탭 가능** → 그 날만 표시(재탭 해제, 선택일 강조, 해제 칩). 목록 위 작은 알약 정렬 버튼(날짜/거리/시간) + **화살표로 오름↔내림 토글**(선택된 버튼 재탭).

### 수정 / 변경 (S3·UX)
- **누적고도 부풀림 버그 수정(`AuthStore.estimatedAscent`)**: 실측 GPS 고도가 부족하면(샘플 10개 미만) **코스 계획고도를 통째로** 기록해, 시작하자마자 종료한 0km 세션도 계양산 315m가 매번 적립됐다(실제 확인: 9건 중 8건이 0.0x km인데 합계 2404m). → **진행률 비례**(계획고도 × 실제거리/코스거리)로 바꾸고 **0.2km 미만은 기록하지 않음(nil)**. `ClimbDraft`·`PendingSession`·세션 메타에 코스 거리(`plannedDistanceKm`) 추가해 정상 종료·복구 종료 모두 적용.
- **탐험 바텀시트 2단계화**: `peek·medium·large` → **`peek`(지도 모드)·`large`(목록 모드)**. medium 은 `scrollDisabled(detent != .large)` 때문에 "보이는데 못 넘기는" 사각지대였고 손잡이 탭 토글도 이미 건너뛰고 있었다. `selectCourse` 의 `revealList` 파라미터도 제거(어느 경로로 골라도 접어서 지도 노출 — 코스명은 상단 오버레이, 시종점·배지는 지도가 표시).
- **기록 목록 레이아웃**: 행 간 여백을 `listRowInsets` 안쪽 → **`listRowSpacing`**(행 밖)으로, 좌우 여백은 **List 자체 padding** 으로 이동 — 행 높이·폭이 카드와 정확히 일치해야 스와이프 버튼이 어긋나지 않는다.
- **등반 탭 저장된 지도**: 휴지통 버튼 제거하고 기록 탭과 동일한 스와이프 삭제로 통일.

### 생성 / 추가 (등반 UX)
- **등반 종료 오터치 방지(`ClimbEndConfirmView.swift` 신규)**: 종료 버튼이 바로 끝내지 않고, **랜덤 2자리 확인번호**를 제시하고 **자체 숫자 키패드**(1~9·0·⌫)로 입력받아 일치할 때만 종료 + 기록 저장. 틀리면 빨간 테두리 안내 후 초기화, 취소 시 등반 계속. 스타일은 앱 전반(Theme·`.kakao` 폰트·둥근 사각/테두리) 준수. `ExploreView` 가 `Int.random(in: 10...99)` 으로 번호 생성 후 시트 제시, 통과 시 `finishClimb()`(종료+저장).
- **등반 중 "앞으로 갈 루트" 점선(`gen-style.mjs`)**: `climb-route-casing`(검정, 폭7) + `climb-route`(회색, 폭3.6) 두 겹 점선 레이어. dasharray 단위가 선폭 배수라 두 겹의 대시 길이를 맞추려 폭에 반비례 스케일(`[1.03,0.926]`/`[2,1.8]`), `line-cap: butt`. **지나온 길은 기존 `climb-track`(검정 실선)이 그 위에 덮여** 코스 선을 자르는 연산 없이 "지나온 곳=실선 / 남은 곳=점선"이 된다(레이어 순서로 해결).

### 수정 / 변경 (등반 UX)
- **`MapView.swift`**: 등반 중이면 기존 검정 실선 강조(`trail-hl`)를 끄고 점선 레이어를 선택 코스로 필터링(`applyTrailSelection`). `updateUIView` 에서 `tracking` 을 `applyTrailSelection` 보다 먼저 반영(한 프레임 지연 방지).
- **`ContentView.swift`**: 등반 중 **하단 네비바 숨김** — 배터리 절약·오조작 방지로 다른 탭 이동 차단(검색 중 숨김과 동일한 `safeAreaInset` 조건). 종료하면 복귀. (처음엔 탭 잠금+자물쇠 아이콘으로 만들었다가 네비바 숨김이 낫다는 판단으로 교체.)
- **`ExploreView.swift`**: 네비바가 사라진 자리가 비어 보이는 문제 → HUD 카드가 화면 물리적 끝까지 채우도록 **컨테이너 레벨** `.ignoresSafeArea(.container, edges: 등반 중 .bottom)` + 카드 내부 `.safeAreaPadding(.bottom)`(기기별 인디케이터 높이 자동, SE=0). 자식에만 걸면 부모가 이미 안전영역을 소비해 확장되지 않는다. **⚠️ 이 항목은 실기기 확인 대기 중**(앞선 두 차례 시도가 미해결이었음).
- **`Config.swift` 주석 정정**: "배포 시 네이티브 직접 호출(KMA)로 교체 예정" → 실제 정책인 **"프록시 유지·앱에 키 미포함"**(IOS.md §2·§13)으로 수정. 앱 바이너리에 data.go.kr 키를 심으면 추출·도용 위험이라 프록시를 계속 쓴다.

### 수정 / 변경 (GPS·세션·다운 로그인)
- **등반 현재 위치 점을 루트와 동기화(`MapView.swift`·`gen-style.mjs`)**: 줌 시 현재 위치 포인터와 루트 선이 엇갈렸다 따라오던 문제 — 원인은 위치 소스 이원화(루트=ClimbStore geo style 레이어 / 점=MapLibre 내장 dot 주석 뷰, 주석 뷰가 줌 애니메이션 중 한 프레임 늦게 재배치). 해결: **등반 중 현재 위치를 style 레이어(`climb-pos`)로 렌더**(트랙 마지막 점 주입) → 루트와 완벽 동기 재투영. 내장 dot 은 `EmptyUserDot`(빈 `MLNUserLocationAnnotationView`) + `viewFor` 로 등반 중 숨김, 트래킹 전환 시 주석 새로고침(종료 시 기본 dot 복귀). 카메라 추적(userTrackingMode)은 유지.
- **GPS 정확도 게이트(`ClimbStore.swift`)**: `horizontalAccuracy` 무효(-1)/부정확(>50m) 고정 무시 — 나쁜 신호에 포인터가 점프하지 않고 마지막 양호 위치 유지(트랙 오염 방지).
- **로그인 세션 복원 시점(`ContentView.swift`)**: `auth.refresh()` 가 기록 탭 방문 시에만 실행돼, 앱 켜고 바로 등반하면 세션 미복원으로 "로그인하세요"가 뜸 → **앱 시작 시(카탈로그와 함께) 세션 복원**하도록 이동.
- **지도 다운 로그인 필수(`ExploreView.swift`)**: 웹과 동일하게 계정 기준(saved_packs) 관리 → 비로그인 시 다운로드 대신 "기록 탭에서 로그인" 안내. (앞서 로그인 불필요였던 것을 필수로 변경.)

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
