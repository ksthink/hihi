# ICLOUD.md — 사용자 iCloud 저장 적용 계획 (보류 중)

> 작성 2026-07-29. "로컬 루트 데이터를 개인 iCloud 에 저장할 수 있는가" 검토 결과와,
> **나중에 필요해졌을 때 그대로 꺼내 쓸 수 있는 적용 계획**을 담는다.
> **현재 결론: 도입 보류.** 단, §3 의 백업 제외 플래그는 iCloud 도입 여부와 무관한 선행 과제다.

---

## 1. 현재 데이터 저장 지형

| 데이터 | 위치 | 성격 | 기본 백업 대상 |
|---|---|---|---|
| 진행 중 트랙 `climb-session.ndjson` | Application Support (`ClimbStore.sessionURL`) | 크래시 복구용 임시. 1초마다 append, 종료 시 삭제 | 포함 |
| 완료된 등반 기록 `track` | **Supabase** `climb_records.track` (jsonb) | **정본.** 로그인 필요 | — (서버) |
| 오프라인 팩 (`base.pmtiles`·`routes/contours/spots.geojson`) | Application Support/packs/`<코드>`/ (`PackStore.root`) | R2 에서 재다운로드 가능한 캐시 | 포함 ⚠️ |
| GPX 내보내기 | tmp → 공유 시트 (`RouteGPX.writeTemp` → `ShareSheet`) | 사용자가 저장 위치 선택 (iCloud Drive 포함) | 제외 |

## 2. 판단 — 지금 도입하지 않는 이유

1. **정본이 이미 서버에 있다.** 기록은 Supabase 에 저장되므로 "기기 분실·재설치 시 복구"라는
   iCloud 의 핵심 가치가 이미 충족된다. 저장소를 둘로 늘리면 그 시점부터 "어느 쪽이 최신인가"를
   해결하는 동기화·충돌 코드가 영구히 따라붙는다.
2. **"내 데이터 소유" 가치는 GPX 내보내기가 이미 커버한다.** 공유 시트에서 "파일에 저장 →
   iCloud Drive" 를 고르면 지금도 개인 iCloud 에 들어간다. 남는 차이는 자동화뿐이고,
   등산 기록은 하루 1건 수준이라 자동화의 체감 이득이 작다.
3. **도입 비용이 기능 크기에 비해 크다.** 유료 개발자 계정 entitlement, 컨테이너 설정,
   iCloud 미로그인/비활성 폴백, 충돌 해결, 심사 시 데이터 성격 소명.
4. **웹앱 병행을 깨뜨린다.** CloudKit 으로 기록을 옮기면 웹에서 같은 기록을 볼 수 없다
   (CloudKit JS 는 Apple ID 로그인이 별도로 필요해 사실상 다른 계정 체계가 된다).
   `CLAUDE.md` 의 웹/네이티브 병행 전제와 정면으로 부딪힌다.

## 3. 선행 과제 — 팩 디렉터리 백업 제외 (iCloud 도입과 무관, 우선순위 높음)

### 문제
팩은 Application Support 아래에 있어 **기본적으로 iCloud·Finder 백업에 포함된다**.
산 여러 개를 저장하면 수백 MB 가 사용자 iCloud 용량을 잡아먹고 기기 교체 복원도 그만큼 느려진다.
게다가 이 데이터는 R2 에서 언제든 다시 받을 수 있는 캐시 — Apple 의 iOS Data Storage Guidelines 는
재생성 가능한 데이터를 백업 대상에 두는 것을 금지하며, 용량이 크면 실제 심사 리젝 사유가 된다.

### 왜 Caches 로 옮기지 않는가
Caches 는 저장공간 부족 시 iOS 가 **예고 없이 지운다**. 오프라인 지도가 산속에서 사라지는 것은
이 앱에서 가장 치명적인 실패다. 정석은 **"Application Support 에 두되(시스템이 못 지움)
백업 플래그만 끈다"** — 이것이 `isExcludedFromBackup` 이 존재하는 이유다.

### 적용
`PackStore.download` 의 `createDirectory` 직후 (`PackStore.swift` 다운로드 시작부):

```swift
try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
var d = dir                                   // setResourceValues 가 mutating 이라 var 필요
var rv = URLResourceValues()
rv.isExcludedFromBackup = true
try? d.setResourceValues(rv)
```

디렉터리에 걸면 하위 파일까지 함께 제외된다. 동작 변화는 없고 백업에서만 빠진다.
**이미 설치된 팩**에도 즉시 적용하려면 `PackStore.refresh()` 에서 기존 `packDir` 들에도 한 번 건다
(또는 `root` 에 한 번). 앱 재설치 없이 반영하려면 이쪽이 필요하다.

