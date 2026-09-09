import Foundation

// 카탈로그 로드 — 웹 loadCatalog(app.js:36)의 네이티브 대응.
// M1 은 읽기전용 공개 데이터라 URLSession + Supabase REST 로 충분.
// 인증·기록 쓰기(M3)에서 supabase-swift SDK 를 도입한다(IOS.md §3).
@MainActor
final class CatalogStore: ObservableObject {
    @Published var mountains: [Mountain] = []
    // 선택된 산. 바뀔 때마다 산코드를 남겨, 앱을 껐다 켜도 마지막에 보던 산으로 돌아온다.
    // (예전엔 항상 목록 첫 산이라 북한산을 보다 앱을 닫으면 계양산으로 되돌아왔다.)
    @Published var selected: Mountain? {
        didSet {
            guard let id = selected?.id, id != oldValue?.id else { return }
            UserDefaults.standard.set(id, forKey: Self.lastKey)
        }
    }
    @Published var error: String?

    static let lastKey = "hiheight-last-mountain"   // 관례 접두사 hiheight-
    /// 마지막에 보던 산코드(없으면 nil) — 등반 탭도 초기 선택에 같은 값을 쓴다.
    static var lastMountainID: String? { UserDefaults.standard.string(forKey: lastKey) }

    func load() async {
        guard var comps = URLComponents(string: "\(Config.supabaseURL)/rest/v1/mountains") else { return }
        comps.queryItems = [
            .init(name: "select", value: "id,name,center,zoom,bbox,elev,region,famous,lists,sort_order,published,pack_version,pack_size_kb"),
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
            // 마지막에 보던 산 > 목록 첫 산. 그 산이 비공개로 바뀌었거나 사라졌으면 자연히 첫 산.
            if selected == nil {
                selected = list.first { $0.id == Self.lastMountainID } ?? list.first
            }
        } catch {
            // 오프라인/실패 — 본 이식에선 마지막 카탈로그 캐시 폴백(웹 동일). M1 은 에러 표기만.
            self.error = "카탈로그 로드 실패: \(error.localizedDescription)"
        }
    }
}
