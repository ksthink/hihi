import Foundation

// 팩 routes.geojson 의 코스 1개 = feature.properties (웹 코스 목록·카드와 동일 필드).
struct Course: Decodable, Identifiable {
    let no: Int?
    let name: String
    let difficulty: String?
    let distance_km: Double?
    let time_hr: Double?
    let min_elev: Int?
    let max_elev: Int?
    let ascent: Int?
    let descent: Int?
    let profile: [Double]?

    var id: Int { no ?? name.hashValue }
    var title: String { no.map { "코스 \($0)" } ?? name }
}

// routes.geojson 로더 — admin_server 프록시(/data/packs/<코드>/routes.geojson) 소비.
// 정렬은 코스 번호(no) 기준. 실패 시 빈 배열(오프라인은 M4 팩 캐시에서 처리).
enum PackLoader {
    private struct FC: Decodable { let features: [Feature] }
    private struct Feature: Decodable { let properties: Course }

    static func courses(_ code: String) async -> [Course] {
        guard let url = Config.routesURL(code) else { return [] }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let fc = try JSONDecoder().decode(FC.self, from: data)
            return fc.features.map(\.properties).sorted { ($0.no ?? 0) < ($1.no ?? 0) }
        } catch {
            return []
        }
    }
}
