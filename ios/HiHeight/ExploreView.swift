import SwiftUI

// 탐험 탭 — 지도 + 검색 + 바텀시트(산 소개). 웹 index.html #app(탐험) 구성 재현.
// 코스 목록·스파크라인·날씨·국가지점번호는 후속 슬라이스(M1-S3/M2-S2)에서 카드에 채운다.
struct ExploreView: View {
    @ObservedObject var catalog: CatalogStore
    @ObservedObject var climb: ClimbStore        // 선택 코스를 등반 탭과 공유
    @ObservedObject var auth: AuthStore          // 등반 종료 시 기록 저장
    @Environment(\.colorScheme) private var scheme
    @AppStorage("hiheight-theme") private var themePref = "system"

    @State private var locateTick = 0
    @State private var resetNorthTick = 0
    @State private var searching = false
    @State private var query = ""
    @State private var expanded = false
    @State private var descExpanded = false
    @State private var courses: [Course] = []
    @State private var info: MountainInfo?
    @State private var npn: String?
    @State private var weather: [WeatherHour] = []

    private var results: [Mountain] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? catalog.mountains
             : catalog.mountains.filter { $0.name.contains(q) || $0.id.hasPrefix(q) }
    }

    var body: some View {
        let t = Theme(scheme: scheme)
        GeometryReader { geo in
            ZStack(alignment: .top) {
                MapView(styleResource: scheme == .dark ? "basemap-dark" : "basemap-light",
                        mountain: catalog.selected, selectedCourse: climb.course,
                        climbTrack: climb.track, tracking: climb.tracking,
                        recordTrack: climb.recordTrack,
                        locateTick: locateTick, resetNorthTick: resetNorthTick,
                        onCenterChanged: { c in npn = NPN.code(lat: c.latitude, lon: c.longitude) })
                    .ignoresSafeArea()

                // 우측 지도 컨트롤 (테마·나침반·현재위치) — 웹 bottom-right 컨트롤 대응
                VStack(spacing: 10) {
                    ctrlButton(scheme == .dark ? "sun.max.fill" : "moon.fill", t) {
                        themePref = scheme == .dark ? "light" : "dark"
                    }
                    ctrlButton("location.north.line.fill", t) { resetNorthTick += 1 }
                    ctrlButton("location.fill", t) { locateTick += 1 }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                .padding(.trailing, 14)
                .padding(.bottom, climb.tracking ? 200 : 288)
                .allowsHitTesting(!searching)

                // 상단: 검색 버튼(좌) + 현재 산 이름(중앙) + 국가지점번호 — 웹 search + top-overlay
                VStack(spacing: 8) {
                    HStack(alignment: .top) {
                        searchButton(t)
                        Spacer()
                        if let m = catalog.selected {
                            Text(m.name)
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(t.text)
                                .padding(.horizontal, 14).padding(.vertical, 7)
                                .background(t.elevated.opacity(0.92), in: Capsule())
                                .overlay(Capsule().strokeBorder(t.line))
                        }
                        Spacer()
                        Color.clear.frame(width: 42, height: 42)   // 좌우 대칭용 스페이서
                    }
                    if let npn {
                        HStack(spacing: 5) {
                            Image(systemName: "mappin.and.ellipse").font(.system(size: 10))
                            Text("국가지점번호").foregroundStyle(t.muted)
                            Text(npn).fontWeight(.semibold).foregroundStyle(t.text)
                        }
                        .font(.system(size: 11.5))
                        .padding(.horizontal, 11).padding(.vertical, 5)
                        .background(t.elevated.opacity(0.92), in: Capsule())
                        .overlay(Capsule().strokeBorder(t.line))
                    }
                    if let msg = climb.saveResult {
                        Text(msg)
                            .font(.system(size: 13, weight: .medium)).foregroundStyle(t.onAccent)
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

                if searching { searchPanel(t) }

                // 바텀시트 — 등반 중엔 HUD 로 대체(웹: 등반 중 시트 숨김)
                VStack(spacing: 0) {
                    Spacer()
                    if climb.tracking { climbHUD(t) } else { infoSheet(t, maxH: geo.size.height) }
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
            descExpanded = false
            courses = await cs
            info = await inf
            weather = await wx
            climb.mountainName = m.name
            climb.mountainCode = m.id
            climb.course = courses.first              // 단일 코스 자동 선택 → 시종점 즉시 표시
        }
    }

    // 우측 지도 컨트롤 버튼 (검색 버튼과 동일 프레임)
    private func ctrlButton(_ icon: String, _ t: Theme, _ act: @escaping () -> Void) -> some View {
        Button(action: act) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(t.text)
                .frame(width: 42, height: 42)
                .background(t.elevated.opacity(0.92), in: Circle())
                .overlay(Circle().strokeBorder(t.line))
        }
    }

    // MARK: 검색
    private func searchButton(_ t: Theme) -> some View {
        Button {
            withAnimation(.easeOut(duration: 0.18)) { searching.toggle() }
        } label: {
            Image(systemName: searching ? "xmark" : "magnifyingglass")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(t.text)
                .frame(width: 42, height: 42)
                .background(t.elevated.opacity(0.92), in: Circle())
                .overlay(Circle().strokeBorder(t.line))
        }
    }

    private func searchPanel(_ t: Theme) -> some View {
        VStack(spacing: 0) {
            TextField("산 이름 검색", text: $query)
                .textFieldStyle(.plain)
                .padding(12)
                .background(t.elevated)
            Divider().overlay(t.line)
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
                                Text(m.name).foregroundStyle(t.text)
                                Spacer()
                                if let e = m.elev { Text("\(e)m").foregroundStyle(t.muted).font(.system(size: 13)) }
                            }
                            .padding(.horizontal, 14).padding(.vertical, 11)
                        }
                        Divider().overlay(t.line)
                    }
                }
            }
            .frame(maxHeight: 260)
        }
        .background(t.elevated)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(t.line))
        .shadow(color: .black.opacity(0.12), radius: 14, y: 6)
        .padding(.horizontal, 14)
        .padding(.top, 58)
    }

    // MARK: 등반 중 HUD (웹 #climb-hud) — 경과·이동거리·GPS 지점 + 종료
    private func climbHUD(_ t: Theme) -> some View {
        VStack(spacing: 12) {
            HStack(spacing: 8) {
                Circle().fill(.red).frame(width: 9, height: 9)
                Text(climb.course?.title ?? "등반 중").font(.system(size: 14, weight: .semibold)).foregroundStyle(t.text)
                Spacer()
                Text(fmtClock(climb.elapsed))
                    .font(.system(size: 16, weight: .bold).monospacedDigit()).foregroundStyle(t.text)
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
                Text("등반 종료").font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(t.onAccent).frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background(t.accent, in: RoundedRectangle(cornerRadius: 12))
            }
            if let note = climb.note {
                Text(note).font(.footnote).foregroundStyle(t.muted).frame(maxWidth: .infinity, alignment: .leading)
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
            Text(v).font(.system(size: 20, weight: .bold).monospacedDigit()).foregroundStyle(t.text)
            Text(label).font(.system(size: 11)).foregroundStyle(t.muted)
        }
        .frame(maxWidth: .infinity)
    }

    private func fmtClock(_ sec: Int) -> String {
        String(format: "%d:%02d:%02d", sec / 3600, (sec % 3600) / 60, sec % 60)
    }

    // MARK: 바텀시트 (산 소개)
    private func infoSheet(_ t: Theme, maxH: CGFloat) -> some View {
        let peek: CGFloat = 268
        let full = maxH * 0.62
        return VStack(spacing: 0) {
            Capsule().fill(t.line).frame(width: 38, height: 5).padding(.top, 8).padding(.bottom, 10)
            if let m = catalog.selected {
              ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(m.name).font(.system(size: 22, weight: .bold)).foregroundStyle(t.text)
                        if let e = m.elev {
                            Text("\(e)m").font(.system(size: 15, weight: .medium)).foregroundStyle(t.muted)
                        }
                        Spacer()
                        if m.famous == true {
                            Text("100대 명산").font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(t.onAccent)
                                .padding(.horizontal, 9).padding(.vertical, 4)
                                .background(t.accent, in: Capsule())
                        }
                    }
                    if let r = m.region {
                        Text(r).font(.system(size: 14)).foregroundStyle(t.muted)
                    }
                    if let mgr = info?.manager, !mgr.isEmpty {
                        Text("관리 · \(mgr)").font(.system(size: 13, weight: .medium)).foregroundStyle(t.muted)
                    }
                    if let desc = info?.description, !desc.isEmpty {
                        descView(desc, t)
                    }
                    if !weather.isEmpty { weatherStrip(m.name, t) }
                    Divider().overlay(t.line).padding(.vertical, 2)
                    HStack(spacing: 8) {
                        Text("등산로").font(.system(size: 17, weight: .semibold)).foregroundStyle(t.text)
                        if !courses.isEmpty {
                            Text("\(courses.count)").font(.system(size: 14, weight: .semibold)).foregroundStyle(t.muted)
                        }
                        Spacer()
                        Text("지도 다운").font(.system(size: 13, weight: .medium))
                            .foregroundStyle(t.onAccent)
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .background(t.accent, in: Capsule())
                    }
                    if courses.isEmpty {
                        Text("코스 정보를 불러오는 중…").font(.system(size: 13)).foregroundStyle(t.muted)
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
                    .font(.system(size: 11)).foregroundStyle(t.muted).lineSpacing(2)
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
        .frame(height: expanded ? full : peek, alignment: .top)
        .background(t.elevated)
        .clipShape(.rect(topLeadingRadius: 18, topTrailingRadius: 18))
        .overlay(alignment: .top) {
            RoundedRectangle(cornerRadius: 18).strokeBorder(t.line).mask(Rectangle().padding(.bottom, -20))
        }
        .shadow(color: .black.opacity(0.10), radius: 12, y: -3)
        .gesture(
            DragGesture(minimumDistance: 8)
                .onEnded { v in
                    withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                        expanded = v.translation.height < -30 ? true : (v.translation.height > 30 ? false : expanded)
                    }
                }
        )
    }

    // 산 설명 + 더 읽기 — 웹 mi-desc/mi-more (100자 초과 시 자르고 인라인 버튼, 탭하면 펼침/접힘).
    private func descView(_ desc: String, _ t: Theme) -> some View {
        let long = desc.count > 100
        let shown = (descExpanded || !long)
            ? desc
            : String(desc.prefix(100)).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
        let more = long ? Text(descExpanded ? "  접기" : " 더 읽기").underline().foregroundColor(t.muted) : Text("")
        return Button {
            withAnimation(.easeOut(duration: 0.15)) { descExpanded.toggle() }
        } label: {
            (Text(shown).foregroundColor(t.text) + more)
                .font(.system(size: 13)).lineSpacing(3)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
    }

    // 오늘 날씨 — "{산} 부근 오늘 날씨" + 프레임 카드(시간별) + 발표기준 캡션 (weather.js renderStrip).
    private func weatherStrip(_ name: String, _ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(name) 부근 오늘 날씨").font(.system(size: 13, weight: .semibold)).foregroundStyle(t.muted)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(weather) { h in wxChip(h, t) }
                }
            }
            Text("\(WeatherService.baseLabel) · 가장 가까운 관측지 기준")
                .font(.system(size: 11)).foregroundStyle(t.muted)
        }
        .padding(.top, 2)
    }

    private func wxChip(_ h: WeatherHour, _ t: Theme) -> some View {
        let s = WeatherService.state(h)
        return VStack(spacing: 3) {
            Text(h.isNow ? "지금" : "\(h.hh)시")
                .font(.system(size: 11, weight: .semibold)).foregroundStyle(h.isNow ? t.text : t.muted)
            Image(systemName: s.symbol).font(.system(size: 16)).foregroundStyle(t.text).frame(height: 20)
            Text(h.tmp.map { "\(Int($0.rounded()))°" } ?? "–")
                .font(.system(size: 13, weight: .bold)).foregroundStyle(t.text)
            Text(h.pty > 0 ? (h.pop.map { "\($0)%" } ?? " ") : " ")
                .font(.system(size: 10)).foregroundStyle(t.muted)
        }
        .frame(minWidth: 52)
        .padding(.vertical, 7).padding(.horizontal, 8)
        .background(t.bg, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(h.isNow ? t.text : t.line))
    }

    // 등산로 카드 — 웹 trail-item(프레임 + 좌측 강조선). 이름·난이도 배지·거리/시간·고도 프로파일.
    // 탭 → 선택(시종점 표시). 선택 시 accent 링 강조.
    private func courseRow(_ c: Course, _ t: Theme) -> some View {
        let sel = climb.course?.id == c.id
        return Button {
            withAnimation(.easeOut(duration: 0.15)) { climb.course = c }
        } label: {
            HStack(spacing: 0) {
                Rectangle().fill(t.accent).frame(width: 3)     // 좌측 강조선 (border-left)
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .top, spacing: 7) {
                            Text("\(c.no ?? 0)")
                                .font(.system(size: 11.5, weight: .bold)).foregroundStyle(t.onAccent)
                                .frame(minWidth: 19, minHeight: 19).padding(.horizontal, 4)
                                .background(t.accent, in: Capsule())
                            Text(c.name).font(.system(size: 15, weight: .bold)).foregroundStyle(t.text)
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
                        .font(.system(size: 12)).foregroundStyle(t.muted)
                        if let d = c.desc, !d.isEmpty {
                            Text(d).font(.system(size: 12.5)).foregroundStyle(t.muted).lineSpacing(2)
                        }
                    }
                    if let p = c.profile, p.count > 1 {
                        Sparkline(points: p)
                            .stroke(t.text, style: StrokeStyle(lineWidth: 1.3, lineJoin: .round))
                            .frame(width: 90, height: 44)
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
            Text(c.difLabel).font(.system(size: 11, weight: .bold)).foregroundStyle(t.muted)
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
