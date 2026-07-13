# IOS.md — iOS 네이티브 이식 계획서 (v2)

> 작성 2026-07-13. `~/.claude/plans/moonlit-rolling-tulip.md`(v1, "번들 PMTiles·2산·백엔드 없음" 시절)를
> **대체**한다. v1 이후 시스템이 R2 자체호스팅 + Supabase 카탈로그 주도 + 관리자 발행 파이프라인으로
> 재편되어 이식 범위·전제가 달라졌다. 이 문서가 이식의 단일 기준이다.

---

## 1. 전략 요약

- **이식은 타당하다.** 핵심 가치(화면 잠금 상태 백그라운드 GPS 등반 기록)는 모바일 웹에서 구조적으로
  불가능하고, 데이터·백엔드·카토그래피는 대부분 그대로 재사용된다. 재작성 대상은 UI(HTML/CSS→SwiftUI)뿐.
- **전면 전환이 아니라 스파이크 → go/no-go → 본 이식** 순서로 간다 (§8, §9).
- 이식 기간 동안 **웹 사용자 기능은 동결**(버그픽스만). 웹은 ① UI/UX 스펙 레퍼런스 ② Supabase 교차
  검증 도구 ③ 관리자 운영 도구(존치)로 계속 가치가 있다.

## 2. 시스템 경계 — 무엇을 이식하고 무엇을 남기나

| 구분 | 대상 | 처리 |
|---|---|---|
| **이식(재작성)** | 사용자 앱 UI 전부: `index.html`·`style.css`·`app.js`(2,105줄)의 4탭 화면 | SwiftUI 재작성 (§6) |
| **이식(로직 1:1 참조)** | `weather.js`(기상청 격자변환·발표시각·병합·아이콘), `npn.js`(국가지점번호 — 순수 수학), `basemap-style.js`(스타일 생성) | Swift 함수로 직역 |
| **존치(무변경 재사용)** | Supabase 스키마·RLS 5테이블, R2(타일·팩·config·이미지), 관리자 콘솔(8891)·발행 파이프라인(`scripts/*.py`), 데이터 파이프라인 | 백엔드 재작업 없음 |
| **폐기(웹 전용 계층)** | Vercel `/api/tiles` 프록시(CORS 회피용), `scripts/serve.py`, IndexedDB 팩 저장, CDN ESM import 4종, DOM 바텀시트, 인트로 스플래시 마크업 | 네이티브에 대응물 (§5) |
| **유지 결정 필요** | Vercel `/api/weather`(기상청 키 서버측 은닉) | **권장: 네이티브도 이 프록시를 그대로 호출** — data.go.kr 개인 키를 앱 바이너리에 심지 않는다. Vercel `icn1` 고정이라 지연 부담 낮음 |

## 3. 아키텍처

- **Swift + SwiftUI**, 지도는 **MapLibre Native iOS** (SPM `maplibre-gl-native-distribution`).
- **supabase-swift** (SPM) — 동일 프로젝트(`durnojryhhsajnlwvdzt`)·anon key·RLS 그대로.
- 최소 **iOS 16** (바텀시트 `.presentationDetents`, Swift Concurrency). 개발 중 16 유지가 부담되면
  17로 상향 검토(2026년 시점 점유율 문제없음).
- 네트워크 접근은 전부 **R2 직결** + Supabase + `/api/weather` 프록시. 타일 프록시 계층은 없다.

### 3.1 R2 직결의 전제 — 커스텀 도메인 (사전조건 §8-1)
현재 공개 URL `pub-cfc2302f77a446c1a0fdff6d0ae4e451.r2.dev` 는 Cloudflare **개발용 엔드포인트**다:
레이트리밋이 있고, 기본 User-Agent 를 403 차단한다(웹은 Vercel 프록시가 커스텀 UA 로 우회 중).
프로덕션 앱이 직접 치면 안 되므로 **R2 버킷에 커스텀 도메인(예: `tiles.metaphr.dev`)을 연결**하고,
네이티브·웹 모두 그 URL 을 쓴다. 연결 후 웹 `/api/tiles` 프록시도 단순화 가능(선택).

