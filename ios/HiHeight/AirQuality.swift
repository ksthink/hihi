import Foundation

// 대기질(미세먼지) — /api/air 프록시 소비. 웹 air.js 와 같은 계약.
//
// ⚠️ **수치 예보는 존재하지 않는다.** 에어코리아가 주는 것은 두 가지다:
//    · 실황 — 측정소별 PM10/PM2.5 **수치**(㎍/㎥), 1시간 주기
//    · 예보 — 권역별 **일 단위 등급**(좋음·보통·나쁨·매우나쁨), 하루 4회 발표
//    네이버가 보여주는 "시간별 예보"는 케이웨더(민간 유료) 자료다. 무료 범위만 쓰므로
//    등급은 **하루 한 값**이다. 날씨 칩에 함께 얹되(2026-08-10 — 별도 줄은 시선이 분산돼
//    읽기 불편했다) 같은 날 칸에는 같은 값이 들어간다. 캡션에 "하루 기준"을 밝혀 시간별
//    변화로 오해하지 않게 한다.
//
// 최근접 측정소 선택·권역 판정은 **서버(api/air.js)가 한다.** 측정소 이름 규칙이 지역마다
// 달라(서울은 "강북구", 인천·경기는 "계산"·"소사본동" 같은 동 단위) 이름으로는 못 고른다.
// 좌표로 고르면 규칙이 필요 없고 웹·iOS 가 같은 답을 본다.
// 예보 한 칸. **앞뒤가 같은 값이 아니다** — `scale` 이 다르면 다른 자료다.
//   daily  : 미세먼지(PM10) 등급 — 좋음·보통·나쁨·매우나쁨. 오늘·내일 2일.
//   weekly : 초미세먼지(PM2.5) 주간전망 — 낮음·높음. 모레 이후 4일.
// 원본이 다른 척도라 한쪽에 맞춰 변환하지 않는다. 화면에서 구분해 밝힌다.
struct AirForecast: Codable, Identifiable {
    let date: String        // "2026-08-12"
    let grade: String
    let scale: String
    var id: String { date }
    var isWeekly: Bool { scale == "weekly" }
}

struct AirQuality: Codable {
    let pm10: Int?          // ㎍/㎥ (측정소 점검 등으로 없을 수 있다)
    let pm25: Int?
    let pm10Grade: Int?     // 1 좋음 · 2 보통 · 3 나쁨 · 4 매우나쁨
    let pm25Grade: Int?
    let station: String?    // 최근접 측정소명. nil 이면 쓸 값이 없다(너무 멀거나 조회 실패)
    let addr: String?
    let distanceKm: Double?
    let stationLat: Double? // 지도에 찍기 위한 좌표 — "이 값이 어디서 왔나"를 보여준다
    let stationLon: Double?
    let observedAt: String? // "2026-08-09 20:00"
    let today: String?      // 오늘 PM10 등급(권역) — 날씨 칩의 '오늘' 칸에 붙인다
    let tomorrow: String?   // 내일 PM10 등급 — 자정을 넘어가는 칩에 붙인다
    let forecast: [AirForecast]?   // 일별 2일 + 주간 4일 — 측정소 시트에서 가로로 넘겨 본다

    static func gradeLabel(_ g: Int?) -> String? {
        switch g {
        case 1: return "좋음"
        case 2: return "보통"
        case 3: return "나쁨"
        case 4: return "매우나쁨"
        default: return nil
        }
    }

    /// 보여줄 값이 하나라도 있는가.
    ///
    /// ⚠️ 실황(수치)과 예보(등급)는 **서로 다른 API 다.** 한쪽이 죽었다고 다른 쪽까지 버리면
    /// 멀쩡한 값이 있는데도 화면이 빈다 — 실제로 실황만 504 인 시간대가 있었다(2026-08-10).
    var hasValue: Bool { pm10 != nil || pm25 != nil || today != nil || tomorrow != nil }

    /// 지도에 찍을 수 있는가 — 옛 응답에는 좌표가 없다.
    var hasPosition: Bool { stationLat != nil && stationLon != nil }

    /// 실황을 잰 지 얼마나 지났나. 저장분을 먼저 띄우므로 "지금 값"이 아닐 수 있다.
    var observedAge: TimeInterval? {
        guard let s = observedAt else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Seoul")
        f.dateFormat = "yyyy-MM-dd HH:mm"
        guard let d = f.date(from: s) else { return nil }
        return Date().timeIntervalSince(d)
    }

    /// 실황은 1시간 주기다. 두 시간이 넘었으면 화면에 **언제 값인지** 밝힌다 —
    /// 저장분이 그대로 남아 있는데 지금 값으로 읽히면 안 된다.
    var isStale: Bool { (observedAge ?? 0) > 7200 }
}

// 산별 마지막 대기질 — 켜자마자 보여주기 위한 저장분.
//
// 네트워크를 기다리는 동안 화면이 비어 있으면 "안 나온다"로 읽힌다(2026-08-10 지적).
// 저장분을 즉시 띄우고 새 값이 오면 조용히 갈아끼운다. 값이 낡았을 때만 관측 시각을
// 함께 보이므로(`isStale`) 옛 값을 지금 값으로 오해할 일은 없다.
enum AirStore {
    private static func key(_ code: String) -> String { "air.last.\(code)" }

    static func load(_ code: String) -> AirQuality? {
        guard let d = UserDefaults.standard.data(forKey: key(code)) else { return nil }
        return try? JSONDecoder().decode(AirQuality.self, from: d)
    }

    static func save(_ code: String, _ air: AirQuality) {
        guard let d = try? JSONEncoder().encode(air) else { return }
        UserDefaults.standard.set(d, forKey: key(code))
    }
}

enum AirService {
    /// 산 좌표에서 가장 가까운 측정소의 실황 + 내일 등급. 없거나 실패하면 nil.
    static func fetch(lat: Double, lon: Double, region: String?) async -> AirQuality? {
        guard var c = URLComponents(string: "\(Config.proxyBase)/api/air") else { return nil }
        c.queryItems = [
            .init(name: "lat", value: String(lat)),
            .init(name: "lon", value: String(lon)),
            .init(name: "region", value: region ?? ""),
        ]
        guard let url = c.url,
              let (data, _) = try? await URLSession.shared.data(from: url),
              let air = try? JSONDecoder().decode(AirQuality.self, from: data),
              air.hasValue
        else { return nil }
        return air
    }
}
