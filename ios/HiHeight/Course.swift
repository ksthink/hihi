import Foundation

// 팩 routes.geojson 의 코스 1개 = feature.properties + 지오메트리 시종점(start/end).
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
    let peak: String?
    let surface: String?
    let desc: String?

    // 지오메트리에서 파생(Decodable 대상 아님) — PackLoader 가 채운다.
    var start: [Double]? = nil
    var end: [Double]? = nil
    var bbox: [Double]? = nil     // [minLng, minLat, maxLng, maxLat] — 코스 탭 시 fitBounds
    var mid: [Double]? = nil      // 번호 배지 위치 — 가장 긴 하위선의 중간지점(웹 lineMidpoint). 코스당 1개

    enum CodingKeys: String, CodingKey {
        case no, name, difficulty, distance_km, time_hr, min_elev, max_elev, ascent, descent, profile, peak, surface, desc
    }

    var id: Int { no ?? name.hashValue }
    var title: String { no.map { "코스 \($0)" } ?? name }

    // 소수 시간(time_hr) → "42분"/"1시간 30분". 데이터 계약은 소수 시간 그대로, 표시만 변환(웹 fmtTime 과 동일 규칙).
    var timeLabel: String? {
        guard let h = time_hr else { return nil }
        let m = Int((h * 60).rounded())
        guard m > 0 else { return nil }
        if m < 60 { return "\(m)분" }
        return m % 60 == 0 ? "\(m / 60)시간" : "\(m / 60)시간 \(m % 60)분"
    }

    // 난이도 표기 — 웹 DIFF_LABEL/DIFF_LEVEL (초급=보통 1, 중급=어려움 2, 고급=매우 어려움 3).
    var difLabel: String { ["초급": "보통", "중급": "어려움", "고급": "매우 어려움"][difficulty ?? ""] ?? (difficulty ?? "") }
    var difLevel: Int { ["초급": 1, "중급": 2, "고급": 3][difficulty ?? ""] ?? 1 }
}

// LineString / MultiLineString 지오메트리의 첫 점·끝 점 + 전체 bbox + 배지 중점 (시종점·fitBounds·배지 용).
private struct Geometry: Decodable {
    let first: [Double]?
    let last: [Double]?
    let bbox: [Double]?
    let mid: [Double]?
    enum CK: String, CodingKey { case type, coordinates }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CK.self)
        switch try c.decode(String.self, forKey: .type) {
        case "LineString":
            let co = try c.decode([[Double]].self, forKey: .coordinates)
            first = co.first; last = co.last; bbox = Self.bounds(co); mid = Self.midpoint([co])
        case "MultiLineString":
            let co = try c.decode([[[Double]]].self, forKey: .coordinates)
            let flat = co.flatMap { $0 }
            first = co.first?.first; last = co.last?.last; bbox = Self.bounds(flat); mid = Self.midpoint(co)
        default:
            first = nil; last = nil; bbox = nil; mid = nil
        }
    }
    // 배지 위치 — 가장 긴 하위선의 반거리 지점(웹 lineMidpoint). 코스당 1개, 항상 선 위.
    static func midpoint(_ lines: [[[Double]]]) -> [Double]? {
        var best: [[Double]] = []; var bestLen = -1.0
        for ln in lines where ln.count >= 2 {
            var L = 0.0
            for i in 1..<ln.count { L += dist(ln[i - 1], ln[i]) }
            if L > bestLen { bestLen = L; best = ln }
        }
        guard best.count >= 2 else { return best.first ?? lines.first?.first }
        let half = bestLen / 2; var acc = 0.0
        for i in 1..<best.count {
            let d = dist(best[i - 1], best[i])
            if acc + d >= half {
                let t = d != 0 ? (half - acc) / d : 0
                return [best[i - 1][0] + (best[i][0] - best[i - 1][0]) * t,
                        best[i - 1][1] + (best[i][1] - best[i - 1][1]) * t]
            }
            acc += d
        }
        return best.last
    }
    // 근사 평면 거리(경도 위도 보정) — 배지 위치용으로 충분.
    static func dist(_ a: [Double], _ b: [Double]) -> Double {
        guard a.count >= 2, b.count >= 2 else { return 0 }
        let dx = (a[0] - b[0]) * cos((a[1] + b[1]) * .pi / 360), dy = a[1] - b[1]
        return (dx * dx + dy * dy).squareRoot()
    }
    static func bounds(_ coords: [[Double]]) -> [Double]? {
        guard !coords.isEmpty else { return nil }
        var minX = 180.0, minY = 90.0, maxX = -180.0, maxY = -90.0
        for c in coords where c.count >= 2 {
            minX = min(minX, c[0]); maxX = max(maxX, c[0])
            minY = min(minY, c[1]); maxY = max(maxY, c[1])
        }
        return [minX, minY, maxX, maxY]
    }
}

enum PackLoader {
    private struct FC: Decodable { let features: [Feature] }
    private struct Feature: Decodable { let properties: Course; let geometry: Geometry }

    static func courses(_ code: String) async -> [Course] {
        guard let url = Config.routesURL(code) else { return [] }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let fc = try JSONDecoder().decode(FC.self, from: data)
            return fc.features.map { f in
                var c = f.properties
                c.start = f.geometry.first
                c.end = f.geometry.last
                c.bbox = f.geometry.bbox
                c.mid = f.geometry.mid
                return c
            }.sorted { ($0.no ?? 0) < ($1.no ?? 0) }
        } catch {
            return []
        }
    }
}
