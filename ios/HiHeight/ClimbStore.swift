import Foundation
import CoreLocation
import UIKit   // UIDevice — 진단 계측의 배터리 잔량

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
    let diag: ClimbDiag?      // 진단 요약 — track.meta 로 저장(관리자 콘솔 열람용)
}

// 등반 1회의 진단 요약 — 백그라운드 GPS 가 배터리를 얼마나 먹는지 기기별로 보려고 모은다.
// 개발자 모드 HUD(DevMode/)의 실시간 계측과 목적은 같지만, 이쪽은 **모든 사용자**의 등반에서
// 최소값만 수집해 climb_records.track.meta 로 올라간다(2026-07-29).
// ⚠️ 소모량은 기기 전체 값이다 — 앱별 소비 전력을 주는 API 는 iOS 에 없다.
struct ClimbDiag {
    let batStart: Int        // 0~100, -1 = 미지원(시뮬레이터)
    let batEnd: Int
    let lowPower: Bool       // 시작 시점 저전력 모드
    let charged: Bool        // 등반 중 충전 정황(종료 잔량 > 시작 잔량) — 이 경우 소모량은 무의미
    let gpsMode: String      // desiredAccuracy 라벨 ("Best" 등)
    let fixes: Int           // 수신한 위치 총 수
    let fixesDropped: Int    // 정확도 게이트(<0 또는 >50m)로 버린 수 — 신호 품질의 직접 지표
    let accAvg: Double       // 게이트를 통과한 fix 의 평균 수평정확도(m). 표본 없으면 -1
    // ── 계측 보강 (IOS.md §7-4, 2026-07-31 분석에서 필요성 확인) ──
    // Best 1Hz 27분 측정이 11.1%/h 로 예산(4h ≤25% = 6.25%/h)의 1.8배였는데,
    // ① 화면 기여분과 GPS 기여분을 나눌 수 없었고 ② 잔량 15% 구간이라 저전력모드가
    // 중간에 켜졌는지도 알 수 없었다. 아래 셋이 그 두 구멍을 메운다.
    let lpm: Bool            // 세션 중 **1회라도** 저전력 모드였나 (lowPower 는 시작 시점만)
    let fgSec: Int           // 전경(화면 켜짐) 누적 초 — 화면 기여분 분리용
    let bgSec: Int           // 백그라운드 누적 초 — 순수 GPS 기여분 추정용
    // 등반 배터리 모드(IOS.md §7-5) — 모드별 %/h 를 관리자 표에서 비교하려면 어느 모드로
    // 걸었는지 알아야 한다. 세션 시작 시점 값으로 고정(중간에 설정을 바꿔도 이 세션은 그대로).
    let batMode: String      // "normal" | "saver" | "max"
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
    // 기록 루트 보기 — 보고 있는 기록(없으면 nil). 전용 루트 뷰 모드의 단일 소스.
    // 지도에 그릴 트랙은 여기서 파생(recordTrack) — 두 상태가 어긋나지 않게 하나로 관리한다.
    @Published var routeRecord: ClimbRecord?
    var recordTrack: [[Double]]? { routeRecord?.trackPoints }

    // 트래킹 세션 상태 (HUD 표시용)
    @Published var tracking = false
    @Published var elapsed = 0            // 경과(초)
    @Published var distance = 0.0         // 이동 거리(m)
    @Published var track: [[Double]] = [] // [lng, lat, 고도(m·없으면 -1), unix초]
    @Published var note: String?         // 위치 접근 실패 등 안내
    @Published var currentCoord: CLLocationCoordinate2D?  // 최신 GPS 위치(국가지점번호용)
    @Published var currentAltitude: Double = -1           // 최신 고도(m). -1 = 미측정
    // 기기 방향 — 내비 화면(NavView) 전용. ⚠️ 자력계는 산에서 철 구조물·기기 간섭으로 어긋나며,
    // 틀린 방향을 자신 있게 가리키는 것은 안 보여주는 것보다 위험하다(2026-07-28 헤딩 화살표
    // 제거 사유). 그래서 정확도를 함께 공개해 화면이 신뢰도를 드러내게 한다.
    // 자력계는 소모가 있으므로 내비 화면에 있는 동안만 구독한다(startHeading/stopHeading).
    @Published var heading: Double = -1                   // 진북 기준 0~360°. -1 = 없음
    @Published var headingAccuracy: Double = -1           // ±°. 음수면 무효

