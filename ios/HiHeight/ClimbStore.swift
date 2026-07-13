import Foundation
import CoreLocation

// 종료 시점 스냅샷 — AuthStore.saveClimb 이 climb_records 로 변환/삽입한다.
struct ClimbDraft {
    let mountainCode: String?
    let courseName: String
    let startedAt: Date
    let endedAt: Date
    let distanceKm: Double
    let plannedAscent: Int?
    let track: [[Double]]     // [lng, lat, 고도(m·-1=없음), unix초]
}

// 등반 세션 관리 — 웹 startClimb/stopClimb(app.js:1362-1446) 이식.
// 탐험 탭에서 고른 코스를 공유하고, 등반 시작 시 CoreLocation 으로 전경 트래킹한다.
// (M5-S1: 전경 GPS + HUD + 라이브 트랙. 저장은 M5-S2, 백그라운드 지속은 M5-S3.)
final class ClimbStore: NSObject, ObservableObject, CLLocationManagerDelegate {
    // 선택 코스(등반 카드/시종점)
    @Published var course: Course?
    @Published var mountainName: String?
    @Published var mountainCode: String?  // climb_records.mountain_id 용
    @Published var saveResult: String?    // 종료 후 저장 결과 배너
    @Published var recordTrack: [[Double]]?  // 기록 루트 보기 — 지도에 표시할 트랙(없으면 nil)

    // 트래킹 세션 상태 (HUD 표시용)
    @Published var tracking = false
    @Published var elapsed = 0            // 경과(초)
    @Published var distance = 0.0         // 이동 거리(m)
    @Published var track: [[Double]] = [] // [lng, lat, 고도(m·없으면 -1), unix초]
    @Published var note: String?         // 위치 접근 실패 등 안내
    @Published var currentCoord: CLLocationCoordinate2D?  // 최신 GPS 위치(국가지점번호용)

    var pointCount: Int { track.count }

    private let manager = CLLocationManager()
    private var startedAt: Date?
    private var timer: Timer?
    private var last: CLLocation?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .fitness
    }

    // MARK: 세션 제어
    func start() {
        guard let _ = course, !tracking else { return }
        startedAt = Date(); track = []; distance = 0; elapsed = 0; last = nil; note = nil
        recordTrack = nil          // 등반 시작 → 기록 루트 표시 지움
        tracking = true

        // 경과 타이머 (1초)
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, let s = self.startedAt else { return }
            self.elapsed = Int(Date().timeIntervalSince(s))
        }

        manager.requestWhenInUseAuthorization()
        manager.startUpdatingLocation()
    }

    // 트랙 반환. 세션 종료·리셋(라이브 트랙 지움 — 종료 후 지도에서 사라지게).
    @discardableResult
    func stop() -> [[Double]] {
        manager.stopUpdatingLocation()
        timer?.invalidate(); timer = nil
        tracking = false
        currentCoord = nil
        let captured = track
        track = []          // 라이브 climb-track 소스 비우기(웹 applyClimbRoute 종료 동작)
        return captured
    }

    // 종료 + 저장용 드래프트 산출(웹 saveClimb 입력). 세션이 없으면 nil.
    func finish() -> ClimbDraft? {
        guard tracking, let started = startedAt, let c = course else { stop(); return nil }
        let ended = Date()
        let t = stop()
        return ClimbDraft(mountainCode: mountainCode, courseName: c.name,
                          startedAt: started, endedAt: ended,
                          distanceKm: distance / 1000, plannedAscent: c.ascent, track: t)
    }

    // MARK: CLLocationManagerDelegate (main 스레드 전달 — manager 를 main 에서 생성)
    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard tracking, let loc = locs.last else { return }
        if note != nil { note = nil }               // 위치 수신 성공 → 이전 일시 오류 안내 해제
        currentCoord = loc.coordinate               // 국가지점번호는 매 위치마다 갱신(5m 게이트 이전)
        // 잡음 제거: 직전 점에서 5m 미만 이동은 무시(app.js:1413)
        if let last {
            let d = loc.distance(from: last)
            if d < 5 { return }
            distance += d
        }
        last = loc
        let ele = loc.verticalAccuracy >= 0 ? Double(Int(loc.altitude.rounded())) : -1
        let c = loc.coordinate
        track.append([ (c.longitude * 1e6).rounded() / 1e6,
                       (c.latitude  * 1e6).rounded() / 1e6,
                       ele, Double(Int(Date().timeIntervalSince1970)) ])
    }

    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code == .locationUnknown { return }  // 일시 오류 — 곧 복구, 무시
        note = "위치 접근 불가 — 시간 기준으로 기록됩니다."
    }

    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        switch m.authorizationStatus {
        case .denied, .restricted:
            note = "위치 권한이 꺼져 있습니다. 설정에서 허용해 주세요."
        default:
            note = nil
        }
    }
}
