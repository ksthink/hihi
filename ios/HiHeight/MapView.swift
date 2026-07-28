import SwiftUI
import MapLibre
import CoreLocation

// 등반 중 내장 유저 dot 을 숨긴다 — 현재 위치는 climb-pos style 레이어로 그려 줌 시 루트와 완벽 동기.
// (내장 dot 은 주석 뷰라 줌 애니메이션 중 한 프레임 늦게 재배치돼 루트 선과 엇갈림.)
final class EmptyUserDot: MLNUserLocationAnnotationView {
    override func update() { /* 아무것도 그리지 않음 */ }
}

// 탐험용 위치 점 — 내장 dot 모사 + 나침반 모드 빔을 **한 뷰(같은 컨테이너)** 에 그린다.
// (커스텀 주석 뷰를 쓰면 내장 빔이 안 그려져 직접 그린다. 헤딩 화살표는 나침반 빔과
//  기능이 겹치고 자기 간섭 시 오정보라 제거 — 사용자 결정 2026-07-28.)
final class ExploreUserDot: MLNUserLocationAnnotationView {
    private let dot = CALayer()
    private let beam = CAGradientLayer()  // 나침반 모드 빔 — 커스텀 뷰는 내장 빔이 안 그려져 직접 그린다
    private var built = false

    override func update() {
        if !built { built = true; build() }
        applyTint()
    }

    // ⚠️ 색은 tintColor 상속(SwiftUI .tint → 흑백 잉크색) — systemBlue 하드코딩은 앱 흑백
    //    아이덴티티를 깨고 "갑자기 파랗게" 보였다(build 237 회귀). 내장 dot 도 tint 를 따랐다.
    override func tintColorDidChange() {
        super.tintColorDidChange()
        applyTint()
    }

    private func build() {
        let R: CGFloat = 76                              // 빔·궤도 여유 크기
        bounds = CGRect(x: 0, y: 0, width: R, height: R)
        let center = CGPoint(x: R / 2, y: R / 2)
        // 빔 — 점에서 화면 위로 퍼지는 반투명 원뿔. followWithHeading 은 시선이 항상 화면 위라 고정.
        let BW: CGFloat = 44, BH: CGFloat = 34
        beam.frame = CGRect(x: center.x - BW / 2, y: center.y - BH, width: BW, height: BH)
        beam.startPoint = CGPoint(x: 0.5, y: 1)
        beam.endPoint = CGPoint(x: 0.5, y: 0)
        let mask = CAShapeLayer()
        let mp = UIBezierPath()
        mp.move(to: CGPoint(x: BW / 2, y: BH))           // 꼭짓점 = 점 중심
        mp.addLine(to: CGPoint(x: 0, y: 0))
        mp.addLine(to: CGPoint(x: BW, y: 0))
        mp.close()
        mask.path = mp.cgPath
        beam.mask = mask
        beam.isHidden = true
        // 점 — 내장 dot 모사(tint 채움 + 흰 테두리 + 옅은 그림자)
        dot.bounds = CGRect(x: 0, y: 0, width: 22, height: 22)
        dot.position = center
        dot.cornerRadius = 11
        dot.borderColor = UIColor.white.cgColor
        dot.borderWidth = 3
        dot.shadowColor = UIColor.black.cgColor
        dot.shadowOpacity = 0.25
        dot.shadowOffset = .zero
        dot.shadowRadius = 3
        layer.addSublayer(beam)
        layer.addSublayer(dot)
    }

    private func applyTint() {
        let ink = tintColor ?? .label
        dot.backgroundColor = ink.cgColor
        beam.colors = [ink.withAlphaComponent(0.45).cgColor, ink.withAlphaComponent(0).cgColor]
    }

    // 나침반 모드 빔 — followWithHeading 은 지도가 회전해 시선이 항상 화면 위라 빔은 고정.
    func set(compass: Bool) {
        beam.isHidden = !compass
    }
}

