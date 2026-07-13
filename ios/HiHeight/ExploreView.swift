import SwiftUI

// 탐험 탭 — 지도 + 검색 + 바텀시트(산 소개). 웹 index.html #app(탐험) 구성 재현.
// 코스 목록·스파크라인·날씨·국가지점번호는 후속 슬라이스(M1-S3/M2-S2)에서 카드에 채운다.
struct ExploreView: View {
    @ObservedObject var catalog: CatalogStore
    @ObservedObject var climb: ClimbStore        // 선택 코스를 등반 탭과 공유
    @ObservedObject var auth: AuthStore          // 등반 종료 시 기록 저장
    @Environment(\.colorScheme) private var scheme

    @State private var searching = false
    @State private var query = ""
    @State private var expanded = false
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
                        onCenterChanged: { c in npn = NPN.code(lat: c.latitude, lon: c.longitude) })
                    .ignoresSafeArea()

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
            courses = await cs
            info = await inf
            weather = await wx
            climb.mountainName = m.name
            climb.mountainCode = m.id
            climb.course = courses.first              // 단일 코스 자동 선택 → 시종점 즉시 표시
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
                        Text(desc)
                            .font(.system(size: 13)).foregroundStyle(t.muted)
                            .lineSpacing(3)
                            .lineLimit(expanded ? nil : 2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if !weather.isEmpty { weatherStrip(t) }
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
                        VStack(spacing: 0) {
                            ForEach(courses) { c in courseRow(c, t) }
                        }
                    }
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

    // 오늘 날씨 스트립 — 2시간 간격 예보 (weather.js renderStrip 대응).
    private func weatherStrip(_ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("오늘 날씨").font(.system(size: 13, weight: .semibold)).foregroundStyle(t.muted)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 16) {
                    ForEach(weather) { h in
                        let s = WeatherService.state(h)
                        VStack(spacing: 4) {
                            Text(h.isNow ? "지금" : "\(h.hh)시")
                                .font(.system(size: 11)).foregroundStyle(t.muted)
                            Image(systemName: s.symbol).font(.system(size: 17)).foregroundStyle(t.text)
                                .frame(height: 22)
                            Text(h.tmp.map { "\(Int($0.rounded()))°" } ?? "–")
                                .font(.system(size: 13, weight: .semibold)).foregroundStyle(t.text)
                            Text(h.pty > 0 ? (h.pop.map { "\($0)%" } ?? " ") : " ")
                                .font(.system(size: 10)).foregroundStyle(t.muted)
                        }
                        .frame(width: 38)
                    }
                }
            }
        }
        .padding(.top, 2)
    }

    // 코스 1행 — 번호 배지 + 이름 + 난이도·거리·시간·상승 + 고도 스파크라인 (웹 trail-list/profile).
    // 탭 → 선택(시종점 마커 표시). 선택 행은 배경 강조.
    private func courseRow(_ c: Course, _ t: Theme) -> some View {
        let sel = climb.course?.id == c.id
        return Button {
            withAnimation(.easeOut(duration: 0.15)) { climb.course = c }
        } label: {
            HStack(spacing: 11) {
                Text("\(c.no ?? 0)")
                    .font(.system(size: 13, weight: .bold)).foregroundStyle(t.onAccent)
                    .frame(width: 25, height: 25).background(t.accent, in: Circle())
                VStack(alignment: .leading, spacing: 3) {
                    Text(c.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(t.text)
                    HStack(spacing: 9) {
                        if let d = c.difficulty { Text(d) }
                        if let km = c.distance_km { Text(String(format: "%.1fkm", km)) }
                        if let h = c.time_hr { Text(String(format: "%.1f시간", h)) }
                        if let a = c.ascent { Text("↑\(a)m") }
                    }
                    .font(.system(size: 12)).foregroundStyle(t.muted)
                }
                Spacer()
                if let p = c.profile, p.count > 1 {
                    Sparkline(points: p)
                        .stroke(t.text, style: StrokeStyle(lineWidth: 1.3, lineJoin: .round))
                        .frame(width: 84, height: 30)
                }
            }
            .padding(.horizontal, sel ? 8 : 0).padding(.vertical, 9)
            .background(sel ? t.surface : .clear, in: RoundedRectangle(cornerRadius: 10))
            .overlay(alignment: .bottom) { Rectangle().fill(t.line).frame(height: sel ? 0 : 0.5) }
        }
        .buttonStyle(.plain)
    }
}
