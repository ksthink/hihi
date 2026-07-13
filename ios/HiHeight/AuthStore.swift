import Foundation
import Supabase

// 계정·기록 백엔드 — supabase-swift(IOS.md §3). 스키마·RLS 무변경 재사용.
// climb_records 는 RLS(own_records)로 로그인 사용자 본인 기록만 조회된다.
@MainActor
final class AuthStore: ObservableObject {
    let client = SupabaseClient(
        supabaseURL: URL(string: Config.supabaseURL)!,
        supabaseKey: Config.supabaseKey)

    @Published var email: String?          // 로그인 사용자 이메일(nil=비로그인)
    @Published var records: [ClimbRecord] = []
    @Published var message: String?
    @Published var busy = false

    func refresh() async {
        email = client.auth.currentUser?.email
        if email != nil { await loadRecords() }
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
                .select("id,mountain_id,course_name,started_at,distance_km,ascent_m,duration_s")
                .order("started_at", ascending: false)
                .execute().value
        } catch {
            records = []
        }
    }

    // 합계 (총 산행/거리/누적고도)
    var totalCount: Int { records.count }
    var totalKm: Double { records.compactMap(\.distance_km).reduce(0, +) }
    var totalAscent: Int { records.compactMap(\.ascent_m).reduce(0, +) }

    private func run(_ op: @escaping () async throws -> Void) async {
        busy = true; message = nil
        do { try await op() }
        catch { message = "실패: \((error as NSError).localizedDescription)" }
        busy = false
    }
}
