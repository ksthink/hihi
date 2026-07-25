# 개발자 모드 (iOS) — 테스트용, 삭제 가능

기록 → 프로필 수정 → 로그아웃 아래 **개발자 모드** 토글로 켠다. 켜지면 모든 탭 위에
떠 있는 HUD 로 지도 상태·GPS 좌표·콘솔 로그·빌드 정보를 본다. 드래그로 옮기고,
⌃ 로 접고, ✕ 로 숨긴다(개발자 모드 자체는 토글로 끈다).

## 구성

전용 폴더 `HiHeight/DevMode/` 에 모여 있다.

| 파일 | 역할 |
|---|---|
| `DevStore.swift` | 싱글턴 상태 + 콘솔 로그 수집(stdout/stderr `dup2` 가로채기, Xcode 콘솔로 tee) + 자체 `CLLocationManager` |
| `DevHUD.swift` | 떠 있는 패널 UI (지도·GPS·콘솔·빌드 4구획) |
| `DevGate.swift` | 프로필 화면 진입 토글 |

## 완전 삭제 절차

```bash
# 1) 폴더 삭제
rm -rf ios/HiHeight/DevMode

# 2) 표식 붙은 삽입점 제거 — 전부 단독 줄이라 그 줄만 지우면 된다
grep -rn "DEVMODE" ios --include='*.swift' --include='*.yml' --include='*.sh'
#   MapView.swift        DevStore.shared.updateMap(...) 한 줄
#   ProfileEditView.swift DevGate() 한 줄
#   ContentView.swift     .overlay { DevHUD() } 한 줄
#   project.yml           GIT_COMMIT 기본값 · GitCommit info 키 (각 한 줄)
#   testflight.sh         COMMIT= · GIT_COMMIT= (각 한 줄, 남겨도 무해)

# 3) 프로젝트 재생성 (DevMode/ 는 글롭 포함이라 자동 제외)
cd ios && xcodegen generate
```

삭제 후에도 빌드가 통과함을 리허설로 확인했다(기존 스토어에 새 배선을 넣지 않아
다른 파일 로직이 원상 그대로다).

## 알아둘 것

- **콘솔 로그는 stdout/stderr 를 통째로 가로챈다.** 앱에 `print` 가 없어 자체 로그 함수로는
  잡을 게 없다. MapLibre 네이티브 출력까지 잡히고, 끄면 `dup2` 원복 → 흔적 없음.
- **GPS 는 DevStore 자체 매니저**라 등반 중이 아니어도 좌표가 뜬다. 권한은 앱이 이미
  등반용으로 받는 것과 같다.
- **커밋 해시**는 `testflight.sh` 로 빌드할 때만 구워진다(`GitCommit`). 로컬 빌드는 "local".
