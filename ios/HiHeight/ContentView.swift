import SwiftUI

// M2 UI 셸 — 웹의 4탭 하단 바(탐험·추천·등반·기록) 재현.
// 탐험만 지도+검색+바텀시트 구현(M1 진행분), 나머지 3탭은 웹 헤더를 맞춘 플레이스홀더(후속 슬라이스).
struct ContentView: View {
    @Environment(\.colorScheme) private var scheme
    @StateObject private var catalog = CatalogStore()
    @StateObject private var auth = AuthStore()
    @StateObject private var climb = ClimbStore()
    @State private var tab = 0
    @AppStorage("hiheight-theme") private var themePref = "system"   // system·light·dark (지도 컨트롤 토글)

    init() { Self.styleTabBar() }

    var body: some View {
        TabView(selection: $tab) {
            ExploreView(catalog: catalog, climb: climb, auth: auth)
                .tabItem { Label("탐험", systemImage: "safari") }.tag(0)

            RecoView(catalog: catalog, onOpen: openCuration)
                .tabItem { Label("추천", systemImage: "star") }.tag(1)

            DeungView(climb: climb, auth: auth, onStart: { tab = 0 })
                .tabItem { Label("등반", systemImage: "mountain.2") }.tag(2)

            RecordsView(auth: auth, catalog: catalog, onShowRoute: showRoute)
                .tabItem { Label("기록", systemImage: "clock") }.tag(3)
        }
        .tint(scheme == .dark ? Color(hex: 0xf2f2f2) : Color(hex: 0x111111))
        .preferredColorScheme(themePref == "dark" ? .dark : themePref == "light" ? .light : nil)
        .task { await catalog.load() }
    }

    // 큐레이션 슬라이드 탭 → 해당 산 선택 후 탐험 탭으로 이동.
    private func openCuration(_ code: String) {
        if let m = catalog.mountains.first(where: { $0.id == code }) {
            catalog.selected = m
        }
        climb.recordTrack = nil
        tab = 0
    }

    // 기록 루트 탭 → 해당 산 선택 + 트랙을 지도에 표시하고 탐험 탭으로 이동.
    private func showRoute(_ r: ClimbRecord) {
        if let code = r.mountain_id, let m = catalog.mountains.first(where: { $0.id == code }) {
            catalog.selected = m
        }
        climb.recordTrack = r.trackPoints
        tab = 0
    }

    // 흑백 탭바 — 선택=accent, 비선택=muted, 배경=surface + 상단 헤어라인. 라벨은 KakaoSmallSans.
    private static func styleTabBar() {
        let a = UITabBarAppearance()
        a.configureWithOpaqueBackground()
        a.shadowColor = UIColor.separator
        if let font = UIFont(name: "KakaoSmallSans-Bold", size: 10) {
            for item in [a.stackedLayoutAppearance, a.inlineLayoutAppearance, a.compactInlineLayoutAppearance] {
                item.normal.titleTextAttributes = [.font: font]
                item.selected.titleTextAttributes = [.font: font]
            }
        }
        UITabBar.appearance().standardAppearance = a
        UITabBar.appearance().scrollEdgeAppearance = a
    }
}
