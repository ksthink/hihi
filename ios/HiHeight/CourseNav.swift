import Foundation
import CoreLocation

// 등반 내비 계산 — 선택 코스 폴리라인 위에서 "어디쯤인지 · 얼마나 남았는지 · 어디로 가야 하는지".
// 지도를 보지 않고 걷는 화면(NavView)의 데이터 소스다.
//
// ⚠️ 목표 방위는 **코스를 따라 조금 앞선 지점**을 향한다. 도착점을 직선으로 가리키면
//    능선 너머·계곡 건너를 가리켜 위험하다(등산로는 직선이 아니다).
struct NavFix {
    let remainM: Double      // 코스를 따라 남은 거리(m)
    let offRouteM: Double    // 코스에서 벗어난 최단 거리(m) — 지도를 안 볼 때의 안전 지표
    let bearing: Double      // 목표 방위(진북 기준 0~360°)
    let progress: Double     // 0~1 (코스 전체 대비 진행률)
    let nearEnd: Bool        // 목표가 코스 끝점(도착 임박 — 화살표보다 거리 표시가 중요)
}

enum CourseNav {

    /// 코스 폴리라인 위에서 현재 위치를 투영해 남은 거리·이탈 거리·목표 방위를 낸다.
    /// - reverse: 하산처럼 코스를 역방향으로 걷는 경우(시작점을 향한다).
    /// - lookAheadM: 목표점을 현재 지점보다 얼마나 앞에 둘지. 짧으면 화살표가 떨리고,
    ///   길면 굽잇길에서 실제 진행 방향과 어긋난다.
    static func fix(line raw: [[Double]], at c: CLLocationCoordinate2D,
                    reverse: Bool = false, lookAheadM: Double = 40) -> NavFix? {
        let line = reverse ? Array(raw.reversed()) : raw
        guard line.count >= 2 else { return nil }

        // 평면 근사(위도 보정) — 코스 범위는 수 km 라 오차가 무시할 수준이고, 위치 갱신마다
        // 전 세그먼트를 도는 계산이라 구면 공식보다 이쪽이 맞다.
        let lat0 = c.latitude
        let mLat = 111_320.0
        let mLon = 111_320.0 * cos(lat0 * .pi / 180)
        func xy(_ p: [Double]) -> (x: Double, y: Double) { (p[0] * mLon, p[1] * mLat) }
        let me = (x: c.longitude * mLon, y: c.latitude * mLat)

        // 1) 가장 가까운 세그먼트에 투영
        var bestI = 0, bestT = 0.0, bestD2 = Double.greatestFiniteMagnitude
        for i in 0..<(line.count - 1) {
            guard line[i].count >= 2, line[i + 1].count >= 2 else { continue }
            let a = xy(line[i]), b = xy(line[i + 1])
            let vx = b.x - a.x, vy = b.y - a.y
            let len2 = vx * vx + vy * vy
            let t = len2 > 0 ? max(0, min(1, ((me.x - a.x) * vx + (me.y - a.y) * vy) / len2)) : 0
            let px = a.x + vx * t, py = a.y + vy * t
            let d2 = (me.x - px) * (me.x - px) + (me.y - py) * (me.y - py)
            if d2 < bestD2 { bestD2 = d2; bestI = i; bestT = t }
        }
        guard bestD2 < .greatestFiniteMagnitude else { return nil }

        // 2) 세그먼트 길이 표 — 남은 거리와 전체 거리에 함께 쓴다.
        var segLen = [Double](repeating: 0, count: line.count - 1)
        for i in 0..<(line.count - 1) {
            let a = xy(line[i]), b = xy(line[i + 1])
            segLen[i] = ((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y)).squareRoot()
        }
        let total = segLen.reduce(0, +)
        let remain = segLen[bestI] * (1 - bestT) + segLen[(bestI + 1)...].reduce(0, +)

        // 3) 코스를 따라 lookAheadM 앞선 지점 = 목표. 남은 거리가 더 짧으면 끝점.
        let nearEnd = remain <= lookAheadM
        let target: [Double] = nearEnd ? line[line.count - 1]
            : pointAhead(line, segLen: segLen, from: bestI, t: bestT, ahead: lookAheadM)

        // 목표가 현재 위치와 겹치면(도착 직전) 방위가 0° 로 튄다 — 그때는 밟고 선 세그먼트의
        // 진행 방향을 쓴다. 화살표가 도착 순간 북쪽으로 홱 돌아가는 것을 막는다.
        var brg = bearing(from: c, toLon: target[0], toLat: target[1])
        let dTarget = hypot((target[0] - c.longitude) * mLon, (target[1] - c.latitude) * mLat)
        if dTarget < 5 {
            let a = line[bestI], b = line[bestI + 1]
            brg = bearing(from: CLLocationCoordinate2D(latitude: a[1], longitude: a[0]),
                          toLon: b[0], toLat: b[1])
        }

        return NavFix(
            remainM: remain,
            offRouteM: bestD2.squareRoot(),
            bearing: brg,
            progress: total > 0 ? max(0, min(1, (total - remain) / total)) : 0,
            nearEnd: nearEnd)
    }

