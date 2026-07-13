import SwiftUI

// 탐험 탭 — 지도 + 검색 + 바텀시트(산 소개). 웹 index.html #app(탐험) 구성 재현.
// 코스 목록·스파크라인·날씨·국가지점번호는 후속 슬라이스(M1-S3/M2-S2)에서 카드에 채운다.
struct ExploreView: View {
    @ObservedObject var catalog: CatalogStore
    @Environment(\.colorScheme) private var scheme

    @State private var searching = false
    @State private var query = ""
    @State private var expanded = false

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
                        mountain: catalog.selected)
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
        let peek: CGFloat = 168
        let full = maxH * 0.5
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
                    Divider().overlay(t.line).padding(.vertical, 2)
                    HStack {
                        Text("등산로").font(.system(size: 17, weight: .semibold)).foregroundStyle(t.text)
                        Spacer()
                        Text("지도 다운").font(.system(size: 13, weight: .medium))
                            .foregroundStyle(t.onAccent)
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .background(t.accent, in: Capsule())
                    }
                    Text("코스 목록·난이도·고도 스파크라인은 다음 슬라이스에서 채워집니다.")
                        .font(.system(size: 13)).foregroundStyle(t.muted)
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
}
