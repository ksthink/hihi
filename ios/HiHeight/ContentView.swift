import SwiftUI

// 라이트/다크 두 테마를 시스템 colorScheme 에 연동 — 웹의 matchMedia 대체(IOS.md §5).
// S1 검증 포인트: 두 테마에서 웹과 카토그래피 패리티(등고선·등산로 위계·POI·hillshade).
struct ContentView: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        MapView(styleResource: scheme == .dark ? "basemap-dark" : "basemap-light")
            .ignoresSafeArea()
    }
}
