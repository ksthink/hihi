import Foundation

// climb_records 1행 (Supabase). track jsonb 는 루트 보기용으로 함께 로드한다.
struct ClimbRecord: Decodable, Identifiable {
    let id: String
    let mountain_id: String?
    let course_name: String?
    let started_at: String?      // ISO8601 (표시용 파싱)
    let distance_km: Double?
    let ascent_m: Int?
    let duration_s: Int?
    let track: RecTrack?

    // track.points: 신형 [lng,lat,고도|null,unix] / 구형 [lng,lat,unix] — 앞 2개만 좌표.
    struct RecTrack: Decodable { let points: [[Double?]]? }
    var trackPoints: [[Double]] {
        (track?.points ?? []).compactMap { p in
            guard p.count >= 2, let lng = p[0], let lat = p[1] else { return nil }
            return [lng, lat]
        }
    }
    var hasTrack: Bool { trackPoints.count >= 2 }

    var startedDate: Date? {
        started_at.flatMap { ISO8601DateFormatter().date(from: $0) }
            ?? started_at.flatMap { ClimbRecord.fracFmt.date(from: $0) }
    }
    private static let fracFmt: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
}
