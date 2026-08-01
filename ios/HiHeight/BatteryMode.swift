import Foundation

// 등반 배터리 모드 (IOS.md §7-5) — 렌더·화면 비용을 단계별로 끈다.
// 배경: 네비 모드(화면 켜고 1Hz 지도 갱신) 실측 42~65%/h (2026-08-01).
//
// ⚠️ **어느 모드든 GPS 기록은 1Hz 로 동일하다.** 스로틀은 화면 표시에만 걸리며
//    트랙·거리·누적고도 통계는 무손실이다. 설정 UI 도 이 사실을 반드시 밝힌다
//    (사용자가 "절전 = 기록이 성겨진다"로 오해하면 안 켠다).
enum BatteryMode: String, CaseIterable, Identifiable {
    case normal, saver, max

    var id: String { rawValue }

    var label: String {
        switch self {
        case .normal: return "일반"
        case .saver:  return "절전"
        case .max:    return "최대절전"
        }
    }

    // 초 단위·기술 용어는 노출하지 않는다(IOS.md §7-5) — 무엇이 달라지는지만 한 줄로.
    var detail: String {
        switch self {
        case .normal: return "지도를 계속 따라 움직입니다. 배터리를 가장 많이 씁니다."
        case .saver:  return "지도는 그대로, 화면 갱신만 줄입니다. 멈춰 있으면 갱신도 멈춥니다."
        case .max:    return "지도를 끄고 방향·거리·고도만 크게 봅니다. 가장 오래갑니다."
        }
    }

    // 절전 계열에서 지도 갱신을 스로틀하는가.
    var throttlesMap: Bool { self == .saver }
    // 등반 시작과 동시에 내비(지도 없는 화면)로 들어가는가.
    var entersNav: Bool { self == .max }

    // UserDefaults 키 — ClimbStore 가 세션 시작 시점 값을 읽어 진단에 남긴다.
    // (ClimbSettings 는 @MainActor 라 격리 밖에서 못 쓴다 — 키만 여기에 둔다.)
    static let storageKey = "hiheight-battery-mode"   // 관례 접두사 hiheight-

    static func saved() -> BatteryMode {
        BatteryMode(rawValue: UserDefaults.standard.string(forKey: storageKey) ?? "") ?? .normal
    }
}

// 등반 관련 사용자 설정 — 기록 탭 → 프로필 → 설정에서 바꾸고 UserDefaults 에 남는다.
// 등반 시작 시점의 값을 세션 내내 쓴다(중간에 바뀌어도 진행 중 세션은 그대로).
@MainActor
final class ClimbSettings: ObservableObject {
    static let shared = ClimbSettings()

    @Published var batteryMode: BatteryMode {
        didSet { UserDefaults.standard.set(batteryMode.rawValue, forKey: BatteryMode.storageKey) }
    }

    private init() { batteryMode = BatteryMode.saved() }
}
