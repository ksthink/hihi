# ios/ — 하이하잇 iOS 네이티브

MapLibre Native iOS + SwiftUI 로 만든 대한민국 등산 앱. 웹앱(`../app.js` 등)의 4탭 화면을
네이티브로 재작성하고, 웹과 **동일한 `buildStyle()` 스타일 로직**을 공유한다.
이식 계획서(단일 기준): **`../IOS.md`**.

## 아키텍처 — 맥 의존 없음(전부 HTTPS/번들)

개발용 맥 프록시(`admin_server`/`serve.py` 8890)에 **의존하지 않는다.** 모든 데이터는 클라우드
직결 또는 앱 번들에서 온다. 맥이 꺼져 있어도, 다른 네트워크에서도 동작한다.

| 자원 | 출처 | 프로토콜 |
|---|---|---|
| 기저 벡터타일(`kr-base`)·음영기복(`kr-terrain`) | `hihi.metaphr.dev` (Cloudflare **R2 커스텀 도메인** 직결) | HTTPS `pmtiles://` Range |
| 팩 오버레이(`packs/<산코드>/contours·routes·spots.geojson`)·`config/` | `hihi.metaphr.dev` (R2) | HTTPS |
| 날씨(`/api/weather`) | `hihi.ksthink.com` (Vercel, 기상청 키 은닉) | HTTPS:443 |
| 지도 글리프(라벨 pbf) | **앱 번들**(`Resources/glyphs/`, 오프라인) | — |
| 카탈로그·산소개·로그인·기록 | Supabase 직결(anon 키 + RLS) | HTTPS |

접속 상수 단일 출처: [`HiHeight/Config.swift`](HiHeight/Config.swift).
R2 dev 엔드포인트(`pub-*.r2.dev`)는 레이트리밋·기본 UA 403 이 있어 앱이 직접 치지 않는다 →
버킷에 커스텀 도메인을 연결(§8-1)해 직결한다. ATS 는 전부 HTTPS 라 `NSAllowsLocalNetworking` 만 둔다.

## 전제

- 로컬 툴: `node`, `xcodegen`(brew), Xcode. **맥 서버 기동 불필요.**
- 실기기 빌드는 코드서명 필요(개인팀 자동 서명, `project.yml` `DEVELOPMENT_TEAM`). 시뮬레이터는 서명 불필요.

## 생성·빌드·실행

```bash
# 1) 스타일 JSON 4벌 생성(basemap-{light,dark}[-osm].json) + 글리프 pbf 를 번들로 복사.
#    스타일 로직 단일출처는 ../basemap-style.js, URL 베이스는 HIHEIGHT_BASE(기본 hihi.metaphr.dev).
cd ios && node gen-style.mjs

# 2) 프로젝트 생성(SPM: MapLibre 6.27.0, supabase-swift 해석)
xcodegen generate

# 3-a) 시뮬레이터 빌드
xcodebuild -project HiHeight.xcodeproj -scheme HiHeight \
  -sdk iphonesimulator -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build

# 3-b) 실기기 빌드(연결·잠금해제·개발자모드 필요)
xcodebuild -project HiHeight.xcodeproj -scheme HiHeight -configuration Debug \
  -destination 'id=<디바이스 UDID>' -allowProvisioningUpdates build

# 4) 실기기 설치·실행
xcrun devicectl device install app --device <UDID> <빌드산출물>/HiHeight.app
xcrun devicectl device process launch --device <UDID> --terminate-existing dev.metaphr.hiheight
```

로컬 dev 로 맥 프록시를 쓰고 싶으면 `HIHEIGHT_BASE=http://localhost:8890 node gen-style.mjs` +
`Config.proxyBase` 를 로컬로 바꾼다(선택). 실기기에선 비표준 포트가 모바일망에서 막힐 수 있어 클라우드 권장.

## 구조

- `project.yml` — XcodeGen 정의(SPM MapLibre·Supabase, min iOS 17, ATS, 서명, 번들 리소스).
  글리프는 `type: folder` 폴더참조로 번들해 `<fontstack>/<range>.pbf` 디렉터리 구조를 보존한다.
  `.xcodeproj` 는 재생성물(커밋 금지).
- `gen-style.mjs` — `buildStyle()` 재사용 → 스타일 JSON 절대화(R2 URL)·오버레이(등고선/루트/스팟)
  추가 + 글리프를 `../fonts/` 에서 `Resources/glyphs/` 로 복사. 산출물은 gitignore(재생성).
- `HiHeight/` — SwiftUI 앱. `ContentView`(탭), `ExploreView`(탐험·지도), `DeungView`(등반),
  `RecoView`(추천), `RecordsView`(기록), `MapView`(MLNMapView 브리지), `Config`(접속 상수),
  `AuthStore`/`CatalogStore`/`ClimbStore`(Supabase·상태), `Weather`(기상청), `Font+Kakao` 등.
- `Resources/` — 스타일 JSON·컨트롤 아이콘·UI 폰트(ttf)·글리프 pbf(모두 재생성/복사물, gitignore).

## App Store 전 남은 과제(요약, 상세 ../IOS.md)

- 백그라운드 GPS 트래킹·기록 영속화(CoreLocation/SwiftData) 실구현.
- 등반 진단 계측 보강 — `track.meta` 에 전경/배경 시간(`fg_s`/`bg_s`)·저전력모드(`lpm`) 추가
  (배터리 %/h 에서 화면 기여분 분리 — 상세 ../IOS.md §7-4).
- 등반 배터리 모드 3단(일반/절전/최대절전) — 기록 탭 → 프로필 → 설정에서 선택.
  절전=표시 스로틀(5m·5s), 최대절전=지도 대신 숫자만. 기록은 모드 무관 1Hz (../IOS.md §7-5).
- 출처표기(OSM ODbL·Protomaps·산림청·국립공원공단·Copernicus DEM·기상청) 정보화면.
- Apple Developer Program·App Privacy·백그라운드 위치 사유서.
