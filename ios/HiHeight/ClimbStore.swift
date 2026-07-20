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
    let plannedDistanceKm: Double?   // 코스 계획 거리 — 실측 고도 없을 때 진행률 비례 추정에 사용
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
    @Published var fitRequested = false   // 추천/외부 진입 시 코스 로드 후 지도 fitBounds 요청
    @Published var recordTrack: [[Double]]?  // 기록 루트 보기 — 지도에 표시할 트랙(없으면 nil)

    // 트래킹 세션 상태 (HUD 표시용)
    @Published var tracking = false
    @Published var elapsed = 0            // 경과(초)
    @Published var distance = 0.0         // 이동 거리(m)
    @Published var track: [[Double]] = [] // [lng, lat, 고도(m·없으면 -1), unix초]
    @Published var note: String?         // 위치 접근 실패 등 안내
    @Published var currentCoord: CLLocationCoordinate2D?  // 최신 GPS 위치(국가지점번호용)

    var pointCount: Int { track.count }

    // 강제 종료/크래시로 중단된 직전 세션(앱 시작 시 checkPending 이 채움) — 복구 안내에 사용.
    @Published var pending: PendingSession?
    // 복구된 세션의 코스명 — 팩 로드 후 같은 이름의 코스를 다시 선택하는 데 쓴다.
    var restoredCourseName: String?

    private let manager = CLLocationManager()
    private var startedAt: Date?
    private var timer: Timer?
    private var last: CLLocation?
    private var sessionHandle: FileHandle?      // 진행 중 세션 append 핸들

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .fitness
        // 등산 중 iOS 가 "멈춘 것 같다"고 판단해 업데이트를 일시정지하면 트랙이 끊긴다 → 비활성화.
        manager.pausesLocationUpdatesAutomatically = false
    }

    // 중단된 세션 스냅샷 — 파일에서 복원한 값.
    struct PendingSession {
        let mountainCode: String?
        let courseName: String
        let plannedAscent: Int?
        let plannedDistanceKm: Double?
        let startedAt: Date
        let track: [[Double]]
        let distance: Double        // m (점들로 재계산)
    }

    // MARK: 세션 제어
    func start() {
        guard let _ = course, !tracking else { return }
        startedAt = Date(); track = []; distance = 0; elapsed = 0; last = nil; note = nil
        recordTrack = nil          // 등반 시작 → 기록 루트 표시 지움
        tracking = true
        restoredCourseName = nil
        beginSessionFile()          // 강제 종료 대비 — 진행 중 계속 append
        startTimer()
        manager.requestWhenInUseAuthorization()
        startUpdates()
    }

    // 경과 타이머 (1초)
    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, let s = self.startedAt else { return }
            self.elapsed = Int(Date().timeIntervalSince(s))
        }
    }

    // 화면 잠금·앱 이탈 중에도 계속 기록(§7-1). Background Modes(location) 필요 —
    // 없으면 allowsBackgroundLocationUpdates 설정이 크래시하므로 project.yml 과 짝을 이룬다.
    private func startUpdates() {
        manager.allowsBackgroundLocationUpdates = true
        manager.startUpdatingLocation()
    }

    // 트랙 반환. 세션 종료·리셋(라이브 트랙 지움 — 종료 후 지도에서 사라지게).
    @discardableResult
    func stop() -> [[Double]] {
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false   // 백그라운드 위치 해제(배터리)
        timer?.invalidate(); timer = nil
        tracking = false
        currentCoord = nil
        restoredCourseName = nil
        endSessionFile()    // 정상 종료 → 복구 파일 제거
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
                          distanceKm: distance / 1000, plannedAscent: c.ascent,
                          plannedDistanceKm: c.distance_km, track: t)
    }

    // MARK: CLLocationManagerDelegate (main 스레드 전달 — manager 를 main 에서 생성)
    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard tracking, let loc = locs.last else { return }
        // 정확도 게이트 — 무효(-1)/부정확(>50m) 고정은 무시(포인터 튐·트랙 오염 방지).
        // 나쁜 고정 시엔 마지막 양호 위치를 유지(엉뚱한 곳으로 점프하지 않게).
        if loc.horizontalAccuracy < 0 || loc.horizontalAccuracy > 50 { return }
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
        let pt: [Double] = [ (c.longitude * 1e6).rounded() / 1e6,
                             (c.latitude  * 1e6).rounded() / 1e6,
                             ele, Double(Int(Date().timeIntervalSince1970)) ]
        track.append(pt)
        appendLine(pt)          // 강제 종료 대비 즉시 기록(종료 콜백은 신뢰 불가)
    }

    // MARK: 세션 영속화·복구 (강제 종료/크래시 대비)
    // 앱 스위처 강제 종료는 종료 콜백이 보장되지 않고, 사용자가 종료한 앱은 위치 이벤트로 재실행되지도
    // 않는다. 따라서 "종료를 막는" 대신 진행 중에 계속 append 해 두고 재실행 때 복구한다(IOS.md §9 S3).
    // 포맷(NDJSON): 1행=메타, 이후 각 행=[lng,lat,고도,unix초]. append 라 중간에 죽어도 직전까지 남는다.
    private static var sessionURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("climb-session.ndjson")
    }

    private func beginSessionFile() {
        let url = Self.sessionURL
        try? FileManager.default.removeItem(at: url)
        FileManager.default.createFile(atPath: url.path, contents: nil)
        sessionHandle = try? FileHandle(forWritingTo: url)
        var meta: [String: Any] = ["v": 1,
                                   "courseName": course?.name ?? "",
                                   "startedAt": (startedAt ?? Date()).timeIntervalSince1970]
        if let mc = mountainCode { meta["mountainCode"] = mc }
        if let a = course?.ascent { meta["ascent"] = a }
        if let ck = course?.distance_km { meta["courseKm"] = ck }
        appendLine(meta)
    }

    private func appendLine(_ obj: Any) {
        guard let h = sessionHandle, let d = try? JSONSerialization.data(withJSONObject: obj) else { return }
        // write(2) 는 커널 버퍼로 즉시 넘어가므로 앱이 죽어도 남는다(전원 차단만 예외).
        try? h.write(contentsOf: d)
        try? h.write(contentsOf: Data("\n".utf8))
    }

    private func endSessionFile() {
        try? sessionHandle?.close(); sessionHandle = nil
        try? FileManager.default.removeItem(at: Self.sessionURL)
    }

    // 앱 시작 시 호출 — 중단된 세션이 있으면 pending 에 채운다.
    func checkPending() { pending = Self.loadPending() }

    func discardPending() {
        pending = nil
        try? FileManager.default.removeItem(at: Self.sessionURL)
    }

    private static func loadPending() -> PendingSession? {
        guard let text = try? String(contentsOf: sessionURL, encoding: .utf8) else { return nil }
        var lines = text.split(separator: "\n").map(String.init)
        guard !lines.isEmpty,
              let md = lines.removeFirst().data(using: .utf8),
              let meta = try? JSONSerialization.jsonObject(with: md) as? [String: Any],
              let started = meta["startedAt"] as? Double else { return nil }
        var pts: [[Double]] = []
        for l in lines {                                  // 마지막 줄이 깨졌을 수 있어 관대하게 파싱
            guard let d = l.data(using: .utf8),
                  let p = try? JSONSerialization.jsonObject(with: d) as? [Double], p.count >= 4 else { continue }
            pts.append(p)
        }
        guard !pts.isEmpty else { return nil }            // 점이 없으면 복구 가치 없음
        var dist = 0.0
        for i in 1..<pts.count {
            dist += CLLocation(latitude: pts[i][1], longitude: pts[i][0])
                .distance(from: CLLocation(latitude: pts[i-1][1], longitude: pts[i-1][0]))
        }
        return PendingSession(mountainCode: meta["mountainCode"] as? String,
                              courseName: meta["courseName"] as? String ?? "",
                              plannedAscent: meta["ascent"] as? Int,
                              plannedDistanceKm: meta["courseKm"] as? Double,
                              startedAt: Date(timeIntervalSince1970: started),
                              track: pts, distance: dist)
    }

    // 이어서 계속 — 상태를 되살리고 같은 파일에 이어서 append.
    func resume(_ s: PendingSession) {
        startedAt = s.startedAt
        track = s.track
        distance = s.distance
        elapsed = Int(Date().timeIntervalSince(s.startedAt))
        mountainCode = s.mountainCode
        restoredCourseName = s.courseName.isEmpty ? nil : s.courseName
        last = s.track.last.map { CLLocation(latitude: $0[1], longitude: $0[0]) }
        recordTrack = nil
        note = nil
        tracking = true
        pending = nil
        sessionHandle = try? FileHandle(forWritingTo: Self.sessionURL)
        _ = try? sessionHandle?.seekToEnd()
        startTimer()
        manager.requestWhenInUseAuthorization()
        startUpdates()
    }

    // 이어서 하지 않고 여기까지를 기록으로 저장할 때 쓰는 드래프트(코스 객체 없이도 구성 가능).
    func draft(from s: PendingSession) -> ClimbDraft {
        ClimbDraft(mountainCode: s.mountainCode,
                   courseName: s.courseName.isEmpty ? "등반" : s.courseName,
                   startedAt: s.startedAt,
                   endedAt: s.track.last.map { Date(timeIntervalSince1970: $0[3]) } ?? Date(),
                   distanceKm: s.distance / 1000,
                   plannedAscent: s.plannedAscent,
                   plannedDistanceKm: s.plannedDistanceKm,
                   track: s.track)
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
