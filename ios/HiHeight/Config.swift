import Foundation

// 접속 상수. 스파이크/개발: 타일·글리프·팩 오버레이는 맥 admin_server 프록시 경유.
// 본 이식 배포 시 R2 커스텀 도메인(IOS.md §8-1)으로 교체 예정.
enum Config {
    static let proxyBase = "http://localhost:8890"

    // Supabase — publishable 키는 RLS 로 보호되어 클라이언트 노출 안전(§11).
    static let supabaseURL = "https://durnojryhhsajnlwvdzt.supabase.co"
    static let supabaseKey = "sb_publishable_qltsOvZhvVwPF5YNQARgCg_6KcV6Km5"

    // 팩 오버레이(등고선/스팟/루트) — admin_server 정적 서빙(data/packs/<코드>/…)
    static func contoursURL(_ code: String) -> URL? {
        URL(string: "\(proxyBase)/data/packs/\(code)/contours.geojson")
    }
}