### 검증
기기에서 **설정 → Apple 계정 → iCloud → 백업 → 이 iPhone → HiHeight** 크기 확인.
적용 전에는 저장한 팩 용량만큼 잡혀 있고, 적용 후 재다운로드하면 0 에 가까워진다.

## 4. 재검토 트리거

아래 중 **하나라도 사실이 되면** §5 를 실행 검토한다. 그 전까지는 보류를 유지한다.

- 비로그인 사용자에게도 등반 기록을 남겨주기로 결정 (Apple ID 가 곧 계정이 되므로 CloudKit 이 강력)
- Supabase 의존·비용을 걷어내기로 결정
- 기기 간 자동 동기화(아이폰↔아이패드) 요구가 실제로 발생
- 사용자가 "기록이 날아갈까 걱정된다"고 실제로 말함 — 지금은 가정이고, 그때는 근거다

## 5. 적용 계획 (트리거 발생 시)

### 5-A. iCloud Drive 파일 저장 — 저비용, 권장 1순위
**대상:** 완료된 등반 기록의 GPX/JSON **백업·내보내기**. Supabase 는 정본으로 유지.

- `FileManager.url(forUbiquityContainerIdentifier:)` 아래에 파일을 쓰면 iCloud 가 동기화한다.
- `Info.plist` 의 `NSUbiquitousContainers` 로 Files 앱에 노출하면 사용자가 직접 꺼내 볼 수 있다.
- 이미 GPX 생성기(`RouteGPX`)와 공유 시트가 있으므로 **저장 위치만 바꾸는 수준**의 작업.
- 웹앱 연동을 깨지 않으면서 "내 데이터는 내 iCloud 에도 있다"를 만족시킨다.

**작업 항목**
1. Xcode capability: iCloud → iCloud Documents, 컨테이너 생성
2. 컨테이너 URL 헬퍼 + iCloud 미사용 시 로컬 폴백
3. 등반 종료 후 GPX 자동 기록 (기존 `writeTemp` 경로 재사용)
4. 기록 탭 전체 내보내기(모든 기록 일괄) — 개별 GPX 는 이미 됨

### 5-B. CloudKit private database — 비로그인 기록 지원 시
**대상:** 기록 자체를 레코드 단위로 동기화.

- `NSPersistentCloudKitContainer` 또는 SwiftData + `.automatic`.
- 별도 로그인 없이 Apple ID 를 그대로 쓴다 → **비로그인 사용자 기록 지원의 정답**.
- 구조: CloudKit 을 로컬 저장소 겸 동기화 계층으로 두고, 로그인 시 Supabase 로 승격.
- ⚠️ 웹에서 이 기록을 볼 수 없다는 제약을 반드시 함께 결정해야 한다.

### 5-C. 채택하지 않음
- `NSUbiquitousKeyValueStore` — 1MB 한계. 트랙에는 부적합(설정값 정도만).

## 6. 전제 조건 (5-A·5-B 공통)

- 유료 Apple Developer Program 멤버십 (무료 프로비저닝으로는 iCloud entitlement 불가)
- `com.apple.developer.icloud-container-identifiers` entitlement + 컨테이너 생성
- 사용자가 iCloud 로그인 상태여야 하고 언제든 끌 수 있음 → **로컬 폴백은 항상 필요**
- 용량은 사용자 쿼터 소모. 트랙 자체는 작다 — 1초 간격 3시간 ≈ 1만 포인트 ≈ NDJSON 400KB

## 7. iCloud 에 올리지 말 것

| 대상 | 이유 |
|---|---|
| 진행 중 세션 파일 `climb-session.ndjson` | 초당 append 라 동기화 트래픽·충돌만 늘고, 어차피 같은 기기 복구용. 종료 후 결과만 올린다 |
| 팩 파일 (pmtiles·geojson) | 수십~수백 MB 이고 재다운로드 가능. 심사 가이드라인 위반 소지 (→ §3 대로 백업 제외가 정답) |

## 8. 웹앱 영향

iCloud 는 네이티브 전용이라 웹에는 대응물이 없다. `CLAUDE.md` 의 "웹 80% → iOS 네이티브"
로드맵상 **웹 단계에서는 설계만 비워두고 네이티브 이식 때 붙이는 항목**이다.
5-A(파일 백업)는 웹 연동에 영향이 없고, 5-B(CloudKit 정본화)는 웹 기록 열람을 포기하는 결정이다.
