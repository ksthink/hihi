import Foundation
import CoreLocation
import MapLibre

// ─────────────────────────────────────────────────────────────────────────────
//  개발자 모드 — 테스트용. 이 폴더(DevMode/) 전체가 삭제 대상이다.
//  제거 절차:  ① ios/HiHeight/DevMode/ 폴더 삭제
//             ② grep -rn "DEVMODE" ios/  로 나온 삽입점 3곳(주석 표식) 제거
//  기존 스토어에는 새 배선을 넣지 않아, 지우면 다른 파일들의 로직이 원상 그대로다.
// ─────────────────────────────────────────────────────────────────────────────

@MainActor
final class DevStore: ObservableObject {
    static let shared = DevStore()

    private static let key = "hiheight-devmode"   // 관례 접두사 hiheight-

    // 개발자 모드 on/off — 켜면 stdout 가로채기 + 위치 갱신 시작, 끄면 원복.
    @Published var enabled: Bool {
        didSet {
            UserDefaults.standard.set(enabled, forKey: Self.key)
            if enabled { startCapture(); startLocation() }
            else { stopCapture(); stopLocation() }
        }
    }
    // HUD 를 잠깐 접기(개발자 모드 자체는 켜진 상태). 프로필 토글로 끄는 것과 구분.
    @Published var hudVisible = true

    // 지도 상태 — MapView 델리게이트가 이동 종료마다 밀어 올린다.
    struct MapState: Sendable { var lat = 0.0, lng = 0.0, zoom = 0.0, bearing = 0.0, pitch = 0.0, style = "—" }
    @Published var map = MapState()

    // 현재 위치 — DevStore 자체 매니저(등반과 무관하게 상시). ClimbStore 를 건드리지 않는다.
    @Published var coord: CLLocationCoordinate2D?
    @Published var accuracy: Double = -1
    @Published var altitude: Double = 0
    @Published var authText = "미요청"

    // 콘솔 로그 링버퍼(최근 N줄).
    @Published private(set) var logs: [String] = []
    private let logCap = 300

    private let loc = LocationSink()

    private init() {
        enabled = UserDefaults.standard.bool(forKey: Self.key)
        loc.onFix = { [weak self] c, acc, alt in
            Task { @MainActor in self?.coord = c; self?.accuracy = acc; self?.altitude = alt }
        }
        loc.onAuth = { [weak self] t in Task { @MainActor in self?.authText = t } }
        if enabled { startCapture(); startLocation() }
    }

    // MARK: 지도 상태 (MapView 델리게이트에서 호출 — 읽기 전용)
    // 델리게이트(regionDidChangeAnimated)는 메인 스레드에서 불린다. nonisolated 로 두고
    // 값(Sendable)만 읽어 메인 액터에서 반영 — @MainActor 경계 넘기기·Sendable 경고 회피.
    nonisolated func updateMap(_ mv: MLNMapView) {
        let s = MapState(
            lat: mv.centerCoordinate.latitude, lng: mv.centerCoordinate.longitude,
            zoom: mv.zoomLevel, bearing: mv.direction, pitch: mv.camera.pitch,
            style: mv.styleURL?.lastPathComponent ?? "—")
        MainActor.assumeIsolated {
            guard enabled else { return }
            map = s
        }
    }

    // MARK: 콘솔 로그
    func clearLogs() { logs.removeAll() }

    private func append(_ chunk: String) {
        var next = logs
        for line in chunk.split(whereSeparator: \.isNewline) {
            let s = String(line)
            if !s.isEmpty { next.append(s) }
        }
        if next.count > logCap { next.removeFirst(next.count - logCap) }
        logs = next
    }

    // stdout/stderr 를 Pipe 로 가로채되, 원본 fd 로 되돌려 써 Xcode 콘솔도 그대로 받게 한다.
    // MapLibre 네이티브 출력까지 잡힌다. 끄면 dup2 원복 → 흔적 없음.
    private var pipe: Pipe?
    private var savedOut: Int32 = -1
    private var savedErr: Int32 = -1

    private func startCapture() {
        guard pipe == nil else { return }
        let p = Pipe()
        pipe = p
        savedOut = dup(STDOUT_FILENO)
        savedErr = dup(STDERR_FILENO)
        let wfd = p.fileHandleForWriting.fileDescriptor
        dup2(wfd, STDOUT_FILENO)
        dup2(wfd, STDERR_FILENO)
        let tee = savedOut
        p.fileHandleForReading.readabilityHandler = { [weak self] h in
            let data = h.availableData
            guard !data.isEmpty else { return }
            data.withUnsafeBytes { raw in
                if let base = raw.baseAddress { _ = write(tee, base, data.count) }
            }
            if let s = String(data: data, encoding: .utf8) {
                Task { @MainActor in self?.append(s) }
            }
        }
    }

    private func stopCapture() {
        guard let p = pipe else { return }
        if savedOut >= 0 { dup2(savedOut, STDOUT_FILENO); close(savedOut); savedOut = -1 }
        if savedErr >= 0 { dup2(savedErr, STDERR_FILENO); close(savedErr); savedErr = -1 }
        p.fileHandleForReading.readabilityHandler = nil
        try? p.fileHandleForWriting.close()
        pipe = nil
    }

    // MARK: 위치
    private func startLocation() { loc.start() }
    private func stopLocation() { loc.stop(); coord = nil; accuracy = -1 }

    // MARK: 빌드/환경
    var appVersion: String {
        let d = Bundle.main.infoDictionary
        let v = d?["CFBundleShortVersionString"] as? String ?? "?"
        let b = d?["CFBundleVersion"] as? String ?? "?"
        return "\(v) (\(b))"
    }
    // 커밋 해시 — testflight.sh 가 빌드 시 구우면 표시(없으면 "—").
    var gitCommit: String { Bundle.main.infoDictionary?["GitCommit"] as? String ?? "—" }
}

// CLLocationManagerDelegate 를 DevStore 밖으로 뺀 얇은 래퍼 — @MainActor 격리와 분리.
private final class LocationSink: NSObject, CLLocationManagerDelegate {
    var onFix: ((CLLocationCoordinate2D, Double, Double) -> Void)?
    var onAuth: ((String) -> Void)?
    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }
    func start() {
        manager.requestWhenInUseAuthorization()
        manager.startUpdatingLocation()
    }
    func stop() { manager.stopUpdatingLocation() }

    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard let l = locs.last else { return }
        onFix?(l.coordinate, l.horizontalAccuracy, l.altitude)
    }
    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        switch m.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: onAuth?("허용")
        case .denied: onAuth?("거부됨")
        case .restricted: onAuth?("제한됨")
        default: onAuth?("미요청")
        }
    }
}
