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
    let credit: String?       // 사진 저작자(우하단)
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
        // admin 에서 큐레이션을 바꿔도 앱에 몇 시간 반영되지 않던 버그(2026-07-20) 대응.
        // R2 가 Cache-Control 을 안 보내면 URLSession 이 휴리스틱 캐싱
        // ((now - Last-Modified) × 10%) 으로 옛 응답을 재사용한다. URLCache 는 디스크에
        // 남아 앱을 완전히 종료해도 살아남는다. 서버에도 no-cache 를 넣었지만(r2_lib),
        // 헤더가 빠져도 안전하도록 클라이언트에서 로컬 캐시를 건너뛴다(문서 1KB 미만).
        // 웹은 같은 목적으로 fetch(url, { cache: "no-cache" }) 를 쓴다(app.js).
        req.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, _) = try? await URLSession.shared.data(for: req),
              let doc = try? JSONDecoder().decode(Doc.self, from: data) else { return [] }
        // 카탈로그에 없는 산/코스는 열 수 없으나 표시는 유지(웹은 필터) — M2-S4 는 표시 우선.
        return doc.curations
    }
}
