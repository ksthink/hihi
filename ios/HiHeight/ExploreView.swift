import SwiftUI
import UIKit   // 지도 컨트롤 커스텀 아이콘(UIImage template)

// 탐험 탭 — 지도 + 검색 + 바텀시트(산 소개). 웹 index.html #app(탐험) 구성 재현.
// 코스 목록·스파크라인·날씨·국가지점번호는 후속 슬라이스(M1-S3/M2-S2)에서 카드에 채운다.
struct ExploreView: View {
    @ObservedObject var catalog: CatalogStore
    @ObservedObject var climb: ClimbStore        // 선택 코스를 등반 탭과 공유
    @ObservedObject var auth: AuthStore          // 등반 종료 시 기록 저장
    @Environment(\.colorScheme) private var scheme
    @AppStorage("hiheight-theme") private var themePref = "system"
    // 기저 모드: 지형 전용(기본) ⇄ OSM 전체 basemap. 웹 baseMode 와 동일 개념.
    // 스타일 파일명으로 반영 → 토글 시 basemap-{theme}[-osm].json 리소스를 교체 로드.
    @AppStorage("hiheight-basemode") private var baseMode = "terrain"

    @State private var locateTick = 0
    @State private var courseFitTick = 0              // 코스 탭 → 지도 fitBounds
    @State private var metersPerPoint: Double = 0     // 커스텀 스케일바 축척
    @State private var searching = false
    @State private var query = ""
    @FocusState private var searchFocused: Bool     // 펼침 시 입력창 자동 포커스
    private var hasQuery: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }
    @State private var attrExpanded = false          // 저작권 ⓘ — 탭 시 옆으로 펼침(팝업 대체)
    @State private var detent: SheetDetent = .peek     // 바텀시트 3단계
    @State private var sheetDrag: CGFloat = 0           // 드래그 실시간 오프셋(+아래 -위)
    @State private var courses: [Course] = []
    @State private var info: MountainInfo?
    @State private var weather: [WeatherHour] = []

    // 국가지점번호 — 등반 중(GPS 위치 기준)에만 표시. 탐험(지도) 상태에선 숨김.
    private var npnCode: String? {
        guard climb.tracking, let c = climb.currentCoord else { return nil }
        return NPN.code(lat: c.latitude, lon: c.longitude)
    }

    private var results: [Mountain] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? catalog.mountains
             : catalog.mountains.filter { $0.name.contains(q) || $0.id.hasPrefix(q) }
    }

    var body: some View {
        let t = Theme(scheme: scheme)
        GeometryReader { geo in
            // 바텀시트 peek 를 "전체 화면 높이" 비율로 — 모든 기기에서 동일 비율(웹 참조 ~32%).
            // geo.size.height 는 상단 노치·하단 네비/안전영역이 빠진 축소값이라, 안전영역을 더해
            // 실제 화면 높이로 환산해야 기기 간 비율이 일정하다. 스케일바·컨트롤·fitBounds·저작권도 이 값 기준.
            let fullH = geo.size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom
            let peek = min(330, max(248, fullH * 0.32))
            ZStack(alignment: .top) {
                MapView(styleResource: "basemap-\(scheme == .dark ? "dark" : "light")\(baseMode == "osm" ? "-osm" : "")",
                        mountain: catalog.selected, selectedCourse: climb.course,
                        climbTrack: climb.track, tracking: climb.tracking,
                        recordTrack: climb.recordTrack,
                        locateTick: locateTick, fitCourseTick: courseFitTick,
                        bottomInset: peek + 40,
                        onScaleChanged: { metersPerPoint = $0 })
                    .ignoresSafeArea()

                // 스케일바 (좌하단, 시트 위) — 웹 ScaleControl 식 단일 눈금 바
                if let (label, width) = scaleInfo(metersPerPoint) {
                    scaleBar(label, width, t)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                        .padding(.leading, 16)
                        .padding(.bottom, climb.tracking ? 210 : peek + 28)
                        .allowsHitTesting(false)
                }

                // 우측 지도 컨트롤 — 지형/OSM 토글 + 테마 토글 + 현재위치. 웹 아이콘과 동일.
                VStack(spacing: 10) {
                    // 지형 전용 ⇄ OSM. 현재 상태를 아이콘으로: 지형=△, OSM=접힌 지도(웹 동일).
                    ctrlImageButton(baseMode == "osm" ? "ctrl-osm" : "ctrl-terrain", t) {
                        baseMode = baseMode == "terrain" ? "osm" : "terrain"
                    }
                    ctrlImageButton(scheme == .dark ? "ctrl-sun" : "ctrl-moon", t) {   // 웹 달/해 아이콘(크기 통일)
                        themePref = scheme == .dark ? "light" : "dark"
                    }
                    ctrlImageButton("ctrl-locate", t) { locateTick += 1 }   // ◎ 현재위치(웹 geolocate 아이콘)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                .padding(.trailing, 14)
                .padding(.bottom, climb.tracking ? 240 : peek + 92)   // ⓘ 저작권 버튼 위로
                .allowsHitTesting(!searching)

                // 저작권 ⓘ — 탭하면 옆으로 펼쳐져 어트리뷰션 노출(웹 MapLibre 식, 팝업 대체)
                attributionControl(t)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                    .padding(.trailing, 14)
                    .padding(.bottom, climb.tracking ? 200 : peek + 40)
                    .allowsHitTesting(!searching)

                // 상단: 검색 버튼(좌) + 산이름 | 코스명(우상단) + 국가지점번호 — 웹 title-block/npn-box
                VStack(alignment: .trailing, spacing: 6) {
                    HStack(alignment: .top) {
                        searchBar(t)
                        Spacer()
                        if let m = catalog.selected, !searching {   // 검색 중엔 산이름 숨김(확장 공간 확보)
                            overlayBox(t) {
                                HStack(alignment: .firstTextBaseline, spacing: 7) {
                                    Text(m.name).font(.kakao(size: 14, weight: .bold)).foregroundStyle(t.text)
                                    if let c = climb.course {
                                        Text("|").font(.kakao(size: 14)).foregroundStyle(t.muted)
                                        Text(c.name).font(.kakao(size: 14, weight: .bold)).foregroundStyle(t.text)
                                    }
                                }
                                .lineLimit(1)
                            }
                            .padding(.top, 6)
                        }
                    }
                    if searching && hasQuery {                      // 입력 후 관련 산만 (웹과 동일)
                        HStack { searchResults(t); Spacer() }
                    }
                    if let npn = npnCode {
                        overlayBox(t) {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text("국가지점번호").font(.kakao(size: 10.5)).foregroundStyle(t.muted)
                                Text(npn).font(.kakao(size: 14, weight: .bold)).foregroundStyle(t.text).monospacedDigit()
                            }
                        }
                    }
                    if let msg = climb.saveResult {
                        Text(msg)
                            .font(.kakao(size: 13, weight: .medium)).foregroundStyle(t.onAccent)
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(t.accent, in: RoundedRectangle(cornerRadius: 12))
                            .onTapGesture { climb.saveResult = nil }
                            .task {   // 5초 후 자동 사라짐
                                try? await Task.sleep(nanoseconds: 5_000_000_000)
                                climb.saveResult = nil
                            }
                    }
                }
                .padding(.horizontal, 14).padding(.top, 8)

                // 바텀시트 — 등반 중엔 HUD 로 대체(웹: 등반 중 시트 숨김)
                VStack(spacing: 0) {
                    Spacer()
                    if climb.tracking {
                        // 지도는 세이프에어리어를 무시(전체화면)라 HUD 도 그 영역에 놓여 하단 네비 뒤로
                        // 잘린다 → 하단 안전영역만큼 띄워 버튼·안내가 네비 위에 오게 한다.
                        climbHUD(t).padding(.bottom, geo.safeAreaInsets.bottom)
                    } else {
                        infoSheet(t, maxH: geo.size.height, peek: peek)
                    }
                }
                .ignoresSafeArea(.keyboard)
            }
        }
        .task(id: catalog.selected?.id) {
            guard let m = catalog.selected else {
                courses = []; info = nil; weather = []
                climb.course = nil; climb.mountainName = nil; climb.mountainCode = nil; return
            }
            async let cs = PackLoader.courses(m.id)    // 팩(프록시)·산정보(Supabase)·날씨(프록시) 병렬
            async let inf = InfoLoader.load(m.id)
            async let wx = WeatherService.fetch(lat: m.center[1], lon: m.center[0])
            courses = await cs
            info = await inf
            weather = await wx
            climb.mountainName = m.name
            climb.mountainCode = m.id
            climb.course = courses.first              // 단일 코스 자동 선택 → 시종점 즉시 표시
            if climb.fitRequested {                   // 추천 등 외부 진입 → 코스 범위로 프레이밍
                climb.fitRequested = false
                if climb.course?.bbox != nil { courseFitTick += 1; detent = .peek }
            }
        }
    }

    // 상단 오버레이 박스 — 웹 title-block/npn-box: 반투명 흰(다크는 검정) 사각형 배경.
    private func overlayBox<V: View>(_ t: Theme, @ViewBuilder _ content: () -> V) -> some View {
        content()
            .font(.kakao(size: 14))
            .padding(.horizontal, 13).padding(.vertical, 7)
            .background(scheme == .dark ? Color.black.opacity(0.6) : Color.white.opacity(0.6))
            .overlay(scheme == .dark ? Rectangle().strokeBorder(Color.white.opacity(0.3), lineWidth: 1) : nil)
    }

    // 스케일바 — 라벨 위, ⊔ 브래킷 아래 (웹 ScaleControl 단일 눈금). 지도 위라 그림자로 가독성.
    private func scaleBar(_ label: String, _ width: CGFloat, _ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.kakao(size: 11, weight: .bold)).foregroundStyle(t.text)
            ZStack(alignment: .bottom) {
                HStack {
                    Rectangle().fill(t.text).frame(width: 1.5, height: 6)
                    Spacer(minLength: 0)
                    Rectangle().fill(t.text).frame(width: 1.5, height: 6)
                }
                Rectangle().fill(t.text).frame(height: 1.5)
            }
            .frame(width: width, height: 6)
        }
        .shadow(color: t.bg.opacity(0.9), radius: 2)
    }

    // 축척(m/point) → 가장 큰 "깔끔한" 거리(1/2/3/5×10ⁿ)와 픽셀 폭 (maxWidth 이하).
    private func scaleInfo(_ mpp: Double, maxWidth: CGFloat = 88) -> (String, CGFloat)? {
        guard mpp > 0 else { return nil }
        let maxMeters = Double(maxWidth) * mpp
        let p = pow(10.0, floor(log10(maxMeters)))
        var meters = p
        for s in [5.0, 3, 2, 1] where s * p <= maxMeters { meters = s * p; break }
        let width = CGFloat(meters / mpp)
        let label = meters >= 1000 ? "\(fmtNum(meters / 1000)) km" : "\(Int(meters)) m"
        return (label, width)
    }

    // 우측 지도 컨트롤 버튼 — 웹과 동일한 커스텀 아이콘(번들 PNG, template 틴트).
    // 프레임 36 / 아이콘 20 (웹 컨트롤 비율에 맞춰 아이콘이 프레임을 적당히 채우도록).
    private func ctrlImageButton(_ image: String, _ t: Theme, _ act: @escaping () -> Void) -> some View {
        Button(action: act) {
            Image(uiImage: (UIImage(named: image) ?? UIImage()).withRenderingMode(.alwaysTemplate))
                .resizable().scaledToFit()
                .frame(width: 20, height: 20)
                .foregroundStyle(t.text)
                .frame(width: 36, height: 36)
                .background(t.elevated.opacity(0.92), in: Circle())
                .overlay(Circle().strokeBorder(t.line))
        }
    }

    // 저작권 ⓘ — 접힘=작은 원형 ⓘ, 탭하면 좌측으로 펼쳐져 어트리뷰션 텍스트 노출(팝업 대체).
    private func attributionControl(_ t: Theme) -> some View {
        HStack(spacing: 0) {
            if attrExpanded {
                Text("Protomaps © OpenStreetMap · © Copernicus DEM")
                    .font(.kakao(size: 10))
                    .foregroundStyle(t.muted)
                    .lineLimit(1).fixedSize()
                    .padding(.leading, 12).padding(.trailing, 2)
                    .transition(.opacity)
            }
            Button {
                withAnimation(.easeOut(duration: 0.18)) { attrExpanded.toggle() }
            } label: {
                Image(systemName: "info.circle")
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(t.muted)
                    .frame(width: 30, height: 30)
            }
        }
        .background(t.elevated.opacity(0.92), in: Capsule())
        .overlay(Capsule().strokeBorder(t.line))
    }

    // MARK: 검색 — 버튼 클릭 시 입력창이 우측으로 확장(웹과 동일). 접힘=원형, 펼침=알약형 바.
    private func searchBar(_ t: Theme) -> some View {
        HStack(spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) { searching.toggle() }
                if searching { searchFocused = true } else { query = "" }
            } label: {
                Image(systemName: searching ? "xmark" : "magnifyingglass")
                    .font(.kakao(size: 17, weight: .semibold))
                    .foregroundStyle(t.text)
                    .frame(width: 42, height: 42)
            }
            if searching {
                TextField("산 이름 검색", text: $query)
                    .textFieldStyle(.plain)
                    .font(.kakao(size: 15))
                    .foregroundStyle(t.text)
                    .focused($searchFocused)
                    .submitLabel(.search)
                    .frame(width: 182)
                    .padding(.trailing, 12)
                    .transition(.opacity)
            }
        }
        .background(t.elevated.opacity(0.92), in: Capsule())
        .overlay(Capsule().strokeBorder(t.line))
    }

    // 결과 목록 — 바 아래로. 입력 후 관련 산이 있을 때만 표시(호출부에서 게이트).
    private func searchResults(_ t: Theme) -> some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(results) { m in
                    Button {
                        catalog.selected = m
                        climb.recordTrack = nil       // 산 변경 → 기록 루트 지움
                        withAnimation(.easeOut(duration: 0.18)) { searching = false }
                        query = ""
                    } label: {
                        HStack {
                            Text(m.name).font(.kakao(size: 15, weight: .bold)).foregroundStyle(t.text)
                            Spacer()
                            if let e = m.elev { Text("\(e)m").foregroundStyle(t.muted).font(.kakao(size: 13)) }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 11)
                    }
                    Divider().overlay(t.line)
                }
            }
        }
        .frame(width: 236, height: min(CGFloat(results.count) * 43, 260))  // 내용만큼(웹처럼) + 상한
        .background(t.elevated)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(t.line))
        .shadow(color: .black.opacity(0.12), radius: 14, y: 6)
    }

    // MARK: 등반 중 HUD (웹 #climb-hud) — 경과·이동거리·GPS 지점 + 종료
    private func climbHUD(_ t: Theme) -> some View {
        VStack(spacing: 12) {
            HStack(spacing: 8) {
                Circle().fill(.red).frame(width: 9, height: 9)
                Text(climb.course?.title ?? "등반 중").font(.kakao(size: 14, weight: .semibold)).foregroundStyle(t.text)
                Spacer()
                Text(fmtClock(climb.elapsed))
                    .font(.kakao(size: 16, weight: .bold).monospacedDigit()).foregroundStyle(t.text)
            }
            HStack(spacing: 0) {
                hudStat(String(format: "%.2f", climb.distance / 1000), "이동(km)", t)
                hudStat(climb.course?.distance_km.map { String(format: "%.1f", $0) } ?? "–", "코스(km)", t)
                hudStat("\(climb.pointCount)", "GPS 지점", t)
            }
            Button {
                guard let draft = climb.finish() else { climb.stop(); return }
                Task { climb.saveResult = await auth.saveClimb(draft) }
            } label: {
                Text("등반 종료").font(.kakao(size: 16, weight: .semibold))
                    .foregroundStyle(t.onAccent).frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background(t.accent, in: RoundedRectangle(cornerRadius: 12))
            }
            if let note = climb.note {
                Text(note).font(.kakao(size: 13)).foregroundStyle(t.muted).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(16)
        .background(t.elevated)
        .clipShape(.rect(topLeadingRadius: 18, topTrailingRadius: 18))
        .overlay(alignment: .top) {
            RoundedRectangle(cornerRadius: 18).strokeBorder(t.line).mask(Rectangle().padding(.bottom, -20))
        }
        .shadow(color: .black.opacity(0.10), radius: 12, y: -3)
        .padding(.horizontal, 0)
    }

    private func hudStat(_ v: String, _ label: String, _ t: Theme) -> some View {
        VStack(spacing: 3) {
            Text(v).font(.kakao(size: 20, weight: .bold).monospacedDigit()).foregroundStyle(t.text)
            Text(label).font(.kakao(size: 11)).foregroundStyle(t.muted)
        }
        .frame(maxWidth: .infinity)
    }

    private func fmtClock(_ sec: Int) -> String {
        String(format: "%d:%02d:%02d", sec / 3600, (sec % 3600) / 60, sec % 60)
    }

    // 바텀시트 3단계 (웹 2단계 → Apple 지도식 peek·medium·large)
    enum SheetDetent: CaseIterable { case peek, medium, large }

    // MARK: 바텀시트 (산 소개) — peek 는 기기별 비율(상위에서 계산), medium·large 는 maxH 비율.
    // 드래그를 실시간 추종(sheetDrag)하고, 놓을 때 속도(예상 종점) 반영해 가장 가까운 단계로 스냅.
    private func infoSheet(_ t: Theme, maxH: CGFloat, peek: CGFloat) -> some View {
        let mediumH = maxH * 0.52
        let largeH = maxH * 0.88
        func heightFor(_ d: SheetDetent) -> CGFloat {
            switch d { case .peek: return peek; case .medium: return mediumH; case .large: return largeH }
        }
        let base = heightFor(detent)
        // 실시간 높이 — 위로 끌면(sheetDrag<0) 커지고, 경계 밖은 살짝 저항(러버밴딩).
        let live = min(largeH + 36, max(peek - 36, base - sheetDrag))
        func nearest(_ h: CGFloat) -> SheetDetent {
            SheetDetent.allCases.min { abs(heightFor($0) - h) < abs(heightFor($1) - h) }!
        }
        return VStack(spacing: 0) {
            Capsule().fill(t.line).frame(width: 38, height: 5).padding(.top, 8).padding(.bottom, 10)
            if let m = catalog.selected {
              ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    // 헤더 — 이름 + 고도 + (우측)일출/일몰. 관리 주체·산 설명은 미표시(데이터는 계속 로드)
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(m.name).font(.kakao(size: 18, weight: .bold)).foregroundStyle(t.text)
                        if let e = m.elev {
                            Text("\(e)m").font(.kakao(size: 13, weight: .bold)).foregroundStyle(t.muted)
                        }
                        Spacer()
                        if let sun = SunTimes.today(lat: m.center[1], lon: m.center[0]) {
                            Text("일출 \(sun.rise)   일몰 \(sun.set)")
                                .font(.kakao(size: 12.5, weight: .bold)).foregroundStyle(t.muted)
                                .fixedSize()
                        }
                    }
                    if !weather.isEmpty { weatherStrip(m.name, t) }
                    Divider().overlay(t.line).padding(.vertical, 2)
                    HStack(spacing: 8) {
                        Text("등산로").font(.kakao(size: 17, weight: .semibold)).foregroundStyle(t.text)
                        if !courses.isEmpty {
                            Text("\(courses.count)").font(.kakao(size: 14, weight: .semibold)).foregroundStyle(t.muted)
                        }
                        Spacer()
                        Text("지도 다운").font(.kakao(size: 13, weight: .medium))
                            .foregroundStyle(t.onAccent)
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .background(t.accent, in: Capsule())
                    }
                    if courses.isEmpty {
                        Text("코스 정보를 불러오는 중…").font(.kakao(size: 13)).foregroundStyle(t.muted)
                    } else {
                        VStack(spacing: 9) {
                            ForEach(courses) { c in courseRow(c, t) }
                        }
                    }
                    // 출처 표기 + 샘플 데이터 고지 (웹 footer)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("© metaphr · 기저 지도: Protomaps · © OpenStreetMap")
                        Text("등산로는 개략적인 샘플 데이터입니다. 실제 산행 시 공식 지도를 확인하세요.")
                    }
                    .font(.kakao(size: 11)).foregroundStyle(t.muted).lineSpacing(2)
                    .padding(.top, 8)
                }
                .padding(.horizontal, 18).padding(.bottom, 16)
              }
            } else {
                Text("산을 불러오는 중…").foregroundStyle(t.muted).padding()
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: live, alignment: .top)
        .background(t.elevated)
        .clipShape(.rect(topLeadingRadius: 18, topTrailingRadius: 18))
        .overlay(alignment: .top) {
            RoundedRectangle(cornerRadius: 18).strokeBorder(t.line).mask(Rectangle().padding(.bottom, -20))
        }
        .shadow(color: .black.opacity(0.10), radius: 12, y: -3)
        .gesture(
            DragGesture(minimumDistance: 6)
                .onChanged { v in sheetDrag = v.translation.height }              // 실시간 추종
                .onEnded { v in
                    // 예상 종점(속도 반영) 높이 → 가장 가까운 단계로 스냅.
                    let projected = base - v.predictedEndTranslation.height
                    let target = nearest(projected)
                    withAnimation(.spring(response: 0.34, dampingFraction: 0.85)) {
                        detent = target
                        sheetDrag = 0
                    }
                }
        )
    }

    // 오늘 날씨 — "{산} 부근 오늘 날씨" + 프레임 카드(시간별) + 발표기준 캡션 (weather.js renderStrip).
    private func weatherStrip(_ name: String, _ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("\(name) 부근 오늘 날씨").font(.kakao(size: 12, weight: .semibold)).foregroundStyle(t.muted)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 5) {
                    ForEach(weather) { h in wxChip(h, t) }
                }
            }
            Text("\(WeatherService.baseLabel) · 가장 가까운 관측지 기준")
                .font(.kakao(size: 10)).foregroundStyle(t.muted)
        }
        .padding(.top, 2)
    }

    private func wxChip(_ h: WeatherHour, _ t: Theme) -> some View {
        let s = WeatherService.state(h)
        return VStack(spacing: 2) {
            Text(h.isNow ? "지금" : "\(h.hh)시")
                .font(.kakao(size: 10, weight: .semibold)).foregroundStyle(h.isNow ? t.text : t.muted)
            Image(systemName: s.symbol).font(.kakao(size: 13)).foregroundStyle(t.text).frame(height: 16)
            Text(h.tmp.map { "\(Int($0.rounded()))°" } ?? "–")
                .font(.kakao(size: 12, weight: .bold)).foregroundStyle(t.text)
            Text(h.pty > 0 ? (h.pop.map { "\($0)%" } ?? " ") : " ")
                .font(.kakao(size: 9)).foregroundStyle(t.muted)
        }
        .frame(minWidth: 42)
        .padding(.vertical, 5).padding(.horizontal, 6)
        .background(t.bg, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(h.isNow ? t.text : t.line))
    }

    // 등산로 카드 — 웹 trail-item(프레임 + 좌측 강조선). 이름·난이도 배지·거리/시간·고도 프로파일.
    // 탭 → 선택(시종점 표시). 선택 시 accent 링 강조.
    private func courseRow(_ c: Course, _ t: Theme) -> some View {
        let sel = climb.course?.id == c.id
        return Button {
            withAnimation(.easeOut(duration: 0.15)) { climb.course = c }
            climb.recordTrack = nil                    // 기록 루트 표시 중이면 해제
            courseFitTick += 1                         // 지도를 코스 범위로 이동
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) { detent = .peek }  // 시트 낮춰 지도 노출
        } label: {
            HStack(spacing: 0) {
                Rectangle().fill(t.accent).frame(width: 3)     // 좌측 강조선 (border-left)
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .top, spacing: 7) {
                            Text("\(c.no ?? 0)")
                                .font(.kakao(size: 11.5, weight: .bold)).foregroundStyle(t.onAccent)
                                .frame(minWidth: 19, minHeight: 19).padding(.horizontal, 4)
                                .background(t.accent, in: Capsule())
                            Text(c.name).font(.kakao(size: 15, weight: .bold)).foregroundStyle(t.text)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 4)
                            difBadge(c, t)
                        }
                        HStack(spacing: 10) {
                            if let pk = c.peak, !pk.isEmpty { Text(pk) }
                            if let km = c.distance_km { Text("\(fmtNum(km))km") }
                            if let h = c.time_hr { Text("\(fmtNum(h))h") }
                            if let sf = c.surface, !sf.isEmpty { Text(sf) }
                        }
                        .font(.kakao(size: 12)).foregroundStyle(t.muted)
                        if let d = c.desc, !d.isEmpty {
                            Text(d).font(.kakao(size: 12.5)).foregroundStyle(t.muted).lineSpacing(2)
                        }
                    }
                    if let p = c.profile, p.count > 1 {
                        ProfileView(points: p, color: t.text).frame(width: 90, height: 44)
                    }
                }
                .padding(.vertical, 12).padding(.horizontal, 14)
            }
            .background(t.elevated)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(sel ? t.accent : t.line, lineWidth: sel ? 2.5 : 1))
        }
        .buttonStyle(.plain)
    }

    // 난이도 배지 — "보통 ▮▮▯" (라벨 + 3칸 바 미터). 웹 difLabel + dmeter.
    private func difBadge(_ c: Course, _ t: Theme) -> some View {
        HStack(spacing: 5) {
            Text(c.difLabel).font(.kakao(size: 11, weight: .bold)).foregroundStyle(t.muted)
            HStack(spacing: 2) {
                ForEach(0..<3, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 1).fill(i < c.difLevel ? t.text : t.line)
                        .frame(width: 5, height: 11)
                }
            }
        }
        .fixedSize()
    }

    // 숫자 표기 — 정수면 정수로, 아니면 불필요한 0 제거 (웹 raw 값 표기).
    private func fmtNum(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v)) : String(format: "%g", v)
    }
}
