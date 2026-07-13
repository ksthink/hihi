import Foundation
import Supabase

// 세션 저장소 — supabase-swift 기본값은 Keychain 인데, 서명 없는 시뮬레이터 앱은
// Keychain 쓰기가 실패해 로그인이 유지되지 않는다(탭 전환·재실행마다 로그아웃).
// UserDefaults 로 교체(IOS.md 의 localStorage→UserDefaults 방향과 일치).
// 서명된 배포 빌드에선 Keychain 으로 되돌려 토큰 보안을 강화할 수 있다.
struct UserDefaultsLocalStorage: AuthLocalStorage {
    func store(key: String, value: Data) throws { UserDefaults.standard.set(value, forKey: key) }
    func retrieve(key: String) throws -> Data? { UserDefaults.standard.data(forKey: key) }
    func remove(key: String) throws { UserDefaults.standard.removeObject(forKey: key) }
}

// 계정·기록 백엔드 — supabase-swift(IOS.md §3). 스키마·RLS 무변경 재사용.
// climb_records 는 RLS(own_records)로 로그인 사용자 본인 기록만 조회된다.
@MainActor
final class AuthStore: ObservableObject {
    let client = SupabaseClient(
        supabaseURL: URL(string: Config.supabaseURL)!,
        supabaseKey: Config.supabaseKey,
        options: SupabaseClientOptions(auth: .init(storage: UserDefaultsLocalStorage())))

    @Published var email: String?          // 로그인 사용자 이메일(nil=비로그인)
    @Published var records: [ClimbRecord] = []
    @Published var message: String?
    @Published var busy = false

    func refresh() async {
        // currentUser(동기)는 콜드 스타트 시 세션 스토리지가 비동기 로드되기 전이라 nil 이
        // 나올 수 있다. session(async)은 저장 세션을 로드/갱신하므로 재실행 로그인 유지에 필수.
        if let session = try? await client.auth.session {
            email = session.user.email
            await loadRecords()
        } else {
            email = nil
        }
    }

    func signIn(_ e: String, _ p: String) async {
        await run {
            // 반환된 세션을 직접 사용 — currentUser 재조회 타이밍에 의존하지 않는다.
            let session = try await self.client.auth.signIn(email: e, password: p)
            self.email = session.user.email
            await self.loadRecords()
        }
    }

    func signUp(_ e: String, _ p: String) async {
        await run {
            let res = try await self.client.auth.signUp(email: e, password: p)
            if let session = res.session {          // 이메일 확인 꺼짐 → 즉시 로그인
                self.email = session.user.email
                await self.loadRecords()
            } else {                                 // 확인 메일 발송됨
                self.message = "확인 메일을 확인한 뒤 로그인하세요."
            }
        }
    }

    func signOut() async {
        try? await client.auth.signOut()
        email = nil; records = []; message = nil
    }

    func loadRecords() async {
        do {
            records = try await client.from("climb_records")
                .select("id,mountain_id,course_name,started_at,distance_km,ascent_m,duration_s,track")
                .order("started_at", ascending: false)
                .execute().value
        } catch {
            records = []
        }
    }

    // 기록 삭제 (RLS: 본인 기록만). 성공 시 목록 갱신.
    func deleteRecord(_ id: String) async {
        do {
            try await client.from("climb_records").delete().eq("id", value: id).execute()
            await loadRecords()
        } catch {
            message = "삭제 실패: \((error as NSError).localizedDescription)"
        }
    }

    // MARK: 등반 기록 저장 (웹 saveClimb 이식) — 종료 시 climb_records 삽입 후 목록 갱신.
    // 반환값은 사용자 안내 메시지.
    func saveClimb(_ d: ClimbDraft) async -> String {
        guard let uid = client.auth.currentUser?.id else { return "로그인이 필요합니다." }

        // 트랙 솎아내기 (기록당 최대 2000지점)
        var track = d.track
        if track.count > 2000 {
            let step = Double(track.count) / 2000
            track = (0..<2000).map { track[Int(Double($0) * step)] }
        }
        let elev = track.count >= 2 ? Self.elevStats(track) : nil
        let measuredKm = (d.distanceKm * 100).rounded() / 100
        let duration = max(1, Int(d.endedAt.timeIntervalSince(d.startedAt).rounded()))

        // points: 고도 -1(없음) → null 로 저장(웹 포맷과 동일).
        let points: [[Double?]] = track.map { pt in
            [pt[0], pt[1], pt[2] >= 0 ? pt[2] : nil, pt[3]]
        }
        let rec = ClimbInsert(
            user_id: uid.uuidString.lowercased(),
            mountain_id: d.mountainCode,
            course_name: d.courseName,
            started_at: Self.iso.string(from: d.startedAt),
            ended_at: Self.iso.string(from: d.endedAt),
            distance_km: measuredKm,
            ascent_m: elev?.ascent ?? d.plannedAscent,
            duration_s: duration,
            track: track.count >= 2 ? TrackJSON(points: points, elev: elev) : nil)

        do {
            try await client.from("climb_records").insert(rec).execute()
            await loadRecords()
            let pts = rec.track.map { " · GPS \($0.points.count)지점" } ?? ""
            return "등반 기록 저장 완료 — \(String(format: "%.2f", measuredKm))km · \(Self.clock(duration))\(pts)"
        } catch {
            return "기록 저장 실패: \((error as NSError).localizedDescription)"
        }
    }

    // 트랙 고도 통계 — 이동평균(창5)으로 잡음 제거 후 누적 상승/하강 (app.js:1473).
    // 고도 샘플 10개 미만 또는 전체 점 절반 미만이면 신뢰 불가 → nil(코스 계획값 사용).
    private static func elevStats(_ track: [[Double]]) -> ElevStat? {
        let seq = track.compactMap { $0.count > 2 && $0[2] >= 0 ? $0[2] : nil }
        if seq.count < 10 || Double(seq.count) < Double(track.count) / 2 { return nil }
        let W = 5
        let smooth = seq.indices.map { i -> Double in
            let s = seq[max(0, i - W + 1)...i]
            return s.reduce(0, +) / Double(s.count)
        }
        var up = 0.0, down = 0.0
        for i in 1..<smooth.count {
            let dv = smooth[i] - smooth[i - 1]
            if dv > 0 { up += dv } else { down -= dv }
        }
        return ElevStat(min: Int(seq.min()!.rounded()), max: Int(seq.max()!.rounded()),
                        ascent: Int(up.rounded()), descent: Int(down.rounded()))
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static func clock(_ s: Int) -> String {
        String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
    }

    // 합계 (총 산행/거리/누적고도)
    var totalCount: Int { records.count }
    var totalKm: Double { records.compactMap(\.distance_km).reduce(0, +) }
    var totalAscent: Int { records.compactMap(\.ascent_m).reduce(0, +) }

    // climb_records 삽입 페이로드 (track jsonb 포함).
    private struct ClimbInsert: Encodable {
        let user_id: String
        let mountain_id: String?
        let course_name: String
        let started_at: String
        let ended_at: String
        let distance_km: Double
        let ascent_m: Int?
        let duration_s: Int
        let track: TrackJSON?
    }
    private struct TrackJSON: Encodable {
        let points: [[Double?]]   // [lng, lat, 고도|null, unix초]
        let elev: ElevStat?
    }
    private struct ElevStat: Encodable { let min, max, ascent, descent: Int }

    private func run(_ op: @escaping () async throws -> Void) async {
        busy = true; message = nil
        do { try await op() }
        catch { message = "실패: \((error as NSError).localizedDescription)" }
        busy = false
    }
}
