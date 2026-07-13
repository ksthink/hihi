import Foundation

// 접속 상수. 스파이크/개발: 타일·글리프·팩 오버레이는 맥 admin_server 프록시 경유.
// 본 이식 배포 시 R2 커스텀 도메인(IOS.md §8-1)으로 교체 예정.
enum Config {
    // 개발용 맥 admin_server 주소. 실기기는 localhost 로 맥에 못 붙으니 맥 LAN IP 사용
    // (같은 WiFi 필요, IP 바뀌면 갱신). 시뮬레이터도 이 IP 로 동작. 배포 시 R2 커스텀 도메인(§8-1).
    static let proxyBase = "http://localhost:8890"
    // R2 공개 엔드포인트 — config/큐레이션 이미지 직결(웹과 동일). 배포 시 커스텀 도메인(§8-1)으로 교체.
    static let r2Public = "https://pub-cfc2302f77a446c1a0fdff6d0ae4e451.r2.dev"
    static var curationsURL: URL? { URL(string: "\(r2Public)/config/curations.json") }

    // Supabase — publishable 키는 RLS 로 보호되어 클라이언트 노출 안전(§11).
    static let supabaseURL = "https://durnojryhhsajnlwvdzt.supabase.co"
    static let supabaseKey = "sb_publishable_qltsOvZhvVwPF5YNQARgCg_6KcV6Km5"

    // 팩 오버레이(등고선/스팟/루트) — admin_server 정적 서빙(data/packs/<코드>/…)
    static func contoursURL(_ code: String) -> URL? {
        URL(string: "\(proxyBase)/data/packs/\(code)/contours.geojson")
    }
    static func routesURL(_ code: String) -> URL? {
        URL(string: "\(proxyBase)/data/packs/\(code)/routes.geojson")
    }
    static func spotsURL(_ code: String) -> URL? {
        URL(string: "\(proxyBase)/data/packs/\(code)/spots.geojson")
    }

    // 기상청 단기예보 프록시 — 웹 /api/weather 와 동일 계약(CORS 회피·키 은닉).
    // 배포 시 네이티브 직접 호출(KMA)로 교체 예정(IOS.md). op=ufcst|vfcst|ncst.
    static func weatherURL(op: String, nx: Int, ny: Int, baseDate: String, baseTime: String) -> URL? {
        URL(string: "\(proxyBase)/api/weather?op=\(op)&nx=\(nx)&ny=\(ny)&base_date=\(baseDate)&base_time=\(baseTime)")
    }
}
