import SwiftUI

// M2 UI 셸 — 웹의 4탭 하단 바(탐험·등반·추천·기록) 재현.
struct ContentView: View {

    // 하단 네비 탭. 순서는 웹과 같다 — **탐험·등반·추천·기록**
    // (2026-08-02 웹 `3e8eb1d` 와 맞춤: 핵심 루프인 탐험↔등반을 붙이고 여정 순서로).
    //
    // ⚠️ 예전엔 정수 인덱스(0/1/2/3)였다. 그 구조에서는 탭 순서를 바꿀 때마다 `tab = 0`,
    //    `tab = 3` 같은 배선을 전부 손봐야 하고 하나만 놓쳐도 엉뚱한 탭으로 간다.
    //    (실제로 이번 순서 변경에서 추천·등반의 인덱스가 서로 뒤바뀌었다.)
    //    enum 으로 두면 **선언 순서만 바꿔도** TabView·하단 네비·모든 이동 배선이 따라온다.
    private enum Tab: Hashable, CaseIterable {
        case tam, deung, chu, girok

        var icon: String {
            switch self {
            case .tam:   return "safari"
            case .deung: return "mountain.2"
            case .chu:   return "star"
            case .girok: return "clock"
            }
        }
        var label: String {
            switch self {
            case .tam:   return "탐험"
            case .deung: return "등반"
            case .chu:   return "추천"
            case .girok: return "기록"
            }
        }
    }

    @Environment(\.colorScheme) private var scheme
    @Environment(\.scenePhase) private var scenePhase   // 등반 진단 — 전경/배경 시간 분리(IOS.md §7-4)
    @StateObject private var catalog = CatalogStore()
    @StateObject private var auth = AuthStore()
    @StateObject private var climb = ClimbStore()
    @State private var tab: Tab = .tam
    // 하단 네비 높이 — 아이콘 21pt·라벨 10pt 모두 고정 크기라 값이 변하지 않는다. 그래서 상수로
    // 박고 bottomNav 에도 같은 높이를 강제한다.
    // ⚠️ 예전엔 GeometryReader 로 실측해 @State 에 넣었는데, **레이아웃 측정 → 상태 변경 →
    //    재레이아웃** 순환이 생겼다. 이 값이 각 탭 safeAreaInset 높이라 순환이 도는 동안
    //    스크롤뷰 contentInset 이 계속 바뀌고, 그때 시작된 스크롤 제스처가 취소된다
    //    — "처음 두세 번은 스크롤이 안 먹는" 증상의 원인이었다(2026-07-31, 전 탭 공통).
    private static let navBarHeight: CGFloat = 52
    @State private var searching = false                            // 탐험 검색 모드 — 켜지면 하단 네비바 숨김
    @State private var showSplash = true                            // 인트로 스플래시
    @AppStorage("hiheight-theme") private var themePref = "system"   // system·light·dark (지도 컨트롤 토글)

    // 스크롤 탭이 확보할 하단 공간 — 네비가 떠 있을 때만(검색·등반·루트 보기 중엔 네비가 없으니 0).
    private var navReserve: CGFloat { (searching || climb.tracking || climb.routeRecord != nil) ? 0 : Self.navBarHeight }

