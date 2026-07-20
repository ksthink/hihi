import SwiftUI

// M2 UI 셸 — 웹의 4탭 하단 바(탐험·추천·등반·기록) 재현.
// 탐험만 지도+검색+바텀시트 구현(M1 진행분), 나머지 3탭은 웹 헤더를 맞춘 플레이스홀더(후속 슬라이스).
struct ContentView: View {
    @Environment(\.colorScheme) private var scheme
    @StateObject private var catalog = CatalogStore()
    @StateObject private var auth = AuthStore()
    @StateObject private var climb = ClimbStore()
    @State private var tab = 0
    @State private var searching = false                            // 탐험 검색 모드 — 켜지면 하단 네비바 숨김
    @State private var showSplash = true                            // 인트로 스플래시
    @AppStorage("hiheight-theme") private var themePref = "system"   // system·light·dark (지도 컨트롤 토글)

    private let tabs: [(icon: String, label: String)] = [
        ("safari", "탐험"), ("star", "추천"), ("mountain.2", "등반"), ("clock", "기록"),
    ]

    var body: some View {
        // 네이티브 탭바(iOS 26 글래스 플로팅) 숨기고 웹식 평평·불투명 하단 네비를 직접 그린다.
        // safeAreaInset 으로 공간을 확보해 각 탭 콘텐츠(지도 시트 포함)가 네비 위에 놓인다.
        TabView(selection: $tab) {
            ExploreView(catalog: catalog, climb: climb, auth: auth, searching: $searching).tag(0).toolbar(.hidden, for: .tabBar)
            RecoView(catalog: catalog, onOpen: openCuration).tag(1).toolbar(.hidden, for: .tabBar)
            DeungView(climb: climb, auth: auth, catalog: catalog, onStart: { tab = 0 },
                      onOpenMap: { m in catalog.selected = m; climb.recordTrack = nil; tab = 0 })
                .tag(2).toolbar(.hidden, for: .tabBar)
            RecordsView(auth: auth, catalog: catalog, onShowRoute: showRoute).tag(3).toolbar(.hidden, for: .tabBar)
        }
        .tint(scheme == .dark ? Color(hex: 0xf2f2f2) : Color(hex: 0x111111))
        .preferredColorScheme(themePref == "dark" ? .dark : themePref == "light" ? .light : nil)
        // 검색 중엔 네비바 숨김. 등반 중에도 숨긴다 — 배터리 절약·오조작 방지로 다른 탭 이동 차단(종료하면 복귀).
        .safeAreaInset(edge: .bottom, spacing: 0) { if !searching && !climb.tracking { bottomNav } }
        .task {                                // 앱 시작 시 카탈로그 + 저장된 로그인 세션 복원(탭 무관)
            async let c: Void = catalog.load()
            async let a: Void = auth.refresh()
            _ = await (c, a)
            climb.checkPending()               // 강제 종료로 중단된 등반이 있으면 복구 안내
        }
        // 중단된 등반 복구 — 강제 종료는 막을 수 없으므로 진행 중 저장해 둔 세션으로 되살린다(IOS.md §9 S3).
        // 시스템 다이얼로그 대신 앱 UI 로 통일한 전용 팝업(ClimbResumeView).
        .overlay {
            if let s = climb.pending {
                ClimbResumeView(
                    session: s,
                    onResume: {
                        if let mc = s.mountainCode, let m = catalog.mountains.first(where: { $0.id == mc }) {
                            catalog.selected = m
                        }
                        climb.resume(s); tab = 0
                    },
                    onFinish: {
                        let d = climb.draft(from: s)
                        climb.discardPending()
                        Task { climb.saveResult = await auth.saveClimb(d) }
                        tab = 3
                    },
                    onDiscard: { climb.discardPending() })
            }
        }
        .overlay {                                                  // 인트로 스플래시 (앱 시작 시)
            if showSplash {
                SplashView(onFinished: { showSplash = false })
                    .preferredColorScheme(themePref == "dark" ? .dark : themePref == "light" ? .light : nil)
            }
        }
    }

    // 웹 하단 네비 — 평평·불투명 전폭 바(상단 헤어라인), 아이콘+라벨, 선택 강조. 글래스 효과 없음.
    private var bottomNav: some View {
        let t = Theme(scheme: scheme)
        return HStack(spacing: 0) {
            ForEach(Array(tabs.enumerated()), id: \.offset) { i, item in
                let on = tab == i
                Button { tab = i } label: {
                    VStack(spacing: 3) {
                        Image(systemName: item.icon)
                            .font(.system(size: 21, weight: on ? .semibold : .regular))
                        Text(item.label).font(.kakao(size: 10, weight: on ? .bold : .regular))
                    }
                    .foregroundStyle(on ? t.text : t.muted)
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 4)
        .background(t.surface.ignoresSafeArea(edges: .bottom))   // 배경만 홈 인디케이터까지 확장
        .overlay(alignment: .top) { Rectangle().fill(t.line).frame(height: 0.5) }
    }

    // 큐레이션 슬라이드 탭 → 해당 산 선택 후 탐험 탭으로 이동.
    private func openCuration(_ code: String) {
        if let m = catalog.mountains.first(where: { $0.id == code }) {
            catalog.selected = m
        }
        climb.recordTrack = nil
        climb.fitRequested = true       // 코스 로드 후 지도를 코스 범위로 프레이밍
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
}
