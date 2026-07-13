# ios/ — 하이하잇 iOS 네이티브 (S1 스파이크)

IOS.md **§9 S1** 검증용 스파이크. 목적: **MapLibre Native iOS + 웹과 동일한 `buildStyle()` JSON +
원격 PMTiles**가 렌더되는지, 두 테마에서 카토그래피 패리티가 나오는지 확인한다. **버릴 수 있는 검증 앱**.

## 전제
- **맥의 `admin_server.py`(포트 8890)가 떠 있어야 한다.** 시뮬레이터가 이 프록시로 PMTiles
  (`/pmtiles/kr-base·kr-terrain.pmtiles`, R2 Range 프록시)와 글리프(`/fonts/…`)를 받는다.
  → 스파이크 지름길: R2 dev 엔드포인트 UA 403·CORS 를 프록시가 이미 우회. `pmtiles://` 렌더 검증에 집중.
- 로컬 툴: `node`, `xcodegen`(brew), Xcode. 시뮬레이터 빌드라 코드서명 불필요.

## 생성·빌드·실행
```bash
# 0) (필요 시) 맥에서 서버 기동
.venv/bin/python scripts/admin_server.py         # → http://localhost:8890

# 0b) 오버레이 검증용 팩 geojson 확보 (data/packs/ 는 gitignore — 재생성물)
#     admin_server 가 /data/packs/<코드>/… 로 정적 서빙 → 스타일이 이 URL 을 소스로 씀
mkdir -p data/packs/282600201
curl -s -H "User-Agent: hiheight/1.0" \
  https://pub-cfc2302f77a446c1a0fdff6d0ae4e451.r2.dev/packs/282600201/contours.geojson \
  -o data/packs/282600201/contours.geojson

# 1) 스타일 JSON 생성 (basemap-style.js → 절대 URL 로 절대화 + 등고선 오버레이)
cd ios && node gen-style.mjs

# 2) 프로젝트 생성 (SPM: MapLibre 6.27.0 해석)
xcodegen generate

# 3) 시뮬레이터 빌드
xcodebuild -project HiHeight.xcodeproj -scheme HiHeight \
  -sdk iphonesimulator -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build

# 4) 설치·실행 (부팅된 시뮬레이터에)
xcrun simctl install booted <빌드산출물>/HiHeight.app
xcrun simctl launch booted dev.metaphr.hiheight
```

## 구조
- `project.yml` — XcodeGen 정의 (SPM MapLibre, min iOS 16, ATS 로컬 예외). `.xcodeproj` 는 재생성물.
- `gen-style.mjs` — `buildStyle()` 재사용 → `basemap-light/dark.json`. 스타일 로직 단일출처는 `../basemap-style.js`.
- `HiHeight/HiHeightApp.swift` — 앱 엔트리.
- `HiHeight/ContentView.swift` — colorScheme → 테마 스타일 선택.
- `HiHeight/MapView.swift` — `MLNMapView` SwiftUI 브리지.

## S1 판정 (IOS.md §9) — 2026-07-13 **GO**

카토그래피 엔진 패리티(스파이크의 make-or-break 위험)는 전부 통과. 남은 항목은
"MapLibre 가 되는가"(위험)가 아니라 "런타임 아이콘 로직 Swift 포팅"(M1 구현)이라 M1 로 이월.

| 항목 | 결과 |
|---|---|
| 라이트/다크 두 테마 | ✅ |
| `pmtiles://` 원격 Range (기저 벡터타일) | ✅ 서버 로그 206 |
| hillshade 페이드 (z13→16) | ✅ |
| CJK + 라틴 글리프 라벨 (프록시 /fonts) | ✅ |
| 등산로 위계 (기저 paths) | ✅ |
| POI 이중 줌 게이트 (텍스트 poi-urban) | ✅ |
| **등고선 3종** (팩 geojson 오버레이 + GL 필터·라인심볼 라벨) | ✅ |
| 스팟 coalesce 오버라이드 | ⏭ M1 (geojson 경로는 등고선으로 입증) |
| POI 아이콘 배지 / 코스 번호 배지 | ⏭ M1 (런타임 캔버스→UIGraphicsImageRenderer 포팅) |
| 루트 위계 (팩 routes 오버레이) | ⏭ M1 |

결론: **S1 통과 → §10 M1 착수 가능.** 실패 시 대안은 IOS.md §9 표 참조.
