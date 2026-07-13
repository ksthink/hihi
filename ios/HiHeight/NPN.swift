import Foundation

// 국가지점번호 — WGS84 → UTM-K(EPSG:5179) Redfearn → 100km 한글격자 + 10m 숫자격자.
// npn.js 1:1 직역(순수 수학). 조난 신고용 — 지도 중심 좌표로 산정.
enum NPN {
    private static let a = 6_378_137.0                 // GRS80 장반경
    private static let f = 1 / 298.257222101           // GRS80 편평률
    private static let k0 = 0.9996
    private static let lat0 = 38.0 * .pi / 180
    private static let lon0 = 127.5 * .pi / 180
    private static let fe = 1_000_000.0, fn = 2_000_000.0
    private static let e2 = f * (2 - f)
    private static let ep2 = e2 / (1 - e2)
    private static let baseX = 700_000.0, baseY = 1_300_000.0
    private static let seq = Array("가나다라마바사아자차카타파하")

    private static func meridArc(_ lat: Double) -> Double {
        a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * lat
             - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * sin(2 * lat)
             + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * sin(4 * lat)
             - (35 * e2 * e2 * e2 / 3072) * sin(6 * lat))
    }
    private static let m0 = meridArc(lat0)

    static func toUtmK(lat latDeg: Double, lon lonDeg: Double) -> (x: Double, y: Double) {
        let lat = latDeg * .pi / 180, lon = lonDeg * .pi / 180
        let s = sin(lat), c = cos(lat), t = tan(lat)
        let nu = a / (1 - e2 * s * s).squareRoot()
        let T = t * t, C = ep2 * c * c
        let a1 = (lon - lon0) * c
        let x = fe + k0 * nu * (a1 + (1 - T + C) * pow(a1, 3) / 6
                + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * pow(a1, 5) / 120)
        let y = fn + k0 * (meridArc(lat) - m0 + nu * t * (a1 * a1 / 2
                + (5 - T + 9 * C + 4 * C * C) * pow(a1, 4) / 24
                + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * pow(a1, 6) / 720))
        return (x, y)
    }

    // 격자 밖이면 nil.
    static func code(lat: Double, lon: Double) -> String? {
        let p = toUtmK(lat: lat, lon: lon)
        let dx = p.x - baseX, dy = p.y - baseY
        guard dx >= 0, dy >= 0 else { return nil }
        let ei = Int(dx / 100_000), ni = Int(dy / 100_000)
        guard ei < seq.count, ni < seq.count else { return nil }
        let ed = Int(dx.truncatingRemainder(dividingBy: 100_000) / 10)
        let nd = Int(dy.truncatingRemainder(dividingBy: 100_000) / 10)
        return "\(seq[ei])\(seq[ni]) \(String(format: "%04d", ed)) \(String(format: "%04d", nd))"
    }
}
