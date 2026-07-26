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

    // 지점별 전체 정보 — [lng, lat, 고도(없으면 nil), unix초(없으면 nil)].
    // 고도 프로필·GPX 내보내기용(고도·시각 보존). trackPoints 는 좌표만이라 이걸로 파생.
    struct TrackPt { let lng, lat: Double; let ele: Double?; let time: Double? }
    var trackFull: [TrackPt] {
        (track?.points ?? []).compactMap { p in
            guard p.count >= 2, let lng = p[0], let lat = p[1] else { return nil }
            let ele = p.count > 2 ? p[2].flatMap { $0 >= 0 ? $0 : nil } : nil   // 저장 시 null, 방어적으로 음수도 제외
            let time = p.count > 3 ? p[3] : nil
            return TrackPt(lng: lng, lat: lat, ele: ele, time: time)
        }
    }
    // 고도값이 있는 지점이 2개 이상이면 프로필을 그릴 수 있다.
    var hasElevation: Bool { trackFull.filter { $0.ele != nil }.count >= 2 }

    var startedDate: Date? {
        started_at.flatMap { ISO8601DateFormatter().date(from: $0) }
            ?? started_at.flatMap { ClimbRecord.fracFmt.date(from: $0) }
    }
    private static let fracFmt: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
}
