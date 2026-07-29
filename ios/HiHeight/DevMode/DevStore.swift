import Foundation
import CoreLocation
import UIKit   // UIDevice — 배터리 잔량/상태

// ─────────────────────────────────────────────────────────────────────────────
//  개발자 모드 — 테스트용. 이 폴더(DevMode/) 전체가 삭제 대상이다.
//  제거 절차:  ① ios/HiHeight/DevMode/ 폴더 삭제
//             ② grep -rn "DEVMODE" ios/  로 나온 삽입점 2곳(주석 표식) 제거
//  기존 스토어에는 새 배선을 넣지 않아, 지우면 다른 파일들의 로직이 원상 그대로다.
//
//  2026-07-29 재구성 — 배터리 계측기로 전환.
//  뺀 것: 지도 상태(배터리와 무관), 콘솔 로그(dup2 가로채기가 측정값을 오염),
//         빌드 정보(스플래시 좌측 상단 "build N · MM-dd HH:mm" 과 중복).
//  목적: 백그라운드 GPS 가 시간당 배터리를 몇 % 먹는지를 정확도 설정별로 비교한다.
// ─────────────────────────────────────────────────────────────────────────────

@MainActor
final class DevStore: ObservableObject {
    static let shared = DevStore()

    private static let key = "hiheight-devmode"   // 관례 접두사 hiheight-

    // 개발자 모드 on/off — 켜면 배터리 모니터링 + 위치 갱신 시작, 끄면 원복.
    @Published var enabled: Bool {
        didSet {
            UserDefaults.standard.set(enabled, forKey: Self.key)
            if enabled { startMonitoring() } else { stopMonitoring() }
        }
    }
    // HUD 를 잠깐 접기(개발자 모드 자체는 켜진 상태). 프로필 토글로 끄는 것과 구분.
    @Published var hudVisible = true

    // MARK: GPS — DevStore 자체 매니저(등반과 무관하게 상시). ClimbStore 를 건드리지 않는다.
    @Published var coord: CLLocationCoordinate2D?
    @Published var accuracy: Double = -1      // 수평 ±m
    @Published var vAccuracy: Double = -1     // 수직 ±m (등산앱이라 고도 신뢰도가 중요)
    @Published var altitude: Double = 0
    @Published var authText = "미요청"
    @Published private(set) var fixCount = 0
    @Published private(set) var lastFixAt: Date?

    // MARK: 배터리
    @Published private(set) var batteryLevel: Double = -1   // 0~1, 미지원(시뮬레이터)이면 -1
    @Published private(set) var charging = false
    @Published private(set) var lowPower = false

    // MARK: 계측 세션 — 개발자 모드를 켠 시점(또는 리셋) 기준.
    // ClimbStore 는 싱글턴이 아니라 여기서 등반 세션을 알 수 없다. 앱 본체에 배선을
    // 늘리지 않으려고 자체 기준을 쓴다 — 등반이 아닌 대기 상태 소모도 잴 수 있어 오히려 낫다.
    @Published private(set) var sessionStart = Date()
    @Published private(set) var sessionStartLevel: Double = -1
    @Published private(set) var sessionStartFix = 0
    @Published private(set) var now = Date()      // 타이머가 밀어 올리는 표시용 현재 시각

    private let loc = LocationSink()
    private var ticker: Timer?

    private init() {
        enabled = UserDefaults.standard.bool(forKey: Self.key)
        loc.onFix = { [weak self] c, hAcc, vAcc, alt in
            Task { @MainActor in
                guard let self else { return }
                self.coord = c; self.accuracy = hAcc; self.vAccuracy = vAcc; self.altitude = alt
                self.fixCount += 1
                self.lastFixAt = Date()
            }
        }
        loc.onAuth = { [weak self] t in Task { @MainActor in self?.authText = t } }
        if enabled { startMonitoring() }
    }

