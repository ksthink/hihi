import SwiftUI

// M2 UI 셸 — 웹의 4탭 하단 바(탐험·추천·등반·기록) 재현.
// 탐험만 지도+검색+바텀시트 구현(M1 진행분), 나머지 3탭은 웹 헤더를 맞춘 플레이스홀더(후속 슬라이스).
struct ContentView: View {
    @Environment(\.colorScheme) private var scheme
    @StateObject private var catalog = CatalogStore()

    init() { Self.styleTabBar() }

    var body: some View {
        TabView {
            ExploreView(catalog: catalog)
                .tabItem { Label("탐험", systemImage: "safari") }

            PlaceholderView(title: "추천", subtitle: "하이하잇 PICK · 공식 추천")
                .tabItem { Label("추천", systemImage: "star") }

            PlaceholderView(title: "등반", subtitle: "코스를 골라 산행을 시작하세요")
                .tabItem { Label("등반", systemImage: "mountain.2") }

            PlaceholderView(title: "기록", subtitle: "나의 산행 이력")
                .tabItem { Label("기록", systemImage: "clock") }
        }
        .tint(scheme == .dark ? Color(hex: 0xf2f2f2) : Color(hex: 0x111111))
        .task { await catalog.load() }
    }

    // 흑백 탭바 — 선택=accent, 비선택=muted, 배경=surface + 상단 헤어라인.
    private static func styleTabBar() {
        let a = UITabBarAppearance()
        a.configureWithOpaqueBackground()
        a.shadowColor = UIColor.separator
        UITabBar.appearance().standardAppearance = a
        UITabBar.appearance().scrollEdgeAppearance = a
    }
}

// 미구현 탭 — 웹 view-head(제목 + 부제) 형태만 맞춘 자리표시.
struct PlaceholderView: View {
    let title: String
    let subtitle: String
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let t = Theme(scheme: scheme)
        ZStack {
            t.bg.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.system(size: 30, weight: .bold)).foregroundStyle(t.text)
                Text(subtitle).font(.system(size: 14)).foregroundStyle(t.muted)
                Spacer()
                Text("이 탭은 다음 슬라이스에서 구현됩니다.")
                    .font(.footnote).foregroundStyle(t.muted)
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer()
            }
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}