    // 투영 지점에서 코스를 따라 ahead 미터 전진한 좌표.
    private static func pointAhead(_ line: [[Double]], segLen: [Double],
                                   from i: Int, t: Double, ahead: Double) -> [Double] {
        var left = ahead - segLen[i] * (1 - t)
        if left <= 0 {                      // 같은 세그먼트 안에서 끝난다
            let u = t + ahead / max(segLen[i], 0.0001)
            return lerp(line[i], line[i + 1], min(1, u))
        }
        var k = i + 1
        while k < segLen.count {
            if left <= segLen[k] {
                return lerp(line[k], line[k + 1], left / max(segLen[k], 0.0001))
            }
            left -= segLen[k]; k += 1
        }
        return line[line.count - 1]
    }

    private static func lerp(_ a: [Double], _ b: [Double], _ t: Double) -> [Double] {
        [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }

    /// 진북 기준 방위(0~360°). 화살표는 이 값에서 기기 헤딩을 뺀 각도로 돌린다.
    static func bearing(from a: CLLocationCoordinate2D, toLon lon: Double, toLat lat: Double) -> Double {
        let f1 = a.latitude * .pi / 180, f2 = lat * .pi / 180
        let dl = (lon - a.longitude) * .pi / 180
        let y = sin(dl) * cos(f2)
        let x = cos(f1) * sin(f2) - sin(f1) * cos(f2) * cos(dl)
        return (atan2(y, x) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    }

    /// 근접 휴리스틱 — 시작점에 더 가까우면 정방향.
    /// ⚠️ **최후 폴백 전용이다.** 이 함수만으로 방향을 정하면 코스 중간점을 지난 뒤 내비를
    ///    열었을 때 도착점이 더 가까워 하산으로 오판한다(ISSUE #4, 2026-08-01).
    ///    움직임을 알 수 있는 상황에서는 반드시 `NavDirector` 를 쓴다.
    static func isForward(line: [[Double]], from c: CLLocationCoordinate2D) -> Bool {
        guard let s = line.first, let e = line.last, s.count >= 2, e.count >= 2 else { return true }
        let ds = hypot(s[0] - c.longitude, s[1] - c.latitude)
        let de = hypot(e[0] - c.longitude, e[1] - c.latitude)
        return ds <= de
    }

    /// 두 좌표 사이 거리(m) — 평면 근사(위도 보정).
    static func meters(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        let mLat = 111_320.0, mLon = 111_320.0 * cos(a.latitude * .pi / 180)
        return hypot((b.longitude - a.longitude) * mLon, (b.latitude - a.latitude) * mLat)
    }

    /// 정방향 기준 남은 거리 — 방향 판정의 단일 척도.
    private static func remainForward(_ line: [[Double]], _ c: CLLocationCoordinate2D) -> Double? {
        fix(line: line, at: c, reverse: false)?.remainM
    }
}

/// 코스 진행 방향 판정기 — 위치가 갱신될 때마다 먹여서 방향을 유지하거나 뒤집는다.
///
/// ISSUE #4(2026-08-01) 수정. 예전에는 `isForward` 로 **진입 시 1회**, 그것도 "시작·도착점 중
/// 어디에 더 가까운가"라는 **위치**로만 판정했다. 그래서 코스 중간점을 지난 뒤 내비를 열면
/// 하산으로 오판했고(도착점이 더 가까우므로), 아무리 걸어도 바로잡히지 않아 화살표가 계속
/// 걸어온 방향을 가리켰다. 지도를 보지 않는 화면이라 방향 오판은 곧 안전 문제다.
///
/// 세 가지를 함께 쓴다.
/// 1. **움직임 기반** — 위치가 아니라 "정방향 기준 남은 거리가 줄어드는가"로 본다.
///    이동 벡터 내적 대신 이 척도를 쓰는 이유: 굽잇길에서 순간 방위가 뒤집혀도 코스를 따른
///    누적값은 흔들리지 않는다. 코스에서 벗어나 걸어도 부호는 유지된다.
/// 2. **지속 판정 + 히스테리시스** — 반대 방향이 `flipSeconds` 이상, 그동안 `flipMeters`
///    이상 실제로 움직였을 때만 뒤집는다. GPS 지터로 화살표가 펄럭이지 않게.
/// 3. **수동 안전판** — 사용자가 헤더를 탭해 고정하면(`locked`) 자동 전환을 멈춘다.
///    판정이 틀려도 즉시 교정할 수 있어야 한다.
struct NavDirector {
    private(set) var forward = true
    private(set) var locked = false          // 사용자가 직접 지정 — 자동 전환 금지

    static let flipSeconds: TimeInterval = 25
    static let flipMeters: Double = 25
    private static let moveGate: Double = 3  // 이보다 덜 움직였으면 정지·지터로 보고 판정 보류

    private var lastRemain: Double?
    private var lastCoord: CLLocationCoordinate2D?
    private var lastAt: Date?
    private var againstSec: TimeInterval = 0
    private var againstM: Double = 0

    init() {}

    /// 진입 시 초기 방향. 진행 중 트랙이 있으면 **움직임으로** 정하고(중간 진입도 즉시 정확),
    /// 없을 때만 근접 휴리스틱으로 떨어진다.
    /// - track: `ClimbStore.track` 형식 `[lng, lat, 고도, unix초]`.
    init(line: [[Double]], at c: CLLocationCoordinate2D, track: [[Double]] = []) {
        forward = Self.initialForward(line: line, at: c, track: track)
        lastRemain = CourseNav.fix(line: line, at: c, reverse: false)?.remainM
        lastCoord = c
        lastAt = Date()
    }

    private static func initialForward(line: [[Double]], at c: CLLocationCoordinate2D,
                                       track: [[Double]]) -> Bool {
        // 최근 트랙에서 현재 위치와 30m 이상 떨어진 가장 가까운 과거 점을 찾아 남은 거리를 비교.
        // 30m 는 GPS 오차(±10m 안팎)보다 충분히 커서 부호가 뒤집히지 않는 최소 거리다.
        let recent = track.suffix(120)   // 1Hz 기준 최근 2분
        for p in recent.reversed() where p.count >= 2 {
            let past = CLLocationCoordinate2D(latitude: p[1], longitude: p[0])
            guard CourseNav.meters(past, c) >= 30 else { continue }
            guard let r0 = CourseNav.fix(line: line, at: past, reverse: false)?.remainM,
                  let r1 = CourseNav.fix(line: line, at: c, reverse: false)?.remainM,
                  abs(r0 - r1) > 5 else { break }
            return r1 < r0
        }
        return CourseNav.isForward(line: line, from: c)   // 폴백 — 움직임을 모를 때만
    }

    /// 위치 갱신마다 호출. 방향이 뒤집혔으면 true(호출부가 다시 계산하도록).
    mutating func update(line: [[Double]], at c: CLLocationCoordinate2D, now: Date = Date()) -> Bool {
        guard let remain = CourseNav.fix(line: line, at: c, reverse: false)?.remainM else { return false }
        guard let prevRemain = lastRemain, let prevC = lastCoord, let prevAt = lastAt else {
            lastRemain = remain; lastCoord = c; lastAt = now
            return false
        }

        // ⚠️ 기준점은 **게이트를 넘을 때만** 옮긴다. 매 갱신마다 옮기면 1Hz 보행(한 걸음 ~1.3m)이
        //    항상 게이트 아래라 판정이 영영 일어나지 않는다(2026-08-01 단위 검증에서 발견).
        //    이렇게 두면 3m 쌓일 때마다(보행 2~3초) 한 번씩 판정한다.
        let moved = CourseNav.meters(prevC, c)
        guard moved >= Self.moveGate else { return false }           // 정지 중엔 판정하지 않는다
        let dt = now.timeIntervalSince(prevAt)
        lastRemain = remain; lastCoord = c; lastAt = now
        guard !locked, dt > 0 else { return false }

        let goingForward = remain < prevRemain
        if goingForward == forward {                  // 현재 방향과 일치 — 반대 누적 리셋
            againstSec = 0; againstM = 0
            return false
        }
        againstSec += dt; againstM += moved
        guard againstSec >= Self.flipSeconds, againstM >= Self.flipMeters else { return false }
        forward.toggle()
        againstSec = 0; againstM = 0
        return true
    }

    /// 헤더 탭 등 사용자 지정 — 이후 자동 전환을 멈춘다(다시 탭해도 잠금은 유지).
    mutating func setManual(_ f: Bool) {
        forward = f
        locked = true
        againstSec = 0; againstM = 0
    }
}
