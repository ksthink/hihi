import Foundation

// 추천 탭 큐레이션 — R2 config/curations.json (admin 발행). 웹 renderReco/pickCarousel 대응.
struct Curation: Decodable, Identifiable {
    let id: String
    let title: String
    let items: [CurationItem]
}

struct CurationItem: Decodable, Identifiable {
    // "mountain" | "course" | "spot"(2026-08-01) | "free"(빈 카드 — 이동 대상 없음)
    let type: String
    let code: String          // 산코드 (course 도 대표 산코드). free 는 free-<hex> 합성 키
    let name: String?
    let sub: String?
    let title: String?
    let desc: String?
    let logo: String?
    let credit: String?       // 사진 저작자(우하단)
    let img: String?
    let mountain: String?
    // spot 카드의 목표 좌표 [lng, lat] — 탭하면 이 지점으로 지도를 옮긴다(웹 openCurationItem).
    let coord: [Double]?
    // free 카드의 외부 링크(관리자가 https 만 저장). 있으면 탭 시 사파리로 연다.
    let url: String?

    var id: String { code + "-" + (title ?? name ?? "") }
    var displayMountain: String { type == "mountain" ? (name ?? "") : (mountain ?? name ?? "") }

    // 빈 카드 — 산·코스로 이동하지 않는다. code 가 free-<hex> 합성 키라 산 탐색에 넘기면 안 된다.
    var isFree: Bool { type == "free" }
    var linkURL: URL? {
        guard let url, url.hasPrefix("https://") else { return nil }   // https 만(관리자 저장 규칙)
        return URL(string: url)
    }
    var spotCoord: [Double]? {
        guard type == "spot", let c = coord, c.count >= 2 else { return nil }
        return c
    }
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