// MLNMapView SwiftUI 브리지 — 카탈로그가 고른 산으로 카메라 이동 + 등고선 오버레이 소스 전환.
// 오버레이 레이어는 스타일 JSON 에 GL 표현식으로 정의(gen-style.mjs)돼 있고,
// 산이 바뀌면 소스 URL 만 교체한다(MLNShapeSource.url 가변) → NSExpression 불필요.
struct MapView: UIViewRepresentable {
    let styleResource: String
    let mountain: Mountain?
    var courses: [Course] = []           // 번호 배지 위치(course.mid) 주입용 — 코스당 1개
    var selectedCourse: Course? = nil
    var climbTrack: [[Double]] = []      // 등반 중 지나온 GPS 트랙 [lng,lat,...]
    var tracking: Bool = false           // 등반 중 — 현재위치 점 + 추적 카메라
    var recordTrack: [[Double]]? = nil   // 기록 루트 보기 — 저장된 트랙(점선) + fitBounds
    var showCourses: Bool = true         // 정규 코스 선/배지 표시(루트 보기에선 토글로 끔)
    var routeMode: Bool = false          // 루트 보기 — 코스는 2배 두께 레이어(route-trails)로, 출발/도착 텍스트 숨김
    var recordOverlap: [[[Double]]] = [] // 걸은 루트 중 정규 코스와 겹치는 구간 — 반전 점선(rec-track-inv)
    var routeCursor: [Double]? = nil     // 고도 프로필에서 고른 지점 [lng,lat] — 지도에 마커
    var offlineBaseURL: URL? = nil       // 다운로드된 팩의 로컬 base.pmtiles(있으면 오프라인 렌더)
    var locateTick: Int = 0              // 증가 시 현재위치로 이동 + 정북·수평 복원(위치/나침반 통합 버튼)
    var fitCourseTick: Int = 0           // 증가 시 선택 코스 범위로 fitBounds(코스 탭)
    var bottomInset: CGFloat = 306       // 시트가 가리는 하단 높이(기기별) — fitBounds·저작권 배치
    var onCenterChanged: ((CLLocationCoordinate2D) -> Void)? = nil
    var onScaleChanged: ((Double) -> Void)? = nil    // 지도 이동 시 축척(m/point) 통지 → 커스텀 스케일바
    var onCourseTapped: ((String) -> Void)? = nil    // 지도에서 등산로/배지 탭 → 코스명 통지(웹 selectByName)
    var onHeadingChanged: ((Bool) -> Void)? = nil    // 나침반(헤딩) 추적 on/off 통지 → 위치 버튼 아이콘 상태

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> MLNMapView {
        let mv = MLNMapView(frame: .zero)
        mv.delegate = context.coordinator
        mv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        // 지도 장식(웹 오버레이 대응): 로고 숨김, 스케일바(좌하단)·저작권 ⓘ(우하단)·나침반 숨김.
        // 시트가 하단을 덮으므로 시트 위로 올린다(y 여백).
        mv.showsLogoView = false
        mv.showsScale = false                            // 웹식 단일 눈금 스케일바를 SwiftUI 로 직접 그림
        mv.showsAttributionButton = false                // 팝업 대신 SwiftUI 커스텀 어트리뷰션(옆으로 펼침) 사용
        mv.showsCompassView = false                      // 나침반은 위치 버튼에 통합
        // 등산로/배지 탭 → 코스 선택(웹 trail-hit·course-no-badges 클릭 대응)
        mv.addGestureRecognizer(UITapGestureRecognizer(
            target: context.coordinator, action: #selector(Coordinator.handleTap(_:))))
        context.coordinator.dark = styleResource.contains("dark")
        context.coordinator.mapView = mv        // 깜박임 타이머·나침반 빔에서 지도 접근
        // 위치 점 5m 거리 필터 — 기본값(kCLDistanceFilterNone)은 1~3m GPS 지터까지 전부 점으로
        // 전달돼 가만히 있어도 점이 계속 떠다닌다(등반 트래킹 ClimbStore 와 같은 5m 정책, 2026-07-26).
        mv.locationManager.setDistanceFilter?(5)
        applyStyle(mv)
        return mv
    }

    func updateUIView(_ mv: MLNMapView, context: Context) {
        context.coordinator.dark = styleResource.contains("dark")
        context.coordinator.bottomInset = bottomInset
        applyStyle(mv)                                   // 테마 전환 시 스타일 교체
        mv.scaleBarShouldShowDarkStyles = !context.coordinator.dark   // 밝은 지도→어두운 스케일바
        context.coordinator.onCenterChanged = onCenterChanged
        context.coordinator.onScaleChanged = onScaleChanged
        context.coordinator.onCourseTapped = onCourseTapped
        context.coordinator.onHeadingChanged = onHeadingChanged
        // 오버레이 출처(로컬/원격) 판단 — apply(mountain:) 가 applyOverlay 를 부르므로 그 전에.
        context.coordinator.useLocalPack = offlineBaseURL != nil
        context.coordinator.apply(mountain: mountain, on: mv)
        context.coordinator.setCourseNos(courses, on: mv)                       // 번호 배지 위치(코스당 1개)
        context.coordinator.applyCourse(selectedCourse, on: mv)
        context.coordinator.tracking = tracking                                 // 등반 여부(코스 점선 표시에 필요) 선반영
        context.coordinator.applyTrailSelection(selectedCourse?.name, on: mv)   // 선택 코스 강조(검정/회색·배지)
        context.coordinator.fitCourse(fitCourseTick, on: mv)
        context.coordinator.setTrack(climbTrack, on: mv)
        context.coordinator.setRecordTrack(recordTrack, on: mv)
        context.coordinator.setCoursesVisible(showCourses, route: routeMode, on: mv)   // 정규 코스 토글(루트 보기=2배 레이어)
        context.coordinator.setRecordOverlap(recordOverlap, on: mv)             // 코스와 겹치는 구간 반전 표시
        context.coordinator.setRouteCursor(routeCursor, on: mv)                 // 고도 프로필 커서 마커
        context.coordinator.applyUserState(tracking: tracking, locateTick: locateTick, on: mv)
    }

    private func applyStyle(_ mv: MLNMapView) {
        // 항상 런타임 스타일로 — 글리프 URL 을 절대 file:// 로 재작성한다.
        // ⚠️ 번들 스타일의 glyphs 는 상대경로("glyphs/{fontstack}/{range}.pbf")인데, MapLibre Native
        //    가 이를 번들 file:// 로 resolve 하지 못해 "unsupported URL"(-1002)로 글리프 로드가
        //    전부 실패한다 → 지도 라벨(전철역·지명·POI)이 통째로 안 그려진다(2026-07-25 확인).
        //    번들 절대 경로로 바꾸면 해결. (오프라인이면 base 소스도 로컬 pmtiles 로 교체.)
        guard let url = Self.runtimeStyle(resource: styleResource, offlineBase: offlineBaseURL) else { return }
        if mv.styleURL != url { mv.styleURL = url }
    }

    static func runtimeStyle(resource: String, offlineBase: URL?) -> URL? {
        guard let src = Bundle.main.url(forResource: resource, withExtension: "json"),
              let data = try? Data(contentsOf: src),
              var json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        // 글리프 → 번들 절대 file:// (상대경로는 native 에서 로드 실패)
        let glyphsBase = Bundle.main.bundleURL.appendingPathComponent("glyphs").absoluteString
        json["glyphs"] = "\(glyphsBase)/{fontstack}/{range}.pbf"
        // 오프라인이면 base 벡터소스를 로컬 pmtiles 로 교체
        let code = offlineBase?.deletingLastPathComponent().lastPathComponent ?? "bundle"
        if let base = offlineBase,
           var sources = json["sources"] as? [String: Any],
           var proto = sources["protomaps"] as? [String: Any] {
            proto["url"] = "pmtiles://\(base.absoluteString)"
            sources["protomaps"] = proto
            json["sources"] = sources
        }
        let out = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("runtime-\(resource)-\(code).json")
        guard let outData = try? JSONSerialization.data(withJSONObject: json) else { return nil }
        try? outData.write(to: out)
        return out
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        private var desired: Mountain?      // 목표 산
        private var cameraDone: String?     // 카메라를 맞춘 산코드 (중복 이동 방지)
        private var desiredCourse: Course?  // 선택 코스 (시종점 표시용)
        private var trackCount = -1         // 마지막 반영한 트랙 점 개수 (중복 갱신 방지)
        private var recTrackKey = ""        // 마지막 반영한 기록 트랙 식별 (중복 갱신·재fit 방지)
        private var recCursorKey = ""       // 마지막 반영한 고도 프로필 커서 지점 (중복 갱신 방지)
        private var overlapKey = ""         // 마지막 반영한 겹침 구간 식별 (중복 갱신 방지)
        // 스타일 재로드(테마·지도유형 전환) 직후 즉시 재주입할 원본 — 다음 updateUIView 를
        // 기다리면 트리거가 우연한 상태 변화뿐이라 루트가 수 초간 사라진다(2026-07-26 실기).
        private var desiredTrack: [[Double]] = []      // 등반 라이브 트랙
        private var desiredRecTrack: [[Double]]?       // 기록 루트
        private var desiredOverlap: [[[Double]]] = []  // 겹침 반전 구간
        private var desiredCursor: [Double]?           // 고도 프로필 커서
        private var recFitKey = ""          // fit 완료한 기록 트랙 키 — 재로드 재주입 시 재fit 방지
        private var coursesVisible = true   // 정규 코스 선/배지 표시 여부 (루트 보기에서 토글)
        private var routeMode = false       // 루트 보기 모드 — 코스를 2배 두께 레이어로, 출발/도착 텍스트 숨김
        var bottomInset: CGFloat = 306      // 시트가 가리는 하단 높이 (fitBounds 하단 여백)
        private var lastLocate = 0
        private var locateOn = false        // geolocate 로 현재위치 점을 켠 상태
        private var wasTracking = false     // 등반 시작 전이(자동 추적 켬) 감지
        var tracking = false                // 등반 중 — viewFor 가 참조(내장 dot 숨김)
        var useLocalPack = false            // 로컬 팩으로 렌더 중(등반 중 또는 오프라인) — applyOverlay 가 참조
        var dark = false                    // 현재 테마 (코스 번호 배지 색)
        var onCenterChanged: ((CLLocationCoordinate2D) -> Void)?
        var onScaleChanged: ((Double) -> Void)?
        var onHeadingChanged: ((Bool) -> Void)?

        // ── 나침반 모드 빔 — 탐험은 주석 뷰(ExploreUserDot), 등반은 스타일 레이어(climb-pos 동기). ──
        // (헤딩 화살표는 나침반 빔과 기능이 겹쳐 제거 — 사용자 결정 2026-07-28.)
        weak var mapView: MLNMapView?               // 깜박임 타이머·빔 갱신에서 지도 접근
        private var beamCoord: CLLocationCoordinate2D?   // 등반 빔 위치(climb-pos 와 동기)
        private var headingMode = false             // 나침반 추적 중 — 빔 표시(지도가 회전)
        private weak var userDot: ExploreUserDot?   // 탐험 위치 점(점+빔 통합 뷰) — viewFor 가 채움
        // 등반 위치 점(climb-pos) 안쪽 도트 깜박임 — 레코딩 중 효과(탐험 포인터와 대비).
        private var blinkTimer: Timer?
        private var blinkOn = true

        // 현재위치 점 표시 + 추적 카메라(등반 중 tracking, 또는 위치 버튼 locateTick).
        // 위치 버튼은 나침반도 통합 — 누를 때마다 정북 추적 ⇄ 나침반(헤딩) 추적을 순환한다.
        //  · 1번(꺼짐/사용자 이동 후): 현위치 중심 + 정북(North Up) 추적, 수평 복원.
        //  · 2번(정북 추적 중): followWithHeading — 기기 나침반 방향으로 지도 회전(빔 아이콘 자동).
        //  · 3번(나침반 중): 다시 정북 추적으로 복귀(지도 회전 정북 복원).
        func applyUserState(tracking: Bool, locateTick: Int, on mv: MLNMapView) {
            let changed = tracking != wasTracking
            self.tracking = tracking            // viewFor 가 참조(등반 중 내장 dot 숨김)
            // 등반 시작 시 자동으로 현위치 정북 추적 켬(한 번만).
            if tracking && !wasTracking {
                locateOn = true
                mv.showsUserLocation = true
                mv.setUserTrackingMode(.follow, animated: true, completionHandler: nil)
            }
            wasTracking = tracking
            // 트래킹 전환 시 유저 위치 주석 뷰 새로고침 — 등반 시작=숨김(EmptyUserDot), 종료=기본 dot 복귀.
            if changed && mv.showsUserLocation {
                mv.showsUserLocation = false
                mv.showsUserLocation = true
                if tracking { mv.setUserTrackingMode(.follow, animated: false, completionHandler: nil) }
            }

            // 위치 버튼 탭 — 현재 추적 모드에 따라 순환.
            if locateTick != lastLocate {
                lastLocate = locateTick
                locateOn = true
                mv.showsUserLocation = true
                switch mv.userTrackingMode {
                case .follow:
                    // 정북 추적 → 나침반(헤딩) 추적: 시선 방향으로 지도가 회전.
                    mv.setUserTrackingMode(.followWithHeading, animated: true, completionHandler: nil)
                case .followWithHeading:
                    // 나침반 → 정북 추적으로 복귀(모드 전환 시 지도 회전 정북 복원).
                    mv.setUserTrackingMode(.follow, animated: true, completionHandler: nil)
                default:
                    // 꺼짐/사용자가 지도를 옮긴 상태 → 현위치 중심 + 정북 추적, 수평 복원.
                    if mv.camera.pitch != 0 { let c = mv.camera; c.pitch = 0; mv.setCamera(c, animated: true) }
                    mv.setUserTrackingMode(.follow, animated: true, completionHandler: nil)
                }
            }

            // 등반 중엔 현위치 추적을 유지하되, 사용자가 고른 나침반 모드는 존중.
            // (사용자가 지도를 옮겨 .none 으로 떨어지면 다음 GPS 갱신에 정북 추적 복귀.)
            if tracking && mv.userTrackingMode == .none {
                mv.setUserTrackingMode(.follow, animated: true, completionHandler: nil)
            }

            if !tracking && !locateOn { mv.showsUserLocation = false }
            refreshBeam()     // 포인터 표시 여부·모드가 바뀌었을 수 있음 — 빔도 동기
            setBlink(tracking)   // 등반 중 = 안쪽 도트 느린 깜박임(레코딩 효과)
        }

        // 등반 점 깜박임 — 0.75초마다 opacity 1 ⇄ 0.15, MLNTransition(0.7s)이 GL 에서 페이드 보간.
        // 타이머는 1.3Hz 뿐이라 배터리 영향 없음. 스타일 재로드 시에도 매 틱 transition 재설정이라 견고.
        private func setBlink(_ on: Bool) {
            if on {
                guard blinkTimer == nil else { return }
                blinkTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in
                    self?.blinkTick()
                }
            } else {
                blinkTimer?.invalidate()
                blinkTimer = nil
                blinkOn = true
                if let l = mapView?.style?.layer(withIdentifier: "climb-pos-dot") as? MLNCircleStyleLayer {
                    l.circleOpacity = NSExpression(forConstantValue: 1)   // 원복
                }
            }
        }

        private func blinkTick() {
            guard let l = mapView?.style?.layer(withIdentifier: "climb-pos-dot") as? MLNCircleStyleLayer else { return }
            l.circleOpacityTransition = MLNTransition(duration: 0.7, delay: 0)
            blinkOn.toggle()
            l.circleOpacity = NSExpression(forConstantValue: blinkOn ? 1.0 : 0.15)
        }

        deinit { blinkTimer?.invalidate() }

        // 등반 중에는 내장 유저 dot 을 숨긴다(현재 위치는 climb-pos style 레이어로 렌더).
        // 탐험은 점+나침반 빔 통합 뷰(ExploreUserDot) — 같은 컨테이너라 이동이 완전 동기.
        func mapView(_ mapView: MLNMapView, viewFor annotation: MLNAnnotation) -> MLNAnnotationView? {
            guard annotation is MLNUserLocation else { return nil }
            if tracking { return EmptyUserDot() }
            let v = userDot ?? ExploreUserDot()
            userDot = v
            v.set(compass: headingMode)
            return v
        }

        // 추적 모드 변경(버튼 순환·사용자 팬으로 .none 낙하 등)마다 호출된다.
        // ⚠️ 손전등(헤딩) 빔은 followWithHeading 이라도 showsUserHeadingIndicator 를 켜야 그려진다.
        //    등반은 켜져 있었지만 탐험은 이 설정이 없어 빔이 안 나왔다(2026-07-25). 여기서 모드에
        //    맞춰 켜고, 위치 버튼 아이콘 상태도 함께 통지한다(탐험·등반 공통 경로).
        func mapView(_ mapView: MLNMapView, didChange mode: MLNUserTrackingMode, animated: Bool) {
            let heading = mode == .followWithHeading
            mapView.showsUserHeadingIndicator = heading
            headingMode = heading
            refreshBeam()
            onHeadingChanged?(heading)
        }

        // 나침반 빔 갱신 라우팅 — 탐험=주석 뷰(점과 같은 컨테이너), 등반=스타일 레이어(climb-pos 동기).
        private func refreshBeam() {
            userDot?.set(compass: headingMode)
            applyBeam()
        }

        // 등반 나침반 빔 소스/레이어/아이콘 — 스타일 로드마다 재구성(테마 색 반영).
        // 심볼 레이어 방식이라 등반 climb-pos 와 같은 렌더 경로 — 줌·이동 중에도 포인터와 어긋나지 않는다.
        private func ensureBeam(on style: MLNStyle) {
            registerBeamIcon(on: style)
            guard style.source(withIdentifier: "compass-beam") == nil else { return }
            let src = MLNShapeSource(identifier: "compass-beam", shape: nil, options: nil)
            style.addSource(src)
            let l = MLNSymbolStyleLayer(identifier: "compass-beam", source: src)
            l.iconImageName = NSExpression(forConstantValue: "heading-beam")
            // viewport 정렬 — followWithHeading 은 지도가 회전하고 시선은 항상 화면 위라 빔 고정.
            l.iconRotationAlignment = NSExpression(forConstantValue: "viewport")
            l.iconAnchor = NSExpression(forConstantValue: "bottom")   // 꼭짓점이 점 중심에서 위로
            l.iconOffset = NSExpression(forConstantValue: NSValue(cgVector: CGVector(dx: 0, dy: -8)))
            l.iconAllowsOverlap = NSExpression(forConstantValue: true)
            l.iconIgnoresPlacement = NSExpression(forConstantValue: true)
            style.addLayer(l)                    // 맨 위 — 트랙·포인터 위에
        }

        // 나침반 빔 아이콘(등반용) — 점에서 위로 퍼지며 사라지는 반투명 원뿔(잉크색 그라데이션).
        private func registerBeamIcon(on style: MLNStyle) {
            let W: CGFloat = 44, H: CGFloat = 34
            let ink = dark ? UIColor.white : UIColor.black
            let img = UIGraphicsImageRenderer(size: CGSize(width: W, height: H)).image { ctx in
                let cg = ctx.cgContext
                let path = UIBezierPath()
                path.move(to: CGPoint(x: W / 2, y: H))       // 꼭짓점(점 중심 쪽)
                path.addLine(to: CGPoint(x: 0, y: 0))
                path.addLine(to: CGPoint(x: W, y: 0))
                path.close()
                cg.addPath(path.cgPath)
                cg.clip()
                let colors = [ink.withAlphaComponent(0.45).cgColor, ink.withAlphaComponent(0).cgColor] as CFArray
                guard let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                            colors: colors, locations: [0, 1]) else { return }
                cg.drawLinearGradient(grad, start: CGPoint(x: W / 2, y: H),
                                      end: CGPoint(x: W / 2, y: 0), options: [])
            }
            style.setImage(img, forName: "heading-beam")
        }

        // 등반용 스타일 빔 반영 — climb-pos(스타일 레이어 점)와 같은 렌더 경로라 완전 동기.
        // 탐험은 여기 안 옴(주석 뷰 ExploreUserDot 이 담당 — 내장 빔은 EmptyUserDot 이라 안 그려짐).
        private func applyBeam() {
            guard let mv = mapView, let style = mv.style,
                  let src = style.source(withIdentifier: "compass-beam") as? MLNShapeSource else { return }
            guard tracking, headingMode, let c = beamCoord else { src.shape = nil; return }
            let f = MLNPointFeature()
            f.coordinate = c
            src.shape = f
        }

        // POI 아이콘 등록 — 웹 makePoiIcon(캔버스) 대응. 네이티브는 SF Symbol 을 렌더한다.
        // 이름은 웹과 동일(poi-*)해서 스타일 표현식을 양쪽이 공유한다.
        // 흑백 지도라 잉크색 단색 + 반대색 헤일로로 어느 배경에서든 읽히게.
        //
        // ⚠️ **스타일이 참조하는 이름을 하나라도 빠뜨리면 그 POI 가 통째로 사라진다.**
        //    웹은 styleimagemissing 이벤트로 없는 아이콘을 즉석 생성하지만 네이티브엔 그
        //    메커니즘이 없어, 아이콘이 없으면 라벨까지 함께 빠진다(2026-07-23: 전철역·주차장이
        //    앱에만 안 나오던 원인). 스타일에 icon-image 를 추가하면 여기도 같이 채울 것.
        //    현재 참조되는 이름:
        //      poi-amenities  → poi-{toilets,drinking_water,parking,information}
        //      stations       → poi-station        bus-stops → poi-bus_stop
        //      temple-names   → poi-place_of_worship
        //      spots-facilities → poi-{viewpoint,toilets,shelter,helipad,drinking_water,parking}
        private static let poiSymbols: [String: String] = [
            // 기저지도 POI
            "poi-station": "tram.fill", "poi-bus_stop": "bus.fill",
            "poi-place_of_worship": "building.columns.fill", "poi-information": "info.circle.fill",
            // 팩 스팟 편의시설(기저 POI 와 이름 공유: toilets·drinking_water·parking)
            "poi-viewpoint": "binoculars.fill", "poi-toilets": "toilet.fill",
            "poi-shelter": "house.fill", "poi-helipad": "h.square.fill",
            "poi-drinking_water": "drop.fill", "poi-parking": "parkingsign",
        ]
        func registerPOIIcons(on style: MLNStyle) {
            let ink = dark ? UIColor.white : UIColor(white: 0.067, alpha: 1)
            let halo = dark ? UIColor.black : UIColor.white
            for (name, symbol) in Self.poiSymbols {
                if let img = makeFacilityIcon(symbol, ink: ink, halo: halo) {
                    style.setImage(img, forName: name)
                }
            }
        }
        private func makeFacilityIcon(_ symbol: String, ink: UIColor, halo: UIColor) -> UIImage? {
            let cfg = UIImage.SymbolConfiguration(pointSize: 13, weight: .semibold)
            guard let base = UIImage(systemName: symbol, withConfiguration: cfg) else { return nil }
            let pad: CGFloat = 3                       // 헤일로가 잘리지 않도록 여백
            let size = CGSize(width: base.size.width + pad * 2, height: base.size.height + pad * 2)
            let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 2
            return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in
                let rect = CGRect(x: pad, y: pad, width: base.size.width, height: base.size.height)
                // 헤일로 — 같은 심볼을 8방향으로 살짝 옮겨 그려 외곽선을 만든다
                let h = base.withTintColor(halo, renderingMode: .alwaysOriginal)
                for dx in [-1.2, 0, 1.2] as [CGFloat] {
                    for dy in [-1.2, 0, 1.2] as [CGFloat] where !(dx == 0 && dy == 0) {
                        h.draw(in: rect.offsetBy(dx: dx, dy: dy))
                    }
                }
                base.withTintColor(ink, renderingMode: .alwaysOriginal).draw(in: rect)
            }
        }

