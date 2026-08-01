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

    /// 코스를 정방향으로 걷는지 판단 — 시작 위치가 끝점보다 시작점에 가까우면 정방향.
    /// (등반 시작 시 1회 정해두고 쓴다. 매 위치마다 다시 재면 중간에서 뒤집힌다.)
    static func isForward(line: [[Double]], from c: CLLocationCoordinate2D) -> Bool {
        guard let s = line.first, let e = line.last, s.count >= 2, e.count >= 2 else { return true }
        let ds = hypot(s[0] - c.longitude, s[1] - c.latitude)
        let de = hypot(e[0] - c.longitude, e[1] - c.latitude)
        return ds <= de
    }
}
