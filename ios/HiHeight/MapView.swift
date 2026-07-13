import SwiftUI
import MapLibre

// MLNMapView 를 SwiftUI 로 브리지. 스타일 JSON 은 번들 리소스(basemap-*.json)에서 로드하고,
// 그 안의 소스는 pmtiles://http://localhost:8890/pmtiles/… (맥 admin_server 프록시)를 가리킨다.
// S1 의 핵심 검증: MapLibre Native 가 pmtiles:// 원격 Range 소스를 렌더하는가.
struct MapView: UIViewRepresentable {
    let styleResource: String

    func makeUIView(context: Context) -> MLNMapView {
        let mv = MLNMapView(frame: .zero)
        mv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        mv.logoView.isHidden = false      // MapLibre 로고
        mv.attributionButton.isHidden = false  // OSM(ODbL)·Protomaps·Copernicus 저작자 표시 유지
        // 계양산 부근 초기 카메라 (웹 기본 진입과 유사한 등산 줌)
        mv.setCenter(CLLocationCoordinate2D(latitude: 37.53, longitude: 126.74),
                     zoomLevel: 12.5, animated: false)
        applyStyle(mv)
        return mv
    }

    func updateUIView(_ mv: MLNMapView, context: Context) {
        applyStyle(mv)   // 테마 전환 시 스타일 교체
    }

    private func applyStyle(_ mv: MLNMapView) {
        guard let url = Bundle.main.url(forResource: styleResource, withExtension: "json") else { return }
        if mv.styleURL != url {
            mv.styleURL = url
        }
    }
}
