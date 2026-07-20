import Foundation

// 접속 상수. 스파이크/개발: 타일·글리프·팩 오버레이는 맥 admin_server 프록시 경유.
// 본 이식 배포 시 R2 커스텀 도메인(IOS.md §8-1)으로 교체 예정.
enum Config {
    // 날씨 프록시 — Vercel 배포(HTTPS:443). 웹앱과 동일 /api/weather(기상청 키 은닉). 맥 의존 제거.
    static let proxyBase = "https://hihi.ksthink.com"
    // R2 커스텀 도메인 직결(타일·팩·config·이미지). dev pub 엔드포인트(레이트리밋·UA403) 대체(§8-1).
    static let r2Public = "https://hihi.metaphr.dev"
    static var curationsURL: URL? { URL(string: "\(r2Public)/config/curations.json") }

    // Supabase — publishable 키는 RLS 로 보호되어 클라이언트 노출 안전(§11).
    static let supabaseURL = "https://durnojryhhsajnlwvdzt.supabase.co"
    static let supabaseKey = "sb_publishable_qltsOvZhvVwPF5YNQARgCg_6KcV6Km5"

    // 팩 오버레이(등고선/스팟/루트) — 웹과 동일하게 R2(packs/<코드>/…) 직결.
    // 관리자 '배포'가 R2 로 올리므로, 로컬 맥/EC2 어디서 배포하든 즉시 같은 소스를 읽는다.
    // (프록시 data/packs 는 로컬 맥 파일이라 EC2 관리자 배포가 반영 안 됐다.)
    // 팩 파일 원격 URL(다운로드/온라인 소스용). 오프라인은 PackStore 의 로컬 파일로 대체.
    static func packURL(_ code: String, _ file: String) -> URL? {
        URL(string: "\(r2Public)/packs/\(code)/\(file)")
    }
    static func contoursURL(_ code: String) -> URL? { packURL(code, "contours.geojson") }
    static func routesURL(_ code: String) -> URL? { packURL(code, "routes.geojson") }
    static func spotsURL(_ code: String) -> URL? { packURL(code, "spots.geojson") }
    static func baseTilesURL(_ code: String) -> URL? { packURL(code, "base.pmtiles") }

    // 기상청 단기예보 프록시 — 웹 /api/weather 와 동일 계약(키 은닉). op=ufcst|vfcst|ncst.
    // 프록시는 배포 후에도 유지한다 — data.go.kr 개인 키를 앱 바이너리에 심으면 추출·도용·쿼터
    // 소진 위험. (IOS.md §2 "네이티브도 이 프록시를 그대로 호출" · §13 "앱에 키 미포함")
    static func weatherURL(op: String, nx: Int, ny: Int, baseDate: String, baseTime: String) -> URL? {
        URL(string: "\(proxyBase)/api/weather?op=\(op)&nx=\(nx)&ny=\(ny)&base_date=\(baseDate)&base_time=\(baseTime)")
    }
}