### 3.2 데이터 소비 지점 (네이티브가 읽는 것 전부)
```
R2  /kr-base.pmtiles           전국 기저 벡터타일 (505MB, HTTP Range)   ← 온라인 지도
R2  /kr-terrain.pmtiles        음영기복 terrain-RGB z5–12 (273MB)      ← 온라인 전용
R2  /packs/<산코드>/base.pmtiles·routes·spots·contours.geojson        ← 오프라인 팩 (base 최대 ~8.5MB/산)
R2  /config/poi-display.json · spot-display.json · curations.json     ← 관리자 발행 표시설정·큐레이션
R2  /images/mountains/…        큐레이션 커버 이미지
Supabase  mountains(카탈로그) · mountain_info(산 소개) · climb_records · saved_packs · profiles
Vercel    /api/weather?op=…    기상청 단기예보 프록시 (키 은닉)
번들      fonts/ 글리프 pbf (Nanum Gothic Coding 2웨이트 × 전 256범위, 17.6MB)
```

## 4. 재사용 자산 (그대로 이관)

| 자산 | 현재 위치 | 네이티브 매핑 |
|---|---|---|
| 흑백 스타일 라이트/다크 | `basemap-style.js` `buildStyle()` 출력 JSON | MapLibre Native 스타일 JSON 으로 그대로 로드 — **표현식 패리티는 S1 검증** |
| POI 표시 정책(이중 줌 게이트, v2 `{zoom,icon,size,bold}`) | 스타일 표현식 + `config/poi-display.json` | 동일 (스타일 주도라 이식 안전) |
| 스팟 표시 + 스팟별 오버라이드(coalesce) | `app.js` 레이어 + `config/spot-display.json` + 팩 properties | 동일 |
| 팩 규격 | `packs/<산코드>/` 4파일, routes/spots properties | 파일시스템 저장 후 로컬 소스로 소비 |
| 트랙 포맷 (**계약 완료**) | `schema.sql` 주석: `points:[[lng,lat,고도m\|null,unix초]…]` 최대 2,000점 균등 솎음 + `elev:{min,max,ascent,descent}`, 구형 3원소 하위호환 | CoreLocation → 동일 포맷 저장. **원본 고해상 트랙은 클라우드 미업로드 — 기기 로컬 GPX 보관** |
| Supabase 스키마·RLS | `supabase/schema.sql` + migrations | supabase-swift 가 그대로 소비 |
| 기상 도메인 로직 | `weather.js` (dfsXy 격자변환·발표시각 산정·ncst/ufcst/vfcst 병합·흑백 아이콘) | Swift 직역 — 파일 주석에 "iOS 이식 시 1:1 참조" 명시돼 있음 |
| 국가지점번호 | `npn.js` (WGS84→UTM-K Redfearn, 브라우저 API 미사용) | Swift 직역 |
| 글리프 | `fonts/` 자체 호스팅 pbf | 앱 번들 포함, 스타일 `glyphs` 를 번들 경로로 — **로딩 방식은 S1 검증** |
| 디자인 시스템 | `style.css` 흑백 변수·이모지 배제 | SwiftUI Color 에셋·컴포넌트 스타일 |
| 산 식별 체계 | 산코드 9자리 = 전 시스템 표준 키 | 동일 |

## 5. 웹 전용 → 네이티브 치환 표

| 웹 | 위치 | 네이티브 |
|---|---|---|
| CDN ESM (maplibre-gl 4.7.1 · pmtiles 3.2.1 · supabase-js 2) | `app.js:1-2`, `supabase-client.js` | SPM: MapLibre Native · supabase-swift. pmtiles JS 는 Native 내장 PMTiles 지원으로 대체(S1) |
| Vercel `/api/tiles` same-origin 프록시 | `api/tiles.js` | 폐기 — R2 커스텀 도메인 직결 |
| `localStorage` (테마 · 카탈로그 캐시 · poi/spot/curations 캐시 · `hiheight-last-course:<산>` · 날씨 스냅샷) | `app.js` 전반 | `UserDefaults`(소형) / 캐시 파일(config·카탈로그). 오프라인 폴백 의미까지 동일하게 |
| IndexedDB `hiheight-packs` (팩 Blob) | `app.js:1801-1828` | **파일시스템** `Documents/packs/<산코드>/` — 영구 저장(브라우저 퇴거 리스크 해소, v1 계획의 개선점) |
| `navigator.geolocation.watchPosition` (전경 한정) | `app.js:1404-1436` | **CoreLocation 백그라운드** (§7-1) |
| 런타임 캔버스 POI 아이콘(흑백 뱃지) | `app.js:146-238` | UIGraphicsImageRenderer 런타임 생성(로직 직역) 또는 에셋 사전 생성 |
| DOM 바텀시트 드래그 | `app.js:2022-2061` | `.presentationDetents` / 커스텀 시트 |
| `matchMedia` 테마 감지 | `app.js:75` | `@Environment(\.colorScheme)` + 수동 토글 |
| `navigator.clipboard` (국가지점번호 복사) | `app.js:868` | `UIPasteboard` |
| `location.hash`·인트로 스플래시·`Blob` 다운로드 | `app.js` 각처 | 카메라 상태 네이티브 관리 · LaunchScreen · 공유시트(GPX 내보내기로 승격 가능) |

