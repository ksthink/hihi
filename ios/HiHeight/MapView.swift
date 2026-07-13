import SwiftUI
import MapLibre

// MLNMapView SwiftUI 브리지 — 카탈로그가 고른 산으로 카메라 이동 + 등고선 오버레이 소스 전환.
// 오버레이 레이어는 스타일 JSON 에 GL 표현식으로 정의(gen-style.mjs)돼 있고,
// 산이 바뀌면 소스 URL 만 교체한다(MLNShapeSource.url 가변) → NSExpression 불필요.
struct MapView: UIViewRepresentable {
    let styleResource: String
    let mountain: Mountain?
    var selectedCourse: Course? = nil
    var climbTrack: [[Double]] = []      // 등반 중 지나온 GPS 트랙 [lng,lat,...]
    var tracking: Bool = false           // 등반 중 — 현재위치 점 + 추적 카메라
    var recordTrack: [[Double]]? = nil   // 기록 루트 보기 — 저장된 트랙(점선) + fitBounds
    var locateTick: Int = 0              // 증가 시 현재위치로 이동(geolocate 버튼)
    var resetNorthTick: Int = 0          // 증가 시 방위·피치 초기화(나침반 버튼)
    var onCenterChanged: ((CLLocationCoordinate2D) -> Void)? = nil

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
        context.coordinator.onCenterChanged = onCenterChanged
        context.coordinator.apply(mountain: mountain, on: mv)
        context.coordinator.applyCourse(selectedCourse, on: mv)
        context.coordinator.setTrack(climbTrack, on: mv)
        context.coordinator.setRecordTrack(recordTrack, on: mv)
        context.coordinator.applyUserState(tracking: tracking, locateTick: locateTick,
                                            resetNorthTick: resetNorthTick, on: mv)
    }

    private func applyStyle(_ mv: MLNMapView) {
        guard let url = Bundle.main.url(forResource: styleResource, withExtension: "json") else { return }
        if mv.styleURL != url { mv.styleURL = url }
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        private var desired: Mountain?      // 목표 산
        private var cameraDone: String?     // 카메라를 맞춘 산코드 (중복 이동 방지)
        private var desiredCourse: Course?  // 선택 코스 (시종점 표시용)
        private var trackCount = -1         // 마지막 반영한 트랙 점 개수 (중복 갱신 방지)
        private var recTrackKey = ""        // 마지막 반영한 기록 트랙 식별 (중복 갱신·재fit 방지)
        private var lastLocate = 0, lastReset = 0
        private var locateOn = false        // geolocate 로 현재위치 점을 켠 상태
        var onCenterChanged: ((CLLocationCoordinate2D) -> Void)?

        // 현재위치 점 표시 + 추적 카메라 — 등반 중(tracking) 또는 geolocate 버튼(locateTick).
        // resetNorthTick 증가 시 방위·피치를 정북/수평으로 되돌린다.
        func applyUserState(tracking: Bool, locateTick: Int, resetNorthTick: Int, on mv: MLNMapView) {
            if resetNorthTick != lastReset {
                lastReset = resetNorthTick
                let c = mv.camera; c.heading = 0; c.pitch = 0
                mv.setCamera(c, withDuration: 0.4, animationTimingFunction: nil)
            }
            var follow = false
            if locateTick != lastLocate { lastLocate = locateTick; locateOn = true; follow = true }
            if tracking { locateOn = false }            // 등반 종료 후 geolocate 상태와 분리
            mv.showsUserLocation = tracking || locateOn
            if tracking, mv.userTrackingMode != .follow { follow = true }
            if !tracking && !locateOn, mv.userTrackingMode != .none {
                mv.setUserTrackingMode(.none, animated: false, completionHandler: nil)
            }
            if follow { mv.setUserTrackingMode(.follow, animated: true, completionHandler: nil) }
        }

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
            swap(style, "spots", Config.spotsURL(m.id))
        }

        // 스타일 JSON 의 geojson 소스 데이터 URL 만 교체(레이어·표현식 유지).
        private func swap(_ style: MLNStyle, _ id: String, _ url: URL?) {
            guard let url, let src = style.source(withIdentifier: id) as? MLNShapeSource else { return }
            if src.url != url { src.url = url }
        }

        // 코스 선택 → 시종점(course-ends) 갱신. 데이터는 런타임 파생이라 in-memory shape 로 주입.
        func applyCourse(_ c: Course?, on mv: MLNMapView) {
            desiredCourse = c
            if mv.style != nil { setCourseEnds(c, on: mv) }
        }

        private func setCourseEnds(_ c: Course?, on mv: MLNMapView) {
            guard let style = mv.style,
                  let src = style.source(withIdentifier: "course-ends") as? MLNShapeSource else { return }
            guard let c, let s = c.start, let e = c.end,
                  let data = Self.endsGeoJSON(start: s, end: e),
                  let shape = try? MLNShape(data: data, encoding: String.Encoding.utf8.rawValue) else {
                src.shape = nil; return
            }
            src.shape = shape
        }

        // 등반 라이브 트랙 — 트랙 점 배열을 LineString shape 로 climb-track 소스에 주입.
        // 점 수가 바뀔 때만 갱신(매 프레임 재직렬화 방지).
        func setTrack(_ track: [[Double]], on mv: MLNMapView) {
            guard mv.style != nil else { return }
            if track.count == trackCount { return }
            trackCount = track.count
            applyTrack(track, on: mv)
        }

        private func applyTrack(_ track: [[Double]], on mv: MLNMapView) {
            guard let style = mv.style,
                  let src = style.source(withIdentifier: "climb-track") as? MLNShapeSource else { return }
            guard track.count >= 2,
                  let data = Self.trackGeoJSON(track),
                  let shape = try? MLNShape(data: data, encoding: String.Encoding.utf8.rawValue) else {
                src.shape = nil; return
            }
            src.shape = shape
        }

        private static func trackGeoJSON(_ track: [[Double]]) -> Data? {
            let coords = track.map { [$0[0], $0[1]] }   // [lng,lat] 만
            let fc: [String: Any] = ["type": "Feature", "properties": [:],
                "geometry": ["type": "LineString", "coordinates": coords]]
            return try? JSONSerialization.data(withJSONObject: fc)
        }

        // 기록 루트 — rec-track 소스에 주입하고 트랙 범위로 카메라 이동(트랙이 바뀔 때만).
        func setRecordTrack(_ track: [[Double]]?, on mv: MLNMapView) {
            guard mv.style != nil else { return }
            let key = Self.key(track)
            if key == recTrackKey { return }
            recTrackKey = key
            applyRecordTrack(track, on: mv)
            if let track, track.count >= 2 { fit(track, on: mv) }
        }

        private static func key(_ t: [[Double]]?) -> String {
            guard let t, let f = t.first, let l = t.last else { return "" }
            return "\(t.count):\(f[0]),\(f[1])-\(l[0]),\(l[1])"
        }

        private func applyRecordTrack(_ track: [[Double]]?, on mv: MLNMapView) {
            guard let style = mv.style,
                  let src = style.source(withIdentifier: "rec-track") as? MLNShapeSource else { return }
            guard let track, track.count >= 2,
                  let data = Self.trackGeoJSON(track),
                  let shape = try? MLNShape(data: data, encoding: String.Encoding.utf8.rawValue) else {
                src.shape = nil; return
            }
            src.shape = shape
        }

        private func fit(_ track: [[Double]], on mv: MLNMapView) {
            var minX = 180.0, minY = 90.0, maxX = -180.0, maxY = -90.0
            for p in track {
                minX = min(minX, p[0]); maxX = max(maxX, p[0])
                minY = min(minY, p[1]); maxY = max(maxY, p[1])
            }
            let bounds = MLNCoordinateBounds(
                sw: CLLocationCoordinate2D(latitude: minY, longitude: minX),
                ne: CLLocationCoordinate2D(latitude: maxY, longitude: maxX))
            let pad = UIEdgeInsets(top: 90, left: 40, bottom: 320, right: 40)
            mv.setVisibleCoordinateBounds(bounds, edgePadding: pad, animated: true, completionHandler: nil)
        }

        private static func endsGeoJSON(start: [Double], end: [Double]) -> Data? {
            let fc: [String: Any] = ["type": "FeatureCollection", "features": [
                ["type": "Feature", "properties": ["kind": "start", "label": "출발"],
                 "geometry": ["type": "Point", "coordinates": start]],
                ["type": "Feature", "properties": ["kind": "end", "label": "도착"],
                 "geometry": ["type": "Point", "coordinates": end]],
            ]]
            return try? JSONSerialization.data(withJSONObject: fc)
        }

        // 스타일 로드(초기·테마 전환)마다 현재 목표 산 오버레이 + 시종점 재적용.
        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            if let d = desired { applyOverlay(d, on: mapView) }
            setCourseEnds(desiredCourse, on: mapView)
            trackCount = -1; recTrackKey = ""    // 스타일 재로드 시 트랙 재주입 강제
        }

        // 지도 이동 종료마다 중심 좌표 통지 → 국가지점번호 갱신.
        func mapView(_ mapView: MLNMapView, regionDidChangeAnimated animated: Bool) {
            onCenterChanged?(mapView.centerCoordinate)
        }
    }
}
