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
    var locateTick: Int = 0              // 증가 시 현재위치로 이동 + 정북·수평 복원(위치/나침반 통합 버튼)
    var fitCourseTick: Int = 0           // 증가 시 선택 코스 범위로 fitBounds(코스 탭)
    var onCenterChanged: ((CLLocationCoordinate2D) -> Void)? = nil
    var onScaleChanged: ((Double) -> Void)? = nil    // 지도 이동 시 축척(m/point) 통지 → 커스텀 스케일바

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> MLNMapView {
        let mv = MLNMapView(frame: .zero)
        mv.delegate = context.coordinator
        mv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        // 지도 장식(웹 오버레이 대응): 로고 숨김, 스케일바(좌하단)·저작권 ⓘ(우하단)·나침반 숨김.
        // 시트가 하단을 덮으므로 시트 위로 올린다(y 여백).
        mv.showsLogoView = false
        mv.showsScale = false                            // 웹식 단일 눈금 스케일바를 SwiftUI 로 직접 그림
        mv.showsAttributionButton = true
        mv.attributionButtonPosition = .bottomRight
        mv.attributionButtonMargins = CGPoint(x: 12, y: 300)
        mv.showsCompassView = false                      // 나침반은 위치 버튼에 통합
        context.coordinator.dark = styleResource.contains("dark")
        applyStyle(mv)
        return mv
    }

    func updateUIView(_ mv: MLNMapView, context: Context) {
        context.coordinator.dark = styleResource.contains("dark")
        applyStyle(mv)                                   // 테마 전환 시 스타일 교체
        mv.scaleBarShouldShowDarkStyles = !context.coordinator.dark   // 밝은 지도→어두운 스케일바
        context.coordinator.onCenterChanged = onCenterChanged
        context.coordinator.onScaleChanged = onScaleChanged
        context.coordinator.apply(mountain: mountain, on: mv)
        context.coordinator.applyCourse(selectedCourse, on: mv)
        context.coordinator.fitCourse(fitCourseTick, on: mv)
        context.coordinator.setTrack(climbTrack, on: mv)
        context.coordinator.setRecordTrack(recordTrack, on: mv)
        context.coordinator.applyUserState(tracking: tracking, locateTick: locateTick, on: mv)
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
        private var lastLocate = 0
        private var locateOn = false        // geolocate 로 현재위치 점을 켠 상태
        var dark = false                    // 현재 테마 (코스 번호 배지 색)
        var onCenterChanged: ((CLLocationCoordinate2D) -> Void)?
        var onScaleChanged: ((Double) -> Void)?

        // 현재위치 점 표시 + 추적 카메라(등반 중 tracking, 또는 위치 버튼 locateTick).
        // 위치 버튼은 나침반도 통합 — 탭 시 정북(direction=0)·수평(pitch=0)으로 복원.
        func applyUserState(tracking: Bool, locateTick: Int, on mv: MLNMapView) {
            var follow = false
            if locateTick != lastLocate {
                lastLocate = locateTick; locateOn = true; follow = true
                mv.direction = 0                                  // 나침반 통합: 정북
                if mv.camera.pitch != 0 {                         // 수평 복원
                    let c = mv.camera; c.pitch = 0; mv.setCamera(c, animated: true)
                }
            }
            if tracking { locateOn = false }            // 등반 종료 후 geolocate 상태와 분리
            mv.showsUserLocation = tracking || locateOn
            if tracking, mv.userTrackingMode != .follow { follow = true }
            if !tracking && !locateOn, mv.userTrackingMode != .none {
                mv.setUserTrackingMode(.none, animated: false, completionHandler: nil)
            }
            if follow { mv.setUserTrackingMode(.follow, animated: true, completionHandler: nil) }
        }

        // 코스 번호 배지 이미지(badge-N) 등록 — 웹 makeBadge 캔버스 대응(런타임 UIImage).
        // 스타일 로드/테마 전환마다 재등록. course-no-badges 레이어(gen-style)가 참조.
        func registerBadges(on style: MLNStyle) {
            for n in 1...12 { style.setImage(makeBadge(n), forName: "badge-\(n)") }
        }
        private func makeBadge(_ n: Int) -> UIImage {
            let size = CGSize(width: 26, height: 26)
            let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 2
            let bg = dark ? UIColor(white: 0.949, alpha: 1) : UIColor(white: 0.067, alpha: 1)  // f2 / 11
            let fg: UIColor = dark ? .black : .white
            return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in
                bg.setFill()
                UIBezierPath(ovalIn: CGRect(origin: .zero, size: size).insetBy(dx: 1.5, dy: 1.5)).fill()
                let s = "\(n)"
                let attrs: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: 14, weight: .bold), .foregroundColor: fg]
                let ts = s.size(withAttributes: attrs)
                s.draw(at: CGPoint(x: (size.width - ts.width) / 2, y: (size.height - ts.height) / 2), withAttributes: attrs)
            }
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

        // 코스 탭 → 코스 전체 범위로 카메라 이동(웹 focusTrail fitBounds). 틱 변화 시에만.
        private var lastFitCourse = 0
        func fitCourse(_ tick: Int, on mv: MLNMapView) {
            guard tick != lastFitCourse else { return }
            lastFitCourse = tick
            guard let b = desiredCourse?.bbox, b.count == 4 else { return }
            let bounds = MLNCoordinateBounds(
                sw: CLLocationCoordinate2D(latitude: b[1], longitude: b[0]),
                ne: CLLocationCoordinate2D(latitude: b[3], longitude: b[2]))
            // 가시 영역(시트 위) 에 코스 전체를 꽉 차게: 상단=상단 오버레이 아래, 하단=시트 위.
            let pad = UIEdgeInsets(top: 96, left: 24, bottom: 306, right: 24)
            mv.setVisibleCoordinateBounds(bounds, edgePadding: pad, animated: true, completionHandler: nil)
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
            registerBadges(on: style)            // 코스 번호 배지 이미지(테마색) 등록
            if let d = desired { applyOverlay(d, on: mapView) }
            setCourseEnds(desiredCourse, on: mapView)
            trackCount = -1; recTrackKey = ""    // 스타일 재로드 시 트랙 재주입 강제
        }

        // 지도 이동 종료마다 중심 좌표 통지(국가지점번호) + 축척 통지(스케일바).
        func mapView(_ mapView: MLNMapView, regionDidChangeAnimated animated: Bool) {
            onCenterChanged?(mapView.centerCoordinate)
            onScaleChanged?(mapView.metersPerPoint(atLatitude: mapView.centerCoordinate.latitude))
        }
    }
}