## 6. 기능 인벤토리 → SwiftUI 매핑 (2026-07-13 기준 전수)

웹 구현이 곧 스펙이다. 각 항목의 참조 위치는 `app.js` 섹션 주석 기준.

### 탐험 탭
| 기능 | 웹 참조 | 노트 |
|---|---|---|
| 지도(흑백 2테마 + hillshade + 등고선 + 등산로 위계 + POI/행정라벨) | `basemap-style.js` | 스타일 JSON 그대로. hillshade 는 온라인 기저일 때만(로컬 팩 열람 시 원격 fetch 금지 — 웹과 동일 규칙) |
| 카탈로그 주도 산 목록 | `loadCatalog` (`app.js:32-54`) | `mountains` SELECT(published, sort_order) + 오프라인 캐시 폴백 |
| 산 검색 + 자동완성 | `app.js:1053` | |
| 코스 목록·선택(해당 루트만)·코스 번호 배지·시종점 마커 | `app.js:363-451, 959` | 번호는 항상, 시종점은 선택 시 |
| 난이도 미터·고도 스파크라인(profile 48점)·거리/시간 | `app.js:355`, 팩 properties | SwiftUI `Path` |
| 스팟 점+라벨 (카테고리 설정 + 스팟별 오버라이드) | `app.js:250-312` | 데이터/스타일 주도 |
| 산 소개 카드 (높이·소개·관리주체) | `app.js:848` | `mountain_info` 조인 |
| 날씨 스트립 (단기예보, 오프라인 스냅샷) | `weather.js` + `app.js:914` | 스냅샷 = 마지막 성공 응답 로컬 보관 |
| 국가지점번호 표시·복사 | `npn.js` + `app.js:868` | 조난 신고용 — 등반 화면에도 노출 검토 |
| 지도 다운 버튼(확인 모달→진행률→등반 탭 이동) | `app.js:1829-1943` | §7-3 |

### 추천 탭
| 기능 | 웹 참조 | 노트 |
|---|---|---|
| 하이하잇 PICK 캐러셀(슬라이드 4요소+credit, 스와이프 스냅+점 인디케이터) | `app.js:1137-1280` | `TabView(.page)` |
| 매거진 아카이브(지난 매거진 목록→캐러셀 전환) | 동일 | |
| 공식 추천 아코디언 3종(100대 명산·BAC·KNPS `lists`) | `OFFICIAL_LISTS`·`renderFamous` | |

### 등반 탭
| 기능 | 웹 참조 | 노트 |
|---|---|---|
| 저장된 지도 목록(용량·저장일·삭제, 계정 기준) | `app.js:1944` | 파일시스템 스캔 + `saved_packs` |
| 저장된 지도 열기 → 로컬 팩 렌더 + 최근 코스 자동선택 | `openSavedMap` (`app.js:2008`) | 로컬 base.pmtiles 소스 전환 |
| 등반 시작/종료 + 라이브 통계(거리·고도·시간) | `app.js:1319-1531` | GPS 는 §7-1 로 대체 |
| 라이브 루트(지나온 곳 본선색 / 지나갈 코스 짙은 회색, 테마 전환 유지) | `applyClimbRoute` | |
| 기록 저장(실측 거리·고도 통계·트랙 계약 포맷) | 동일 | 이동평균 평활 → ascent/descent 로직 직역 |

### 기록 탭
| 기능 | 웹 참조 | 노트 |
|---|---|---|
| 기록 목록("산 이름 \| 코스명" · 실측 거리·시간·↑상승 · 구형 기록 재계산 교정) | `app.js:1532` | |
| 루트 보기(탐험 지도에 점선 트랙 + fitBounds) | 동일 | |
| 스와이프 삭제(confirm → 영구 삭제 → 합계 갱신) | `app.js:1699` | `List` `.swipeActions` — 네이티브가 오히려 간단 |
| 산행 달력(기록 날 점 · 월 이동 · 오늘 링) | `renderRecCalendar` (`app.js:1553`) | |
| 합계 카드(총 산행/거리/누적고도) | 동일 | |
| 계정(이메일 가입·로그인·로그아웃, 비로그인 게이팅) | `app.js:1753` | supabase-swift Auth |

