import SwiftUI

// 탐험 탭 — 지도 + 검색 + 바텀시트(산 소개). 웹 index.html #app(탐험) 구성 재현.
// 코스 목록·스파크라인·날씨·국가지점번호는 후속 슬라이스(M1-S3/M2-S2)에서 카드에 채운다.
struct ExploreView: View {
    @ObservedObject var catalog: CatalogStore
    @Environment(\.colorScheme) private var scheme

    @State private var searching = false
    @State private var query = ""
    @State private var expanded = false
    @State private var courses: [Course] = []
    @State private var selectedCourse: Course?
    @State private var info: MountainInfo?

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
                        mountain: catalog.selected, selectedCourse: selectedCourse)
                    .ignoresSafeArea()

                // 상단: 검색 버튼(좌) + 현재 산 이름(중앙) — 웹 search + top-overlay
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
                .padding(.horizontal, 14).padding(.top, 8)

                if searching { searchPanel(t) }

                // 바텀시트
                VStack(spacing: 0) {
                    Spacer()
                    infoSheet(t, maxH: geo.size.height)
                }
                .ignoresSafeArea(.keyboard)
            }
        }
        .task(id: catalog.selected?.id) {
            guard let code = catalog.selected?.id else {
                courses = []; info = nil; selectedCourse = nil; return
            }
            async let cs = PackLoader.courses(code)   // 팩(프록시)·산정보(Supabase) 병렬
            async let inf = InfoLoader.load(code)
            courses = await cs
            info = await inf
            selectedCourse = courses.first            // 단일 코스 자동 선택 → 시종점 즉시 표시
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

    // MARK: 바텀시트 (산 소개)
    private func infoSheet(_ t: Theme, maxH: CGFloat) -> some View {
        let peek: CGFloat = 268
        let full = maxH * 0.62
        return VStack(spacing: 0) {
            Capsule().fill(t.line).frame(width: 38, height: 5).padding(.top, 8).padding(.bottom, 10)
            if let m = catalog.selected {
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
                        ScrollView {
                            VStack(spacing: 0) {
                                ForEach(courses) { c in courseRow(c, t) }
                            }
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 18)
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

    // 코스 1행 — 번호 배지 + 이름 + 난이도·거리·시간·상승 + 고도 스파크라인 (웹 trail-list/profile).
    // 탭 → 선택(시종점 마커 표시). 선택 행은 배경 강조.
    private func courseRow(_ c: Course, _ t: Theme) -> some View {
        let sel = selectedCourse?.id == c.id
        return Button {
            withAnimation(.easeOut(duration: 0.15)) { selectedCourse = c }
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