    // MARK: 모니터링 시작/정지
    private func startMonitoring() {
        UIDevice.current.isBatteryMonitoringEnabled = true
        sampleBattery()
        resetSession()
        loc.start()
        // 10초 주기 — 배터리 잔량은 5% 단위로만 변하므로 이보다 잦게 볼 이유가 없고,
        // 계측기 자신의 리렌더가 측정 대상(배터리)을 갉아먹지 않게 한다.
        ticker = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func stopMonitoring() {
        ticker?.invalidate(); ticker = nil
        loc.stop()
        coord = nil; accuracy = -1; vAccuracy = -1
        UIDevice.current.isBatteryMonitoringEnabled = false   // 켜기 전 상태로 원복
    }

    private func tick() {
        now = Date()
        sampleBattery()
    }

    private func sampleBattery() {
        let d = UIDevice.current
        batteryLevel = Double(d.batteryLevel)      // 미지원이면 -1
        charging = (d.batteryState == .charging || d.batteryState == .full)
        lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
    }

    // 계측 리셋 — GPS 정확도 설정을 바꿔가며 비교할 때 누른다.
    func resetSession() {
        sessionStart = Date()
        sessionStartLevel = batteryLevel
        sessionStartFix = fixCount
        now = Date()
    }

    // MARK: 파생 표시값

    var elapsed: TimeInterval { now.timeIntervalSince(sessionStart) }

    // 세션 동안 줄어든 배터리 %(양수 = 소모). 미지원·충전 중이면 nil.
    var drainPercent: Double? {
        guard batteryLevel >= 0, sessionStartLevel >= 0, !charging else { return nil }
        return (sessionStartLevel - batteryLevel) * 100
    }

    // 시간당 소모율 — 이 계측기의 핵심 지표. 잔량이 5% 단위로만 변해 초반엔 요동치므로
    // 10분 미만은 값을 내지 않는다(0% 또는 5% 로 튀어 비교가 무의미).
    var drainPerHour: Double? {
        guard let d = drainPercent, elapsed >= 600 else { return nil }
        return d / (elapsed / 3600)
    }

    // GPS 신호 등급 0~4 — ⚠️ iOS 는 위성 SNR·신호세기 raw 값을 공개하지 않는다
    // (안드로이드 GnssStatus 같은 API 없음). CoreLocation 이 주는 수평 정확도(±m)가
    // 사실상 유일한 품질 지표라 이를 등급화한다.
    var signalBars: Int {
        guard accuracy >= 0 else { return 0 }
        switch accuracy {
        case ..<5:  return 4
        case ..<10: return 3
        case ..<20: return 2
        case ..<50: return 1
        default:    return 0
        }
    }
    var signalLabel: String { ["없음", "약함", "보통", "양호", "최상"][signalBars] }
    var signalMeter: String { String(repeating: "■", count: signalBars) + String(repeating: "□", count: 4 - signalBars) }

    // 마지막 fix 이후 경과 — 신호 끊김 감지용(터널·계곡에서 몇 초째 안 들어오는지).
    var sinceLastFix: TimeInterval? {
        guard let t = lastFixAt else { return nil }
        return now.timeIntervalSince(t)
    }

    // 분당 fix 수 — 갱신 빈도가 곧 소모량이다. 정확도 설정을 바꾸면 이 값이 먼저 변한다.
    var fixPerMinute: Double? {
        guard elapsed >= 60 else { return nil }
        return Double(fixCount - sessionStartFix) / (elapsed / 60)
    }

    // 현재 GPS 정확도 설정 — LocationSink 가 쓰는 값(변경 시 즉시 반영).
    var accuracyMode: String { loc.accuracyLabel }

    // 정확도 설정 순환 — Best → Nearest10m → HundredMeters → Best.
    // 같은 조건에서 등급만 바꿔 %/h 를 비교하려고 둔다(바꾸면 계측을 리셋한다).
    func cycleAccuracy() {
        loc.cycleAccuracy()
        resetSession()
    }
}

// CLLocationManagerDelegate 를 DevStore 밖으로 뺀 얇은 래퍼 — @MainActor 격리와 분리.
private final class LocationSink: NSObject, CLLocationManagerDelegate {
    var onFix: ((CLLocationCoordinate2D, Double, Double, Double) -> Void)?
    var onAuth: ((String) -> Void)?
    private let manager = CLLocationManager()

    // 순환 대상 — 라벨은 HUD 표시용.
    private static let modes: [(CLLocationAccuracy, String)] = [
        (kCLLocationAccuracyBest, "Best"),
        (kCLLocationAccuracyNearestTenMeters, "10m"),
        (kCLLocationAccuracyHundredMeters, "100m"),
    ]
    private var modeIndex = 0
    var accuracyLabel: String { Self.modes[modeIndex].1 }

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = Self.modes[0].0
    }
    func start() {
        manager.requestWhenInUseAuthorization()
        manager.startUpdatingLocation()
    }
    func stop() { manager.stopUpdatingLocation() }

    func cycleAccuracy() {
        modeIndex = (modeIndex + 1) % Self.modes.count
        manager.desiredAccuracy = Self.modes[modeIndex].0
    }

    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard let l = locs.last else { return }
        onFix?(l.coordinate, l.horizontalAccuracy, l.verticalAccuracy, l.altitude)
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