    var pointCount: Int { track.count }

    // 강제 종료/크래시로 중단된 직전 세션(앱 시작 시 checkPending 이 채움) — 복구 안내에 사용.
    @Published var pending: PendingSession?
    // 복구된 세션의 코스명 — 팩 로드 후 같은 이름의 코스를 다시 선택하는 데 쓴다.
    var restoredCourseName: String?
    // 추천 큐레이션에서 특정 코스로 진입할 때의 코스명. 1회용(적용되면 nil).
    // 소비 경로가 둘이라 @Published — ① 산이 바뀌면 팩 로드 후 ExploreView.task 가 매칭,
    // ② 같은 산이면 task 가 안 돌므로(id 불변) onChange 가 이미 로드된 목록에서 매칭.
    // ②가 없으면 이미 그 산을 보고 있을 때 코스가 바뀌지 않는다.
    @Published var wantedCourseName: String?

    private let manager = CLLocationManager()
    private var startedAt: Date?
    private var timer: Timer?
    private var last: CLLocation?
    private var sessionHandle: FileHandle?      // 진행 중 세션 append 핸들

    // 진단 계측 누적치 — start()/resume() 에서 초기화, finish() 에서 ClimbDiag 로 확정.
    private var diagBatStart = -1
    private var diagLowPower = false
    private var diagFixes = 0
    private var diagDropped = 0
    private var diagAccSum = 0.0
    private var diagAccN = 0
    // §7-4 — 저전력모드는 "세션 중 1회라도"를 봐야 한다(잔량이 떨어져 중간에 켜지는 경우가 많다).
    // 전경/배경 시간은 scenePhase 전환마다 직전 구간을 누적한다(ContentView 가 notePhase 로 알림).
    private var diagLpm = false
    private var diagFg: TimeInterval = 0
    private var diagBg: TimeInterval = 0
    private var diagBatMode = BatteryMode.normal.rawValue   // 세션 시작 시점의 배터리 모드
    private var diagPhaseAt: Date?          // 현재 구간이 시작된 시각
    private var diagForeground = true       // 현재 구간이 전경인가
    private var lpmObserver: NSObjectProtocol?

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
        routeRecord = nil          // 등반 시작 → 기록 루트 표시 지움
        tracking = true
        restoredCourseName = nil
        beginDiag()                 // 진단 계측 시작(배터리 시작 잔량·저전력 모드)
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
        stopHeading()       // 내비 화면을 띄운 채 종료해도 자력계가 남지 않게
        flushPhase()        // 종료 시점까지의 구간을 전경/배경 누적에 반영(endDiag 가 읽는다)
        endDiagWatch()      // 저전력모드 관찰 해제 — 취소 경로(finish 없이 stop)에서도 새지 않게
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
                          plannedDistanceKm: c.distance_km, track: t, diag: endDiag())
    }

    // MARK: 진단 계측
    // 배터리 모니터링 플래그는 전역이고 켜는 건 idempotent 라 매번 보장한다 — 개발자 모드
    // (DevStore)가 꺼져도 등반 계측이 영향받지 않게.
    private func batteryPercent() -> Int {
        UIDevice.current.isBatteryMonitoringEnabled = true
        let l = UIDevice.current.batteryLevel
        return l < 0 ? -1 : Int((l * 100).rounded())
    }

    private func beginDiag() {
        diagBatStart = batteryPercent()
        diagLowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
        diagFixes = 0; diagDropped = 0; diagAccSum = 0; diagAccN = 0
        // 배터리 모드는 **시작 시점 값으로 고정** — 진행 중 설정을 바꿔도 이 세션의 통계는
        // 한 모드로 잰 값이어야 관리자 표의 모드별 비교가 성립한다(IOS.md §7-5).
        diagBatMode = BatteryMode.saved().rawValue
        // 등반 시작은 항상 전경이다(사용자가 버튼을 눌렀다).
        diagLpm = diagLowPower
        diagFg = 0; diagBg = 0
        diagForeground = true
        diagPhaseAt = Date()
        // 세션 도중 저전력 모드가 켜지는 순간을 잡는다 — 시작 시점만 보면 놓친다.
        lpmObserver = NotificationCenter.default.addObserver(
            forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main
        ) { [weak self] _ in
            if ProcessInfo.processInfo.isLowPowerModeEnabled { self?.diagLpm = true }
        }
    }

    // scenePhase 전환 — ContentView 가 알려준다. 화면이 켜져 있던 시간과 아닌 시간을 나눠야
    // 소모에서 화면 기여분과 GPS 기여분을 분리할 수 있다(IOS.md §7-4).
    func notePhase(foreground: Bool) {
        guard tracking, foreground != diagForeground else { return }
        flushPhase()
        diagForeground = foreground
    }

    // 직전 구간의 경과를 전경/배경 누적에 반영하고 구간을 다시 연다.
    private func flushPhase() {
        guard let at = diagPhaseAt else { return }
        let d = Date().timeIntervalSince(at)
        if diagForeground { diagFg += d } else { diagBg += d }
        diagPhaseAt = Date()
    }

    private func endDiagWatch() {
        if let o = lpmObserver { NotificationCenter.default.removeObserver(o); lpmObserver = nil }
    }

    private func endDiag() -> ClimbDiag {
        let end = batteryPercent()
        return ClimbDiag(
            batStart: diagBatStart, batEnd: end,
            lowPower: diagLowPower,
            charged: diagBatStart >= 0 && end > diagBatStart,
            gpsMode: Self.accuracyLabel(manager.desiredAccuracy),
            fixes: diagFixes, fixesDropped: diagDropped,
            accAvg: diagAccN > 0 ? ((diagAccSum / Double(diagAccN)) * 10).rounded() / 10 : -1,
            lpm: diagLpm,
            fgSec: Int(diagFg.rounded()), bgSec: Int(diagBg.rounded()),
            batMode: diagBatMode)
    }

    private static func accuracyLabel(_ a: CLLocationAccuracy) -> String {
        switch a {
        case kCLLocationAccuracyBestForNavigation: return "BestForNav"
        case kCLLocationAccuracyBest:              return "Best"
        case kCLLocationAccuracyNearestTenMeters:  return "10m"
        case kCLLocationAccuracyHundredMeters:     return "100m"
        default: return String(format: "%.0fm", a)
        }
    }

    // MARK: CLLocationManagerDelegate (main 스레드 전달 — manager 를 main 에서 생성)
    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard tracking, let loc = locs.last else { return }
        diagFixes += 1                              // 진단 — 수신 총량(게이트 이전)
        // 정확도 게이트 — 무효(-1)/부정확(>50m) 고정은 무시(포인터 튐·트랙 오염 방지).
        // 나쁜 고정 시엔 마지막 양호 위치를 유지(엉뚱한 곳으로 점프하지 않게).
        if loc.horizontalAccuracy < 0 || loc.horizontalAccuracy > 50 { diagDropped += 1; return }
        diagAccSum += loc.horizontalAccuracy; diagAccN += 1   // 진단 — 통과분 평균 정확도
        if note != nil { note = nil }               // 위치 수신 성공 → 이전 일시 오류 안내 해제
        currentCoord = loc.coordinate               // 국가지점번호는 매 위치마다 갱신(5m 게이트 이전)
        currentAltitude = loc.verticalAccuracy >= 0 ? loc.altitude : -1   // 내비 화면 고도 표시
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
        routeRecord = nil
        note = nil
        tracking = true
        pending = nil
        // 진단 — 이어하기는 중단 전 소모를 알 수 없으므로 배터리는 측정 불가로 두고(-1),
        // GPS 통계만 재개 시점부터 다시 센다. 시작 잔량을 지금 값으로 잡으면 소모가 축소된다.
        beginDiag()
        diagBatStart = -1
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
                   track: s.track, diag: nil)   // 복구본만 저장 — 계측한 세션이 아니라 진단 없음
    }

    // MARK: 기기 방향 — 내비 화면에 있는 동안만 구독(자력계 소모).
    func startHeading() {
        guard CLLocationManager.headingAvailable() else { return }
        manager.headingFilter = 2                   // 2° 미만 변화는 무시(화살표 떨림·소모 억제)
        manager.startUpdatingHeading()
    }

    func stopHeading() {
        manager.stopUpdatingHeading()
        heading = -1; headingAccuracy = -1
    }

    func locationManager(_ m: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        // trueHeading 은 위치가 있어야 나온다(자북→진북 보정). 없으면 자북 값으로 대체하되
        // 정확도를 그대로 노출해 화면이 "믿을 수 없음"을 표시할 수 있게 한다.
        headingAccuracy = newHeading.headingAccuracy
        heading = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
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