    var body: some View {
        // 네이티브 탭바(iOS 26 글래스 플로팅) 숨기고 웹식 평평·불투명 하단 네비를 직접 그린다.
        // safeAreaInset 으로 공간을 확보해 각 탭 콘텐츠(지도 시트 포함)가 네비 위에 놓인다.
        TabView(selection: $tab) {
            // 배치 순서는 Tab 선언 순서와 같게 유지한다(읽는 사람이 하단 네비와 대조하기 쉽게).
            ExploreView(catalog: catalog, climb: climb, auth: auth,
                        onExitRoute: exitRoute,
                        searching: $searching).tag(Tab.tam).toolbar(.hidden, for: .tabBar)
            // 스크롤 탭(등반·추천·기록)은 하단 네비 높이만큼 콘텐츠 하단을 확보한다.
            // (네비를 TabView 에 safeAreaInset 으로 달면 페이지 스크롤엔 공간이 전파되지
            //  않아 마지막 항목이 네비에 가려짐 — 짧은 화면에서 잘림. 페이지별로 인셋을 준다.)
            DeungView(climb: climb, auth: auth, catalog: catalog, onStart: { tab = .tam },
                      onOpenMap: { m in catalog.selected = m; climb.routeRecord = nil; tab = .tam })
                .tag(Tab.deung).toolbar(.hidden, for: .tabBar)
                .safeAreaInset(edge: .bottom, spacing: 0) { Color.clear.frame(height: navReserve).allowsHitTesting(false) }
            RecoView(catalog: catalog, onOpen: openCuration).tag(Tab.chu).toolbar(.hidden, for: .tabBar)
                .safeAreaInset(edge: .bottom, spacing: 0) { Color.clear.frame(height: navReserve).allowsHitTesting(false) }
            RecordsView(auth: auth, catalog: catalog, onShowRoute: showRoute).tag(Tab.girok).toolbar(.hidden, for: .tabBar)
                .safeAreaInset(edge: .bottom, spacing: 0) { Color.clear.frame(height: navReserve).allowsHitTesting(false) }
        }
        .tint(scheme == .dark ? Color(hex: 0xf2f2f2) : Color(hex: 0x111111))
        .preferredColorScheme(themePref == "dark" ? .dark : themePref == "light" ? .light : nil)
        // 검색 중엔 네비바 숨김. 등반·루트 보기 중에도 숨긴다 — 전용 모드에 집중(닫기 버튼으로 복귀).
        .safeAreaInset(edge: .bottom, spacing: 0) { if !searching && !climb.tracking && climb.routeRecord == nil { bottomNav } }
        .task {                                // 앱 시작 시 카탈로그 + 저장된 로그인 세션 복원(탭 무관)
            async let c: Void = catalog.load()
            async let a: Void = auth.refresh()
            _ = await (c, a)
            climb.checkPending()               // 강제 종료로 중단된 등반이 있으면 복구 안내
            // 선택된 산의 날씨를 미리 받아둔다 — 스플래시(2.8s)가 떠 있는 동안 끝나므로
            // 첫 탐험 진입에서 날씨 칸이 비어 있다가 채워지는 지연이 보이지 않는다.
            if !climb.tracking, let m = catalog.selected, m.center.count == 2 {
                WeatherService.prefetch(lat: m.center[1], lon: m.center[0])
            }
        }
        // 등반 중 전경/배경 시간 누적 — 소모에서 화면 기여분을 분리하려면 필요하다(IOS.md §7-4).
        // .active 만 전경으로 본다(.inactive = 알림센터·전화 등으로 화면이 가려진 상태).
        .onChange(of: scenePhase) { _, phase in climb.notePhase(foreground: phase == .active) }
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
                        climb.resume(s); tab = .tam
                    },
                    onFinish: {
                        let d = climb.draft(from: s)
                        climb.discardPending()
                        Task { climb.saveResult = await auth.saveClimb(d) }
                        tab = .girok
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
        .overlay { DevHUD() }   // DEVMODE — 개발자 모드 HUD(모든 탭 위·표시 판단은 DevHUD 내부). 제거 시 이 줄 삭제.
    }

    // 웹 하단 네비 — 평평·불투명 전폭 바(상단 헤어라인), 아이콘+라벨, 선택 강조. 글래스 효과 없음.
    private var bottomNav: some View {
        let t = Theme(scheme: scheme)
        return HStack(spacing: 0) {
            ForEach(Tab.allCases, id: \.self) { item in
                let on = tab == item
                Button { tab = item } label: {
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
        // 높이를 상수로 못 박는다 — navReserve 와 같은 값이라 둘이 어긋날 일이 없고,
        // 측정이 없으니 레이아웃 순환도 생기지 않는다(위 navBarHeight 주석 참조).
        .frame(height: Self.navBarHeight, alignment: .top)
        .background(t.surface.ignoresSafeArea(edges: .bottom))   // 배경만 홈 인디케이터까지 확장
        .overlay(alignment: .top) { Rectangle().fill(t.line).frame(height: 0.5) }
    }

    // 큐레이션 슬라이드 탭 → 해당 산 + 코스를 선택하고 탐험 탭으로 이동.
    // 코스명은 팩 로드가 끝난 뒤에야 매칭할 수 있어 ClimbStore 에 담아 둔다(ExploreView.task).
    private func openCuration(_ code: String, _ courseName: String?) {
        if let m = catalog.mountains.first(where: { $0.id == code }) {
            catalog.selected = m
        }
        climb.wantedCourseName = courseName
        climb.routeRecord = nil
        climb.fitRequested = true       // 코스 로드 후 지도를 코스 범위로 프레이밍
        tab = .tam
    }

    // 루트 보기 닫기 → 기록 탭 복귀(ExploreView 닫기 버튼 배선).
    private func exitRoute() { climb.routeRecord = nil; tab = .girok }

    // 기록 루트 탭 → 해당 산 선택 + 전용 루트 보기 모드로 탐험 탭에 진입.
    private func showRoute(_ r: ClimbRecord) {
        if let code = r.mountain_id, let m = catalog.mountains.first(where: { $0.id == code }) {
            catalog.selected = m
        }
        climb.course = nil          // 루트 보기엔 선택 코스 강조 없음(정규 코스는 토글로)
        climb.routeRecord = r       // 전용 모드 진입(ExploreView.inRoute)
        tab = .tam
    }
}
