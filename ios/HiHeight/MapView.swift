import SwiftUI
import MapLibre

// MLNMapView SwiftUI 브리지 — 카탈로그가 고른 산으로 카메라 이동 + 등고선 오버레이 소스 전환.
// 오버레이 레이어는 스타일 JSON 에 GL 표현식으로 정의(gen-style.mjs)돼 있고,
// 산이 바뀌면 소스 URL 만 교체한다(MLNShapeSource.url 가변) → NSExpression 불필요.
struct MapView: UIViewRepresentable {
    let styleResource: String
    let mountain: Mountain?

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> MLNMapView {
        let mv = MLNMapView(frame: .zero)
        mv.delegate = context.coordinator
        mv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        mv.logoView.isHidden = false
        mv.attributionButton.isHidden = false           // OSM·Protomaps·Copernicus 저작자 표시
        applyStyle(mv)
        return mv
    }

    func updateUIView(_ mv: MLNMapView, context: Context) {
        applyStyle(mv)                                   // 테마 전환 시 스타일 교체
        context.coordinator.apply(mountain: mountain, on: mv)
    }

    private func applyStyle(_ mv: MLNMapView) {
        guard let url = Bundle.main.url(forResource: styleResource, withExtension: "json") else { return }
        if mv.styleURL != url { mv.styleURL = url }
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        private var desired: Mountain?      // 목표 산
        private var cameraDone: String?     // 카메라를 맞춘 산코드 (중복 이동 방지)

        func apply(mountain m: Mountain?, on mv: MLNMapView) {
            guard let m else { return }
            let isSwitch = desired?.id != m.id
            desired = m
            // 카메라 — 스타일과 무관하게 즉시 (산이 바뀌었을 때만)
            if cameraDone != m.id {
                moveCamera(to: m, on: mv, animated: cameraDone != nil)
                cameraDone = m.id
            }
            // 오버레이 — 스타일이 로드돼 있어야 소스 접근 가능. 아니면 didFinishLoading 에서 처리.
            if mv.style != nil { applyOverlay(m, on: mv) }
            _ = isSwitch
        }

        private func moveCamera(to m: Mountain, on mv: MLNMapView, animated: Bool) {
            if let b = m.coordinateBounds {
                let bounds = MLNCoordinateBounds(sw: b.sw, ne: b.ne)
                let pad = UIEdgeInsets(top: 70, left: 24, bottom: 48, right: 24)
                mv.setVisibleCoordinateBounds(bounds, edgePadding: pad, animated: animated, completionHandler: nil)
            } else {
                mv.setCenter(m.coordinate, zoomLevel: m.zoom + 2, animated: animated)
            }
        }

        private func applyOverlay(_ m: Mountain, on mv: MLNMapView) {
            guard let style = mv.style else { return }
            swap(style, "contours", Config.contoursURL(m.id))
            swap(style, "trails", Config.routesURL(m.id))
        }

        // 스타일 JSON 의 geojson 소스 데이터 URL 만 교체(레이어·표현식 유지).
        private func swap(_ style: MLNStyle, _ id: String, _ url: URL?) {
            guard let url, let src = style.source(withIdentifier: id) as? MLNShapeSource else { return }
            if src.url != url { src.url = url }
        }

        // 스타일 로드(초기·테마 전환)마다 현재 목표 산 오버레이 재적용.
        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            if let d = desired { applyOverlay(d, on: mapView) }
        }
    }
}