        // 코스 번호 배지 이미지 등록 — 웹 makeBadge 대응. 미선택=badge-N, 선택=badge-N-sel(반전).
        // 스타일 로드/테마 전환마다 재등록. course-no-badges 레이어가 런타임 표현식으로 선택 코스만 -sel 로.
        func registerBadges(on style: MLNStyle) {
            for n in 1...12 {
                style.setImage(makeBadge(n, sel: false), forName: "badge-\(n)")
                style.setImage(makeBadge(n, sel: true), forName: "badge-\(n)-sel")
            }
        }
        // 웹 makeBadge: 미선택=흰 원+검은 숫자, 선택=검은 원+흰 숫자. 지도색과 원색이 비슷할 때만 테두리.
        private func makeBadge(_ n: Int, sel: Bool) -> UIImage {
            let size = CGSize(width: 26, height: 26)
            let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 2
            let dark11 = UIColor(white: 0.067, alpha: 1)
            let fill: UIColor = sel ? dark11 : .white
            let fg: UIColor = sel ? .white : dark11
            let needBorder = sel ? dark : !dark        // 라이트맵×흰원 / 다크맵×검은원 일 때만
            return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in
                let circle = UIBezierPath(ovalIn: CGRect(origin: .zero, size: size).insetBy(dx: 2, dy: 2))
                fill.setFill(); circle.fill()
                if needBorder { fg.setStroke(); circle.lineWidth = 1.5; circle.stroke() }
                let s = "\(n)"
                let attrs: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: 14, weight: .bold), .foregroundColor: fg]
                let ts = s.size(withAttributes: attrs)
                s.draw(at: CGPoint(x: (size.width - ts.width) / 2, y: (size.height - ts.height) / 2), withAttributes: attrs)
            }
        }

        // 등산로 선택 반영(웹 applyTrailFilter): 선택 코스=검정(trail-hl), 나머지=회색(trail-line faded),
        // 미선택 상태면 전체 검정. 선택 코스 배지는 badge-N-sel(반전)로. 스타일 로드·선택 변경마다 호출.
        func applyTrailSelection(_ name: String?, on mv: MLNMapView) {
            guard let style = mv.style else { return }
            let line = dark ? UIColor.white : UIColor(white: 0.067, alpha: 1)
            let faded = dark ? UIColor(white: 0.36, alpha: 1) : UIColor(white: 0.722, alpha: 1)  // 5c / b8
            if let tl = style.layer(withIdentifier: "trail-line") as? MLNLineStyleLayer {
                tl.lineColor = NSExpression(forConstantValue: name != nil ? faded : line)
            }
            // 등반 중엔 선택 코스를 "앞으로 갈 루트"(회색 점선+검정 테두리)로 그리고 기존 검정 실선 강조는 끈다.
            // (지나온 길은 climb-track 검정 실선이 그 위에 덮여 자연스럽게 구분된다.)
            let climbing = tracking && name != nil
            if let hl = style.layer(withIdentifier: "trail-hl") as? MLNLineStyleLayer {
                hl.predicate = NSPredicate(format: "name == %@", climbing ? "__none__" : (name ?? "__none__"))
            }
            for id in ["climb-route-casing", "climb-route"] {
                if let l = style.layer(withIdentifier: id) as? MLNLineStyleLayer {
                    l.predicate = NSPredicate(format: "name == %@", climbing ? name! : "__none__")
                }
            }
            if let bl = style.layer(withIdentifier: "course-no-badges") as? MLNSymbolStyleLayer {
                bl.iconImageName = NSExpression(mglJSONObject: [
                    "concat", "badge-",
                    ["to-string", ["coalesce", ["get", "no"], 1]],
                    ["case", ["==", ["get", "name"], name ?? "__none__"], "-sel", ""],
                ])
            }
        }

        // 지도에서 등산로/배지 탭 → 해당 코스 선택 통지(웹 trail-hit/course-no-badges 클릭 → selectByName).
        var onCourseTapped: ((String) -> Void)?
        @objc func handleTap(_ g: UITapGestureRecognizer) {
            guard let mv = g.view as? MLNMapView else { return }
            let feats = mv.visibleFeatures(at: g.location(in: mv),
                                           styleLayerIdentifiers: ["trail-hit", "course-no-badges"])
            if let name = feats.first?.attribute(forKey: "name") as? String { onCourseTapped?(name) }
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
            // base 타일과 같은 기준을 따른다(ExploreView 가 offlineBaseURL 로 결정):
            //   탐험 중 = 원격 우선(최신성) · 등반 중 = 로컬 팩 우선(끊기지 않는 것이 우선).
            // ⚠️ 예전엔 설치돼 있으면 무조건 로컬을 썼는데, 팩 버전 관리가 없어 **팩을 받은 뒤
            //    추가된 코스가 지도에 영원히 안 나왔다**(2026-07-22: 북한산에 "아인쌤 야호~"를
            //    추가했더니 코스 목록·시종점 마커는 나오는데 — 이쪽은 PackLoader 가 원격을 읽음 —
            //    지도의 코스 선과 번호 배지만 빠짐). 목록과 지도의 출처를 일치시켜야 한다.
            let ps = PackStore.shared
            func pick(_ file: String, _ remote: URL?) -> URL? {
                useLocalPack ? (ps.localFile(m.id, file) ?? remote) : (remote ?? ps.localFile(m.id, file))
            }
            swap(style, "contours", pick("contours.geojson", Config.contoursURL(m.id)))
            swap(style, "trails",   pick("routes.geojson",   Config.routesURL(m.id)))
            swap(style, "spots",    pick("spots.geojson",    Config.spotsURL(m.id)))
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

        // 코스 번호 배지 위치(course-nos) 주입 — 코스당 중점 1개(웹 courseNoFC). 산 전환 시에만 갱신.
        private var desiredCourses: [Course] = []
        private var courseNosKey = ""
        func setCourseNos(_ courses: [Course], on mv: MLNMapView) {
            desiredCourses = courses
            guard let style = mv.style,
                  let src = style.source(withIdentifier: "course-nos") as? MLNShapeSource else { return }
            let key = courses.map { "\($0.no ?? 0):\($0.name)" }.joined(separator: "|")
            guard key != courseNosKey else { return }
            courseNosKey = key
            let feats: [MLNPointFeature] = courses.compactMap { c in
                guard let m = c.mid, m.count == 2 else { return nil }
                let f = MLNPointFeature()
                f.coordinate = CLLocationCoordinate2D(latitude: m[1], longitude: m[0])
                f.attributes = ["no": c.no ?? 1, "name": c.name]
                return f
            }
            src.shape = MLNShapeCollectionFeature(shapes: feats)
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
            // 가시 영역(시트 위) 에 코스 전체를 꽉 차게: 상단=상단 오버레이 아래, 하단=시트 위(기기별).
            let pad = UIEdgeInsets(top: 96, left: 24, bottom: bottomInset, right: 24)
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
            desiredTrack = track
            guard mv.style != nil else { return }
            if track.count == trackCount { return }
            trackCount = track.count
            applyTrack(track, on: mv)
            setClimbPos(track, on: mv)
        }

        // 현재 위치 마커(climb-pos) — 등반 중 트랙 마지막 점. 내장 dot 대신 style 레이어라 줌 시 루트와 동기.
        private func setClimbPos(_ track: [[Double]], on mv: MLNMapView) {
            guard let src = mv.style?.source(withIdentifier: "climb-pos") as? MLNShapeSource else { return }
            if tracking, let p = track.last, p.count >= 2 {
                let c = CLLocationCoordinate2D(latitude: p[1], longitude: p[0])
                let f = MLNPointFeature()
                f.coordinate = c
                src.shape = f
                beamCoord = c                   // 나침반 빔도 같은 좌표(포인터와 동기)
                applyBeam()
            } else {
                src.shape = nil
            }
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
            desiredRecTrack = track
            guard mv.style != nil else { return }
            let key = Self.key(track)
            if key == recTrackKey { return }
            recTrackKey = key
            applyRecordTrack(track, on: mv)
            // fit 은 트랙이 실제로 바뀐 때만 — 스타일 재로드(테마·지도유형 전환) 재주입에선 카메라 유지.
            if key != recFitKey {
                recFitKey = key
                if let track, track.count >= 2 { fit(track, on: mv) }
            }
        }

        private static func key(_ t: [[Double]]?) -> String {
            guard let t, let f = t.first, let l = t.last else { return "" }
            return "\(t.count):\(f[0]),\(f[1])-\(l[0]),\(l[1])"
        }

        // 정규 코스 표시 토글 — 탐험은 얇은 trail-* 그대로, 루트 보기는 2배 두께 route-trails 로
        // (걸었던 루트 위에 얹혀 비교). 루트 보기에선 출발/도착 텍스트(course-ends)도 항상 숨긴다.
        private static let courseLayerIDs = ["trail-casing", "trail-line", "trail-hl", "trail-hit"]
        private static let routeCourseLayerIDs = ["route-trails-casing", "route-trails"]
        func setCoursesVisible(_ show: Bool, route: Bool, on mv: MLNMapView) {
            coursesVisible = show
            routeMode = route
            guard let style = mv.style else { return }
            applyCourseVisibility(style)
        }

        private func applyCourseVisibility(_ style: MLNStyle) {
            let normal = routeMode ? false : coursesVisible   // 탐험용 얇은 선
            let thick = routeMode && coursesVisible           // 루트 보기용 2배 선(걸은 루트 위)
            for id in Self.courseLayerIDs { style.layer(withIdentifier: id)?.isVisible = normal }
            for id in Self.routeCourseLayerIDs { style.layer(withIdentifier: id)?.isVisible = thick }
            // 코스 번호 배지 — 루트 보기에선 켜도 숨김(비교엔 선만, 번호는 불필요).
            style.layer(withIdentifier: "course-no-badges")?.isVisible = normal
            // 정규 코스 출발/도착(점·텍스트) — 루트 보기에선 켜도 선만(비교에 불필요).
            for id in ["course-ends-dots", "course-ends-labels"] {
                style.layer(withIdentifier: id)?.isVisible = !routeMode
            }
        }

        // 걸은 루트 중 정규 코스와 겹치는 구간 — rec-track-inv 소스에 반전 점선으로 주입.
        func setRecordOverlap(_ parts: [[[Double]]], on mv: MLNMapView) {
            desiredOverlap = parts
            guard let style = mv.style,
                  let src = style.source(withIdentifier: "rec-track-inv") as? MLNShapeSource else { return }
            let key = "\(parts.count):\(parts.reduce(0) { $0 + $1.count })"
            if key == overlapKey { return }
            overlapKey = key
            guard !parts.isEmpty else { src.shape = nil; return }
            let f: [String: Any] = ["type": "Feature", "properties": [:],
                                    "geometry": ["type": "MultiLineString", "coordinates": parts]]
            guard let d = try? JSONSerialization.data(withJSONObject: f),
                  let sh = try? MLNShape(data: d, encoding: String.Encoding.utf8.rawValue) else {
                src.shape = nil; return
            }
            src.shape = sh
        }

        // 고도 프로필에서 고른 지점을 rec-cursor 소스로 반영(마커 하나). nil 이면 지움.
        func setRouteCursor(_ coord: [Double]?, on mv: MLNMapView) {
            desiredCursor = coord
            guard let style = mv.style,
                  let src = style.source(withIdentifier: "rec-cursor") as? MLNShapeSource else { return }
            let key = coord.map { "\($0[0]),\($0[1])" } ?? ""
            if key == recCursorKey { return }
            recCursorKey = key
            guard let c = coord, c.count >= 2 else { src.shape = nil; return }
            let f = MLNPointFeature()
            f.coordinate = CLLocationCoordinate2D(latitude: c[1], longitude: c[0])
            src.shape = f
        }

        private func applyRecordTrack(_ track: [[Double]]?, on mv: MLNMapView) {
            guard let style = mv.style,
                  let src = style.source(withIdentifier: "rec-track") as? MLNShapeSource else { return }
            // 기록 트랙의 시작·도착 마커 — 선택 코스와 동일한 endsGeoJSON 을 재사용.
            let ends = style.source(withIdentifier: "rec-ends") as? MLNShapeSource
            guard let track, track.count >= 2,
                  let data = Self.trackGeoJSON(track),
                  let shape = try? MLNShape(data: data, encoding: String.Encoding.utf8.rawValue) else {
                src.shape = nil; ends?.shape = nil; return
            }
            src.shape = shape
            if let s = track.first, let e = track.last, s.count >= 2, e.count >= 2,
               let d = Self.endsGeoJSON(start: Array(s.prefix(2)), end: Array(e.prefix(2)), labeled: false),
               let sh = try? MLNShape(data: d, encoding: String.Encoding.utf8.rawValue) {
                ends?.shape = sh
            } else {
                ends?.shape = nil
            }
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

        // labeled=false 면 출발/도착 텍스트 없이 점만(루트 보기 — 텍스트는 비교에 방해).
        private static func endsGeoJSON(start: [Double], end: [Double], labeled: Bool = true) -> Data? {
            var s: [String: Any] = ["kind": "start"], e: [String: Any] = ["kind": "end"]
            if labeled { s["label"] = "출발"; e["label"] = "도착" }
            let fc: [String: Any] = ["type": "FeatureCollection", "features": [
                ["type": "Feature", "properties": s, "geometry": ["type": "Point", "coordinates": start]],
                ["type": "Feature", "properties": e, "geometry": ["type": "Point", "coordinates": end]],
            ]]
            return try? JSONSerialization.data(withJSONObject: fc)
        }

        // 스타일 로드(초기·테마 전환)마다 현재 목표 산 오버레이 + 시종점 재적용.
        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            registerBadges(on: style)            // 코스 번호 배지 이미지(테마색) 등록
            registerPOIIcons(on: style)          // POI 아이콘(전철역·주차장·사찰 등) 등록
            if let d = desired { applyOverlay(d, on: mapView) }
            setCourseEnds(desiredCourse, on: mapView)
            courseNosKey = ""                    // 스타일 재로드 시 배지 위치 재주입 강제
            setCourseNos(desiredCourses, on: mapView)
            applyTrailSelection(desiredCourse?.name, on: mapView)   // 선택 코스 강조 재적용(스타일 재로드)
            applyCourseVisibility(style)                            // 코스 표시 상태 재적용(루트 보기 포함)
            ensureBeam(on: style)                                   // 등반 나침반 빔 소스/레이어/아이콘(테마 색) 재구성
            refreshBeam()
            trackCount = -1; recTrackKey = ""; recCursorKey = ""; overlapKey = ""  // 재주입 강제(키 리셋)
            // 트랙류는 여기서 **즉시** 재주입 — 다음 updateUIView(우연한 상태 변화)를 기다리면
            // 테마·지도유형 전환 때 루트가 수 초간 사라져 보인다(2026-07-26 실기).
            setTrack(desiredTrack, on: mapView)
            setRecordTrack(desiredRecTrack, on: mapView)
            setRecordOverlap(desiredOverlap, on: mapView)
            setRouteCursor(desiredCursor, on: mapView)
        }

        // 지도 이동 종료마다 중심 좌표 통지(국가지점번호) + 축척 통지(스케일바).
        func mapView(_ mapView: MLNMapView, regionDidChangeAnimated animated: Bool) {
            onCenterChanged?(mapView.centerCoordinate)
            onScaleChanged?(mapView.metersPerPoint(atLatitude: mapView.centerCoordinate.latitude))
            DevStore.shared.updateMap(mapView)   // DEVMODE — 지도 상태 통지(읽기 전용). 제거 시 이 줄 삭제.
        }
    }
}
