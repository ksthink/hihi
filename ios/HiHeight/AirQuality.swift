import Foundation

// 대기질(미세먼지) — /api/air 프록시 소비. 웹 air.js 와 같은 계약.
//
// ⚠️ **수치 예보는 존재하지 않는다.** 에어코리아가 주는 것은 두 가지다:
//    · 실황 — 측정소별 PM10/PM2.5 **수치**(㎍/㎥), 1시간 주기
//    · 예보 — 권역별 **일 단위 등급**(좋음·보통·나쁨·매우나쁨), 하루 4회 발표
//    네이버가 보여주는 "시간별 예보"는 케이웨더(민간 유료) 자료다. 무료 범위만 쓰므로
//    날씨 스트립처럼 시간 칸을 만들지 않는다 — 하루 한 값을 여러 칸에 복제하면 시간별
//    정보가 있는 것처럼 보여 사용자를 오도한다(2026-08-09 결정).
//
// 최근접 측정소 선택·권역 판정은 **서버(api/air.js)가 한다.** 측정소 이름 규칙이 지역마다
// 달라(서울은 "강북구", 인천·경기는 "계산"·"소사본동" 같은 동 단위) 이름으로는 못 고른다.
// 좌표로 고르면 규칙이 필요 없고 웹·iOS 가 같은 답을 본다.
struct AirQuality: Decodable {
    let pm10: Int?          // ㎍/㎥ (측정소 점검 등으로 없을 수 있다)
    let pm25: Int?
    let pm10Grade: Int?     // 1 좋음 · 2 보통 · 3 나쁨 · 4 매우나쁨
    let pm25Grade: Int?
    let station: String?    // 최근접 측정소명. nil 이면 쓸 값이 없다(너무 멀거나 조회 실패)
    let addr: String?
    let distanceKm: Double?
    let observedAt: String? // "2026-08-09 20:00"
    let tomorrow: String?   // 내일 PM10 등급(권역)

    static func gradeLabel(_ g: Int?) -> String? {
        switch g {
        case 1: return "좋음"
        case 2: return "보통"
        case 3: return "나쁨"
        case 4: return "매우나쁨"
        default: return nil
        }
    }

    /// 보여줄 값이 하나라도 있는가 — 측정소가 잡혔고 수치가 최소 하나는 와야 한다.
    var hasValue: Bool { station != nil && (pm10 != nil || pm25 != nil) }
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
