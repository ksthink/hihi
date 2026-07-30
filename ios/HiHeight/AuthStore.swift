import Foundation
import UIKit
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
    @Published var nickname: String?       // 프로필 닉네임(Supabase profiles) — nil=미설정
    @Published var avatar: UIImage?        // 프로필 이미지(기기 로컬 저장) — nil=기본 이미지
    @Published var records: [ClimbRecord] = []
    @Published var message: String?
    @Published var busy = false

    func refresh() async {
        // currentUser(동기)는 콜드 스타트 시 세션 스토리지가 비동기 로드되기 전이라 nil 이
        // 나올 수 있다. session(async)은 저장 세션을 로드/갱신하므로 재실행 로그인 유지에 필수.
        if let session = try? await client.auth.session {
            email = session.user.email
            await loadRecords()
            await loadProfile()
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
            await self.loadProfile()
        }
    }

    func signUp(_ e: String, _ p: String) async {
        await run {
            let res = try await self.client.auth.signUp(email: e, password: p)
            if let session = res.session {          // 이메일 확인 꺼짐 → 즉시 로그인
                self.email = session.user.email
                await self.loadRecords()
                await self.loadProfile()
            } else {                                 // 확인 메일 발송됨
                self.message = "확인 메일을 확인한 뒤 로그인하세요."
            }
        }
    }

    func signOut() async {
        try? await client.auth.signOut()
        email = nil; records = []; message = nil; nickname = nil; avatar = nil
    }

    // 프로필 로드 — 닉네임은 Supabase profiles, 아바타는 기기 로컬 파일(계정별).
    private var avatarURL: URL? {
        guard let uid = client.auth.currentUser?.id.uuidString.lowercased() else { return nil }
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("avatar-\(uid).jpg")
    }
    func loadProfile() async {
        struct Row: Decodable { let nickname: String? }
        if let uid = client.auth.currentUser?.id.uuidString.lowercased() {
            let rows: [Row] = (try? await client.from("profiles")
                .select("nickname").eq("user_id", value: uid).execute().value) ?? []
            nickname = rows.first?.nickname
        }
        if let u = avatarURL, let data = try? Data(contentsOf: u) { avatar = UIImage(data: data) }
        else { avatar = nil }
    }
    // 프로필 저장 — 닉네임 upsert(profiles) + 아바타 기기 로컬 저장/삭제.
    @discardableResult
    func saveProfile(nickname newNick: String, image: UIImage?, clearImage: Bool) async -> Bool {
        guard let uid = client.auth.currentUser?.id.uuidString.lowercased() else { return false }
        struct P: Encodable { let user_id: String; let nickname: String? }
        let nick = newNick.trimmingCharacters(in: .whitespaces)
        do {
            try await client.from("profiles").upsert(P(user_id: uid, nickname: nick.isEmpty ? nil : nick)).execute()
            nickname = nick.isEmpty ? nil : nick
        } catch {
            message = "프로필 저장 실패: \((error as NSError).localizedDescription)"; return false
        }
        if clearImage {
            if let u = avatarURL { try? FileManager.default.removeItem(at: u) }
            avatar = nil
        } else if let image, let u = avatarURL, let data = image.jpegData(compressionQuality: 0.85) {
            try? data.write(to: u); avatar = image
        }
        return true
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

    // 기록 삭제 (RLS: 본인 기록만). 낙관적 제거 후 서버 삭제.
    // .select() 로 삭제된 행을 돌려받아 0행(RLS 불일치·이미 삭제)이면 복원 + 안내.
    func deleteRecord(_ id: String) async {
        let backup = records
        records.removeAll { $0.id == id }        // 낙관적 제거 (즉시 반영)
        do {
            let deleted: [ClimbRecord] = try await client.from("climb_records")
                .delete().eq("id", value: id).select().execute().value
            if deleted.isEmpty {
                records = backup
                message = "삭제하지 못했습니다 — 로그인 상태를 확인해 주세요."
            } else {
                message = nil
            }
        } catch {
            records = backup                     // 실패 시 복원
            message = "삭제 실패: \((error as NSError).localizedDescription)"
        }
    }

    // 다운로드한 오프라인 팩을 계정에 표시(saved_packs upsert, 웹 동일). 로컬 파일은 이미 설치됐으므로
    // 비로그인이면 조용히 무시 — 오프라인 지도 설치 자체는 계정과 무관하게 동작한다.
    func saveDownloadedPack(_ mountainId: String) async {
        guard let uid = client.auth.currentUser?.id else { return }
        struct SavedPack: Encodable { let user_id: String; let mountain_id: String; let pack_version: Int }
        _ = try? await client.from("saved_packs")
            .upsert(SavedPack(user_id: uid.uuidString.lowercased(), mountain_id: mountainId, pack_version: 1))
            .execute()
    }

    // 저장된 팩을 계정에서 제거(saved_packs delete, 웹 동일). 로컬 파일 삭제는 PackStore 가 담당.
    func removeSavedPack(_ mountainId: String) async {
        guard client.auth.currentUser != nil else { return }
        _ = try? await client.from("saved_packs").delete().eq("mountain_id", value: mountainId).execute()
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
            ascent_m: elev?.ascent ?? Self.estimatedAscent(measuredKm: measuredKm,
                                                           plannedAscent: d.plannedAscent,
                                                           plannedKm: d.plannedDistanceKm),
            duration_s: duration,
            track: track.count >= 2
                ? TrackJSON(points: points, elev: elev, meta: d.diag.map(Self.diagJSON))
                : nil)

        do {
            try await client.from("climb_records").insert(rec).execute()
            await loadRecords()
            let pts = rec.track.map { " · GPS \($0.points.count)지점" } ?? ""
            return "등반 기록 저장 완료 — \(String(format: "%.2f", measuredKm))km · \(Self.clock(duration))\(pts)"
        } catch {
            return "기록 저장 실패: \((error as NSError).localizedDescription)"
        }
    }

    // 실측 고도가 없을 때의 누적고도 추정 — 코스 계획고도를 "실제 걸은 비율"만큼만 인정한다.
    // 예전엔 계획고도를 통째로 적립해, 시작하자마자 종료한 0km 세션도 코스 전체 고도(예 315m)가
    // 기록돼 합계가 크게 부풀었다. 거의 움직이지 않았으면(0.2km 미만) 아예 기록하지 않는다(nil).
    private static func estimatedAscent(measuredKm: Double, plannedAscent: Int?, plannedKm: Double?) -> Int? {
        guard measuredKm >= 0.2, let pa = plannedAscent, pa > 0, let pk = plannedKm, pk > 0 else { return nil }
        return Int((Double(pa) * min(1.0, measuredKm / pk)).rounded())
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
        let meta: DiagJSON?       // 진단 요약(2026-07-29 추가) — 없던 기록은 이 키가 없다
    }
    private struct ElevStat: Encodable { let min, max, ascent, descent: Int }

    // track.meta — 배터리·GPS 진단 요약. 관리자 콘솔이 /api/records 로 읽어 소모율을 집계한다.
    // v 는 포맷 버전(소비 측이 키 추가/변경을 구분). v2 = device·os·build 추가(2026-07-30).
    private struct DiagJSON: Encodable {
        let v: Int
        let bat_start: Int        // 0~100, -1 = 미측정(시뮬레이터·이어하기)
        let bat_end: Int
        let low_power: Bool
        let charged: Bool         // 등반 중 충전 — true 면 소모량은 무의미
        let gps_mode: String
        let fixes: Int
        let fixes_dropped: Int    // 정확도 게이트 탈락 수 — 신호 품질 지표
        let acc_avg: Double       // 평균 수평정확도(m), 표본 없으면 -1
        // 비교 축 — 이 셋이 없으면 "최적화 전후로 나아졌나"(빌드)와 "기기 탓인가"(모델·OS)를
        // 구분할 수 없다. 소모율은 기기 배터리 용량·노후도에 크게 좌우된다.
        let device: String        // "iPhone14,2" — UIDevice.model 은 "iPhone" 만 주므로 uname
        let os: String            // "26.0"
        let build: String         // CFBundleVersion (= git 커밋 수, 스플래시 표시와 같은 값)
    }

    // 기기 모델 식별자 — uname(2) 의 machine. UIDevice 에는 이 값을 주는 API 가 없다.
    private static var deviceModel: String {
        var s = utsname(); uname(&s)
        return withUnsafeBytes(of: &s.machine) { raw in
            guard let base = raw.baseAddress else { return "?" }
            return String(cString: base.assumingMemoryBound(to: CChar.self))
        }
    }

    private static func diagJSON(_ d: ClimbDiag) -> DiagJSON {
        DiagJSON(v: 2,
                 bat_start: d.batStart, bat_end: d.batEnd,
                 low_power: d.lowPower, charged: d.charged,
                 gps_mode: d.gpsMode,
                 fixes: d.fixes, fixes_dropped: d.fixesDropped, acc_avg: d.accAvg,
                 device: deviceModel,
                 os: UIDevice.current.systemVersion,
                 build: Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?")
    }

    private func run(_ op: @escaping () async throws -> Void) async {
        busy = true; message = nil
        do { try await op() }
        catch { message = "실패: \((error as NSError).localizedDescription)" }
        busy = false
    }
}