## 7. 신규 네이티브 구현 (웹에 없거나 스텁인 것)

1. **백그라운드 GPS 트래킹 (제품의 핵심)** — `CLLocationManager` `allowsBackgroundLocationUpdates`,
   Background Modes(location), 화면 잠금 상태 연속 기록. 정확도·필터 튜닝으로 배터리 예산 준수(S3 실측).
   `NSLocationWhenInUseUsageDescription` + Always 승격 플로우, Privacy Manifest 위치 신고.
2. **원본 고해상 트랙 로컬 보관** — 스키마 계약대로 클라우드엔 2,000점 단순화본만. 원본은 기기에
   GPX 로 저장 + 공유시트 내보내기. (웹의 Blob 다운로드보다 상위 호환)
3. **팩 파일시스템 관리** — 다운로드(진행률)·삭제·용량 집계·`saved_packs` 동기화·`pack_version`
   비교 업데이트 안내. IndexedDB 대비 영구 저장이라 "진짜 오프라인"이 처음으로 완성됨.
4. **(후순위·선택)** HealthKit 운동 연동, 라이브 액티비티(등반 중 잠금화면 통계), 위젯.

## 8. 사전조건 — 본 이식 착수 전 완료 (웹 측 작업 포함)

1. **R2 커스텀 도메인 연결** (§3.1) — 네이티브 직결의 전제. *(이 서버에서 진행)*
2. **계약 동결** — 팩 규격·routes/spots properties·config JSON 3종(버전 필드 추가)·트랙 포맷을
   계약 문서로 고정. 이후 변경은 "웹+iOS 동시 반영" 비용을 전제로만. *(이 서버에서 진행)*
3. **얼룩 폴리곤 버그(WORKLOG 2026-07-10 미해결) 층위 판별** — 타일 데이터 문제면 네이티브에서도
   재현되므로 이식 전 수리, GL JS 렌더러 문제면 보류 가능. *(이 서버에서 진행)*
4. **출처표기 추가** — 산림청·국립공원공단(7-12 스캔에서 누락 확인), OSM(ODbL)·Protomaps·
   Copernicus DEM·기상청. 웹에 먼저 구현 → 네이티브가 스펙으로 복제. *(이 서버에서 진행)*
5. **Apple Developer Program** 등록($99/년 — 백그라운드 위치·TestFlight 에 필요), Xcode, 실기기.
6. **웹 기능 동결 선언** — 사용자 기능 신규 개발은 이 시점부터 네이티브에서만.

## 9. 스파이크 (1~2주, go/no-go 관문 — 버릴 수 있는 검증 앱)

| # | 검증 | 통과 기준 | 실패 시 대안 |
|---|---|---|---|
| **S1** | MapLibre Native + `buildStyle()` JSON + R2 원격 kr-base/kr-terrain 렌더 | 두 테마에서 웹과 나란히 비교: 등고선 3종·등산로 위계·POI 이중 줌 게이트·스팟 coalesce 오버라이드·hillshade 페이드·**번들 글리프 라벨** 전부 동작. Native 의 PMTiles 지원 버전·원격 Range 동작 확인 | 표현식 미지원 → `buildStyle()` 을 웹/네이티브 이중 출력으로 분기. 원격 PMTiles 불가 → 다운로드 후 로컬 전용으로 설계 변경. 글리프 로딩 불가 → 로컬 HTTP 서빙 또는 `localIdeographFontFamily` 폴백(서체 타협) |
| **S2** | 오프라인 팩 — 산별 `base.pmtiles`+GeoJSON 3종 로컬 로드 | 비행기 모드에서 기저지도+등산로+스팟+등고선 렌더, 네트워크 요청 0 | 로컬 파일 소스 방식 변경(mbtiles 변환 등) |
| **S3** | CoreLocation 백그라운드 실산행 1회 (화면 잠금) | **사전 합의한 배터리 예산**(예: 4시간 트래킹 ≤25% 소모) + 트랙 끊김 없음 + 앱 강제종료/재실행 시 세션 복구 | 정확도-주기 튜닝, deferred updates, 세션 복구 아키텍처 재설계 — 본 이식 전에 결정 |

셋 다 통과 → §10 착수. 하나라도 실패 → 대안 아키텍처 논의로 복귀. 스파이크와 §8-1~4는 병행 가능.

## 10. 본 이식 마일스톤

