import Foundation

// climb_records 1행 (Supabase). 트랙은 목록/합계엔 불필요해 제외(루트 보기 슬라이스에서 별도 조회).
struct ClimbRecord: Decodable, Identifiable {
    let id: String
    let mountain_id: String?
    let course_name: String?
    let started_at: String?      // ISO8601 (표시용 파싱)
    let distance_km: Double?
    let ascent_m: Int?
    let duration_s: Int?

    var startedDate: Date? {
        started_at.flatMap { ISO8601DateFormatter().date(from: $0) }
            ?? started_at.flatMap { ClimbRecord.fracFmt.date(from: $0) }
    }
    private static let fracFmt: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
}
