import Foundation

// 추천 탭 큐레이션 — R2 config/curations.json (admin 발행). 웹 renderReco/pickCarousel 대응.
struct Curation: Decodable, Identifiable {
    let id: String
    let title: String
    let items: [CurationItem]
}

struct CurationItem: Decodable, Identifiable {
    let type: String          // "mountain" | "course"
    let code: String          // 산코드 (course 도 대표 산코드)
    let name: String?
    let sub: String?
    let title: String?
    let desc: String?
    let logo: String?
    let img: String?
    let mountain: String?

    var id: String { code + "-" + (title ?? name ?? "") }
    var displayMountain: String { type == "mountain" ? (name ?? "") : (mountain ?? name ?? "") }
}

enum CurationLoader {
    private struct Doc: Decodable { let curations: [Curation] }

    static func load() async -> [Curation] {
        guard let url = Config.curationsURL else { return [] }
        var req = URLRequest(url: url)
        req.setValue("hiheight/1.0", forHTTPHeaderField: "User-Agent")  // R2 dev UA 403 우회
        guard let (data, _) = try? await URLSession.shared.data(for: req),
              let doc = try? JSONDecoder().decode(Doc.self, from: data) else { return [] }
        // 카탈로그에 없는 산/코스는 열 수 없으나 표시는 유지(웹은 필터) — M2-S4 는 표시 우선.
        return doc.curations
    }
}
