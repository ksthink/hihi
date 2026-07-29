import Foundation

// 기상청 단기예보 — weather.js 1:1 직역(격자변환·발표시각·병합·상태).
// 실제 호출은 맥 admin_server 의 /api/weather 프록시 경유(키 은닉, IOS.md §2 전략 동일).
struct WeatherHour: Identifiable {
    let key: String
    let hh: Int
    let tmp: Double?
    let sky: Int?
    let pty: Int
    let lgt: Double
    let pop: Int?
    let wsd: Double?
    let isNow: Bool
    var id: String { key }
}

struct WeatherState { let symbol: String; let label: String }

enum WeatherService {
    // 위경도 → 기상청 LCC 격자 (dfs_xy_conv)
    static func dfsXy(lat: Double, lon: Double) -> (nx: Int, ny: Int) {
        let RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0
        let OLON = 126.0, OLAT = 38.0, XO = 43.0, YO = 136.0
        let D = Double.pi / 180
        let re = RE / GRID, s1 = SLAT1 * D, s2 = SLAT2 * D, ol = OLON * D, oa = OLAT * D
        var sn = tan(.pi * 0.25 + s2 * 0.5) / tan(.pi * 0.25 + s1 * 0.5)
        sn = log(cos(s1) / cos(s2)) / log(sn)
        var sf = tan(.pi * 0.25 + s1 * 0.5)
        sf = pow(sf, sn) * cos(s1) / sn
        var ro = tan(.pi * 0.25 + oa * 0.5)
        ro = re * sf / pow(ro, sn)
        var ra = tan(.pi * 0.25 + lat * D * 0.5)
        ra = re * sf / pow(ra, sn)
        var theta = lon * D - ol
        if theta > .pi { theta -= 2 * .pi }
        if theta < -.pi { theta += 2 * .pi }
        theta *= sn
        return (Int(floor(ra * sin(theta) + XO + 0.5)), Int(floor(ro - ra * cos(theta) + YO + 0.5)))
    }

