import Foundation
import CoreLocation

// mountains 카탈로그 1행 (Supabase). 웹 loadCatalog(app.js:36)과 동일 소비 형태.
// id = 산코드 9자리(전 시스템 표준 키). center=[lng,lat], bbox=[minLng,minLat,maxLng,maxLat].
struct Mountain: Identifiable, Decodable, Equatable {
    let id: String
    let name: String
    let center: [Double]
    let zoom: Double
    let bbox: [Double]?
    let elev: Int?
    let region: String?
    let famous: Bool?
    let lists: [String]?     // 공식 추천 카테고리(bac100·knps 등, migrations-002)
    let pack_version: Int?   // 팩 버전(배포마다 +1) — 저장된 지도 업데이트 여부 판단
    let pack_size_kb: Int?   // 팩 용량 — 다운로드 확인 창에 미리 알린다(웹 app.js 와 같은 출처)

    /// "2.9MB" — 웹 app.js 와 같은 계산(KB→MB, 소수 첫째 자리). 값이 없으면 nil 이라
    /// 호출부가 용량 줄 자체를 빼도록 한다. 0 도 없는 것으로 본다(발행 전 산은 0 으로 들어온다).
    var packSizeText: String? {
        guard let kb = pack_size_kb, kb > 0 else { return nil }
        return String(format: "%.1fMB", Double(kb) / 1024)
    }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: center[1], longitude: center[0])
    }

    // bbox → MapLibre 좌표 경계 (fitBounds 용). 없으면 nil.
    var coordinateBounds: MLNCoordinateBoundsBox? {
        guard let b = bbox, b.count == 4 else { return nil }
        return MLNCoordinateBoundsBox(
            sw: CLLocationCoordinate2D(latitude: b[1], longitude: b[0]),
            ne: CLLocationCoordinate2D(latitude: b[3], longitude: b[2]))
    }
}

// MLNCoordinateBounds 는 struct 라 옵셔널 전달이 번거로워 얇은 래퍼로 감싼다.
struct MLNCoordinateBoundsBox {
    let sw: CLLocationCoordinate2D
    let ne: CLLocationCoordinate2D
}
