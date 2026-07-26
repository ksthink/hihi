import Foundation

// 카탈로그 로드 — 웹 loadCatalog(app.js:36)의 네이티브 대응.
// M1 은 읽기전용 공개 데이터라 URLSession + Supabase REST 로 충분.
// 인증·기록 쓰기(M3)에서 supabase-swift SDK 를 도입한다(IOS.md §3).
@MainActor
final class CatalogStore: ObservableObject {
    @Published var mountains: [Mountain] = []
    @Published var selected: Mountain?
    @Published var error: String?

    func load() async {
        guard var comps = URLComponents(string: "\(Config.supabaseURL)/rest/v1/mountains") else { return }
        comps.queryItems = [
            .init(name: "select", value: "id,name,center,zoom,bbox,elev,region,famous,lists,sort_order,published,pack_version"),
            .init(name: "published", value: "eq.true"),
            .init(name: "order", value: "sort_order,name"),
        ]
        guard let url = comps.url else { return }
        var req = URLRequest(url: url)
        req.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(Config.supabaseKey)", forHTTPHeaderField: "Authorization")
        do {
            let (data, _) = try await URLSession.shared.data(for: req)
            let list = try JSONDecoder().decode([Mountain].self, from: data)
            mountains = list
            if selected == nil { selected = list.first }
        } catch {
            // 오프라인/실패 — 본 이식에선 마지막 카탈로그 캐시 폴백(웹 동일). M1 은 에러 표기만.
            self.error = "카탈로그 로드 실패: \(error.localizedDescription)"
        }
    }
}
