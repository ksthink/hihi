import Foundation

// 탐험 탭에서 고른 코스를 등반 탭과 공유한다(웹의 selectedTrail → updateClimb 대응).
// 실시간 트래킹 세션(GPS·HUD·기록 저장)은 M5(CoreLocation) 단계에서 이 스토어에 얹는다.
@MainActor
final class ClimbStore: ObservableObject {
    @Published var course: Course?        // 선택된 등산로(없으면 nil)
    @Published var mountainName: String?  // 선택 코스가 속한 산 이름(카드 배지)
}