| M | 범위 | 검증 (완료 기준) |
|---|---|---|
| **M1 지도** | 스파이크 승격: 카탈로그 로드 · 산 선택/검색 · 코스 표시/선택/번호/시종점 · 스팟 · 테마 | 웹과 화면 비교 패리티 (두 테마) |
| **M2 UI 셸** | TabView 4탭 · 바텀시트 · 코스 카드/스파크라인 · 산 소개 · 날씨 · 국가지점번호 · 추천 탭 전체 | 전 탭 네비게이션, 큐레이션이 R2 config 로 갱신됨 |
| **M3 계정·기록** | supabase-swift 인증 + climb_records CRUD + 달력·합계·루트 보기·스와이프 삭제 | **웹에서 만든 기록이 앱에 그대로 보임(교차 검증)** · RLS 격리 · 구형 3원소 트랙 하위호환 |
| **M4 오프라인 팩** | 다운로드 진행률 · 파일시스템 저장 · 삭제 · saved_packs 동기화 · 저장된 지도 열기+최근 코스 | 비행기 모드 E2E (앱 재시작 포함 — 웹이 못 하던 것) |
| **M5 트래킹** | 백그라운드 등반 세션 · 라이브 루트 · 실측 통계 · 계약 포맷 저장 · 원본 GPX 로컬 | 실산행 1회 → 기록이 웹 기록 탭에서도 정상 표시 |
| **M6 출시** | 아이콘/런치 · 출처표기 · Privacy Manifest · 백그라운드 위치 심사 사유 · TestFlight | 심사 제출 |

## 11. 저장소·개발 환경 전략

- **모노레포**: 이 저장소에 `ios/` 디렉터리 신설. 맥북은 GitHub 에서 clone, `ios/` + 계약 문서만 관심.
- **역할 분담**: 우분투 서버 = 데이터 파이프라인·관리자 콘솔·발행(현행 유지, systemd `hiheight-admin`).
  맥북 = iOS 개발(Claude Code + `xcodebuild` CLI 루프).
- **계약 변경 규칙**: 팩 규격·config 스키마·트랙 포맷·Supabase 스키마 변경은 반드시 이 문서와
  계약 문서를 먼저 갱신하고 웹·iOS 양쪽 이슈로 기록.
- 비밀 관리: anon key 는 클라이언트 노출 안전(RLS). 기상청 키는 서버측 유지(§2). service key 류는
  맥북에 두지 않는다.

## 12. 규제·라이선스·심사

- **저작자 표시**: OSM(ODbL — 표시+share-alike) · Protomaps · 산림청(등산로/100대 명산 API) ·
  국립공원공단 · Copernicus GLO-30 DEM · 기상청 단기예보. 앱 내 정보 화면에 일괄 표기(§8-4 웹 선행).
- **한국 지도 규제**: 자체 호스팅 OSM 벡터타일 + 개방 데이터 구성이라 국가기본도 국외반출 이슈 비해당.
  R2 리전은 자동이나 데이터 원천이 개방형이라 무방 — 출처별 약관 준수로 충분.
- **심사**: 백그라운드 위치 사용 사유서(등반 기록 앱 — 통상 승인), App Privacy(위치·계정 수집 신고).
  **소셜 로그인을 추가하는 순간 Sign in with Apple 의무** — 현재 이메일 전용이면 비해당.
- 큐레이션 업로드 사진 저작권은 운영자 책임(credit 필드로 표기 수단 확보됨).

## 13. 리스크 레지스터

| 리스크 | 영향 | 완화 |
|---|---|---|
| MapLibre Native 표현식/PMTiles 패리티 미달 | 카토그래피 1:1 전제 붕괴 | S1 에서 최우선 검증, 스타일 생성기 분기 대안 |
| 백그라운드 GPS 배터리 과다 | 제품 핵심 가치 훼손 | S3 실측을 go/no-go 에 포함, 예산 숫자 사전 합의 |
| `pub.r2.dev` 직결 (레이트리밋·UA 403) | 지도 로드 실패 | 커스텀 도메인을 사전조건으로 강제(§8-1) |
| 스펙 표류 (웹이 계속 진화) | 이중 구현 비용 폭증 | 계약 동결 + 웹 기능 동결(§8-2·6) |
| 얼룩 폴리곤 버그 동반 이주 | 두 렌더러에서 이중 디버깅 | 이식 전 층위 판별(§8-3) |
| 코드 이원화 (서버/맥북) | 진실의 원천 상실 | 모노레포 + 역할 분담(§11) |
| 기상청 API 키 노출 | 키 도용·쿼터 소진 | 프록시 유지 결정(§2), 앱에 키 미포함 |
