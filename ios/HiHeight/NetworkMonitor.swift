import Foundation
import Network

// 네트워크 연결 상태 감시 — 오프라인 팩 하이브리드에 사용.
// 온라인이면 원격 전국 base(자유 팬), 오프라인이면 다운로드된 로컬 팩 base 로 렌더 전환.
@MainActor
final class NetworkMonitor: ObservableObject {
    static let shared = NetworkMonitor()
    @Published private(set) var isOnline = true      // 기본 true — 첫 업데이트 전엔 온라인 가정

    private let monitor = NWPathMonitor()

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in self?.isOnline = online }
        }
        monitor.start(queue: DispatchQueue(label: "dev.metaphr.hiheight.net"))
    }
}
