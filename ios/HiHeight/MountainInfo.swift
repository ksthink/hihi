import Foundation

// mountain_info 테이블(산림청 원본) — 산 소개 카드의 소개·관리주체(웹 §6 mountain_info 조인).
// mountains(카탈로그)와 별도, 산코드(code)로 조인. 공개 읽기(RLS select true).
struct MountainInfo: Decodable {
    let code: String
    let manager: String?
    let manager_tel: String?
    let description: String?
}

enum InfoLoader {
    static func load(_ code: String) async -> MountainInfo? {
        guard var comps = URLComponents(string: "\(Config.supabaseURL)/rest/v1/mountain_info") else { return nil }
        comps.queryItems = [
            .init(name: "select", value: "code,manager,manager_tel,description"),
            .init(name: "code", value: "eq.\(code)"),
            .init(name: "limit", value: "1"),
        ]
        guard let url = comps.url else { return nil }
        var req = URLRequest(url: url)
        req.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(Config.supabaseKey)", forHTTPHeaderField: "Authorization")
        do {
            let (data, _) = try await URLSession.shared.data(for: req)
            return try JSONDecoder().decode([MountainInfo].self, from: data).first
        } catch {
            return nil
        }
    }
}