    private static var kst: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Asia/Seoul")!
        return c
    }
    // 예보 기준 캡션 — 현재 KST 시각 (weather.js baseLabel 대응).
    static var baseLabel: String { "\(kst.component(.hour, from: Date()))시 기준" }
    private static func ymd(_ d: Date) -> String {
        let c = kst.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d%02d%02d", c.year!, c.month!, c.day!)
    }
    // 초단기예보: 매시 30분 발표, 45분 뒤 제공
    private static func ultraBase(_ now: Date) -> (String, String) {
        let t = now.addingTimeInterval(-45 * 60)
        return (ymd(t), String(format: "%02d30", kst.component(.hour, from: t)))
    }
    // 단기예보: 02/05/08/11/14/17/20/23시 발표, +15분 여유
    private static func vilageBase(_ now: Date) -> (String, String) {
        let t = now.addingTimeInterval(-15 * 60)
        let h = kst.component(.hour, from: t)
        let slots = [2, 5, 8, 11, 14, 17, 20, 23].filter { $0 <= h }
        if let mx = slots.max() { return (ymd(t), String(format: "%02d00", mx)) }
        return (ymd(t.addingTimeInterval(-86400)), "2300")
    }

    private static func callKma(_ op: String, _ nx: Int, _ ny: Int, _ base: (String, String)) async -> [[String: Any]] {
        guard var comps = URLComponents(string: "\(Config.proxyBase)/api/weather") else { return [] }
        comps.queryItems = [
            .init(name: "op", value: op), .init(name: "nx", value: "\(nx)"), .init(name: "ny", value: "\(ny)"),
            .init(name: "base_date", value: base.0), .init(name: "base_time", value: base.1),
        ]
        guard let url = comps.url,
              let (data, _) = try? await URLSession.shared.data(from: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let body = (obj["response"] as? [String: Any])?["body"] as? [String: Any],
              let items = (body["items"] as? [String: Any])?["item"] as? [[String: Any]]
        else { return [] }
        return items
    }

    // items → { "YYYYMMDDHHMM": {category: value} }
    private static func byHour(_ items: [[String: Any]]) -> [String: [String: String]] {
        var m: [String: [String: String]] = [:]
        for i in items {
            guard let fd = i["fcstDate"] as? String, let ft = i["fcstTime"] as? String,
                  let cat = i["category"] as? String else { continue }
            m[fd + ft, default: [:]][cat] = "\(i["fcstValue"] ?? "")"
        }
        return m
    }

    // 미리 받아두기 — 결과는 버리고 URLCache 만 채운다(프록시 Cache-Control max-age=1800).
    // 탐험 진입 시점에 처음 요청하면 캐시 미스가 2초 넘게 걸려 날씨 칸이 비어 보인다.
    // 앱 시작·코스 캐러셀 진입처럼 **탐험보다 이른 시점**에 걸어두면 도착할 때 이미 캐시에 있다.
    static func prefetch(lat: Double, lon: Double) {
        Task { _ = await fetch(lat: lat, lon: lon) }
    }

    // 산 위치 2시간 간격 count 개 예보 (초단기예보 + 단기예보 병합)
    static func fetch(lat: Double, lon: Double, count: Int = 8, stepHours: Int = 2) async -> [WeatherHour] {
        let (nx, ny) = dfsXy(lat: lat, lon: lon)
        let now = Date()
        async let u = callKma("ufcst", nx, ny, ultraBase(now))
        async let v = callKma("vfcst", nx, ny, vilageBase(now))
        let U = byHour(await u), V = byHour(await v)
        if U.isEmpty && V.isEmpty { return [] }

        var comps = kst.dateComponents([.year, .month, .day, .hour], from: now)
        comps.minute = 0; comps.second = 0
        guard let start = kst.date(from: comps) else { return [] }
        func numI(_ s: String?) -> Int? { s.flatMap { Int($0) } }
        func numD(_ s: String?) -> Double? { s.flatMap { Double($0) } }

        var hours: [WeatherHour] = []
        var h = 0
        while h < 24 && hours.count < count {
            let t = start.addingTimeInterval(Double(h) * 3600)
            let hh = kst.component(.hour, from: t)
            let key = ymd(t) + String(format: "%02d00", hh)
            let uu = U[key], vv = V[key]
            if uu == nil && vv == nil { h += stepHours; continue }
            hours.append(WeatherHour(
                key: key, hh: hh,
                tmp: numD(uu?["T1H"]) ?? numD(vv?["TMP"]),
                sky: numI(uu?["SKY"]) ?? numI(vv?["SKY"]),
                pty: numI(uu?["PTY"]) ?? numI(vv?["PTY"]) ?? 0,
                lgt: numD(uu?["LGT"]) ?? 0,
                pop: numI(vv?["POP"]),
                wsd: numD(uu?["WSD"]) ?? numD(vv?["WSD"]),
                isNow: hours.isEmpty))
            h += stepHours
        }
        return hours
    }

    // 상태 우선순위: 낙뢰 > 강수 > 강풍 > 하늘 (SF Symbol 매핑)
    static func state(_ h: WeatherHour) -> WeatherState {
        if h.lgt > 0 { return .init(symbol: "cloud.bolt", label: "낙뢰") }
        switch h.pty {
        case 3: return .init(symbol: "cloud.snow", label: "눈")
        case 2: return .init(symbol: "cloud.sleet", label: "비/눈")
        case 1: return .init(symbol: "cloud.rain", label: "비")
        case 4: return .init(symbol: "cloud.heavyrain", label: "소나기")
        default: break
        }
        if let w = h.wsd, w >= 9 { return .init(symbol: "wind", label: "강풍") }
        switch h.sky {
        case 4: return .init(symbol: "cloud", label: "흐림")
        case 3: return .init(symbol: "cloud.sun", label: "구름많음")
        default: return .init(symbol: "sun.max", label: "맑음")
        }
    }
}
