import Foundation

// 일출·일몰 (로컬 계산 · 오프라인 · 네트워크 불필요) — Almanac for Computers 알고리즘.
// 웹 app.js:sunTimes 와 동일 로직 포팅(순수 계산, 데이터 주도 아님). tz 기본 KST(+9).
// 반환 (rise, set) "HH:mm". 극야·백야 등 그 날 해가 안 뜸/안 짐이면 nil.
enum SunTimes {
    static func today(lat: Double, lon: Double, tz: Double = 9, date: Date = Date()) -> (rise: String, set: String)? {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: Int(tz * 3600)) ?? .current
        let N = cal.ordinality(of: .day, in: .year, for: date) ?? 1   // 연중 일자(1/1 = 1), KST 기준
        let d2r = Double.pi / 180, r2d = 180 / Double.pi
        func sind(_ d: Double) -> Double { sin(d * d2r) }
        func cosd(_ d: Double) -> Double { cos(d * d2r) }
        func tand(_ d: Double) -> Double { tan(d * d2r) }
        func wrap(_ v: Double, _ m: Double) -> Double {
            let r = v.truncatingRemainder(dividingBy: m); return r < 0 ? r + m : r
        }
        let zenith = 90.833, lngHour = lon / 15               // 90.833° = 태양 상단연 + 대기굴절
        func calc(_ rising: Bool) -> Double? {
            let t = Double(N) + ((rising ? 6.0 : 18.0) - lngHour) / 24
            let M = 0.9856 * t - 3.289
            let L = wrap(M + 1.916 * sind(M) + 0.020 * sind(2 * M) + 282.634, 360)
            var RA = wrap(atan(0.91764 * tand(L)) * r2d, 360)
            RA += (L / 90).rounded(.down) * 90 - (RA / 90).rounded(.down) * 90   // RA 를 L 과 같은 사분면으로
            RA /= 15
            let sinDec = 0.39782 * sind(L)
            let cosDec = cos(asin(sinDec))
            let cosH = (cosd(zenith) - sinDec * sind(lat)) / (cosDec * cosd(lat))
            if cosH > 1 || cosH < -1 { return nil }           // 그 날 해가 안 뜸/안 짐
            var H = rising ? 360 - acos(cosH) * r2d : acos(cosH) * r2d
            H /= 15
            let T = H + RA - 0.06571 * t - 6.622
            return wrap(wrap(T - lngHour, 24) + tz, 24)
        }
        func fmt(_ h: Double) -> String {
            let m = Int(wrap((h * 60).rounded(), 1440))
            return String(format: "%02d:%02d", m / 60, m % 60)
        }
        guard let r = calc(true), let s = calc(false) else { return nil }
        return (fmt(r), fmt(s))
    }
}
