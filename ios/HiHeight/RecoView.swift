import SwiftUI

// 추천 탭 — 웹 renderReco/pickCarousel(app.js:1160) 이식.
// 노출 매거진 1세트만 PICK 캐러셀(82% 폭 정사각·옆 카드 살짝 보임·스냅·점 인디케이터),
// 나머지는 "지난 매거진 보기" 아코디언. 공식 추천 3종 아코디언(다크 필). 슬라이드 탭 → onOpen.
struct RecoView: View {
    @ObservedObject var catalog: CatalogStore
    // (산코드, 코스명) — 코스 큐레이션이면 코스명까지 넘겨야 그 코스가 선택된다.
    // 산 목록(아코디언)에서는 코스 지정이 없으므로 nil.
    let onOpen: (String, String?) -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var curations: [Curation] = []
    @State private var magIndex = 0              // 캐러셀에 표시 중인 매거진
    @State private var pickID: String?           // 캐러셀 스크롤 위치(점 인디케이터)
    @State private var openLists: Set<String> = []

    // 공식 추천 카테고리 (app.js:1009) — 산의 famous/lists 로 분류.
    private static let officialLists: [(label: String, member: (Mountain) -> Bool)] = [
        ("대한민국 100대 명산", { $0.famous == true }),
        ("블랙야크(BAC) 명산 100", { ($0.lists ?? []).contains("bac100") }),
        ("국립공원공단 공식탐방로", { ($0.lists ?? []).contains("knps") }),
    ]

    private let cardColor = Color(hex: 0x171717)   // 다크 카드(웹 --card-bg, 라이트/다크 공통 다크)

    var body: some View {
        let t = Theme(scheme: scheme)
        VStack(spacing: 0) {
            ScreenHeader(title: "추천")                 // 상단 고정
            GeometryReader { geo in
                let cardW = geo.size.width * 0.82       // 웹 pick-slide flex 0 0 82% (정사각)
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        if curations.isEmpty {
                            Text("추천을 불러오는 중…").font(.kakao(size: 13)).foregroundStyle(t.muted)
                                .padding(.horizontal, 20)
                        } else {
                            magazineSection(cardW, t)
                        }
                        accordions(t)
                    }
                    .padding(.top, 16).padding(.bottom, 24)
                }
                // 당겨서 새로고침 — TabView 는 탭 뷰를 살려두므로 .task 가 앱 실행당 한 번만
                // 돈다. 관리자에서 큐레이션을 고친 뒤 앱을 재실행하지 않고 확인하는 수단.
                .refreshable { await reload() }
            }
        }
        .background(t.bg)
        .task { await reload() }
    }

    // 큐레이션 로드 — 최초 표시(.task)와 당겨서 새로고침(.refreshable) 공용.
    private func reload() async {
        let list = await CurationLoader.load()
        curations = list
        if magIndex >= list.count { magIndex = 0 }      // 매거진이 줄었을 때 범위 이탈 방지
        // 캐러셀 스크롤 위치를 현재 매거진 첫 카드로(빈 목록이면 해제).
        pickID = list.isEmpty ? nil : list[min(magIndex, list.count - 1)].items.first?.id
    }

    // MARK: 매거진 캐러셀 (노출 1세트)
    @ViewBuilder
    private func magazineSection(_ cardW: CGFloat, _ t: Theme) -> some View {
        let mag = curations[min(magIndex, curations.count - 1)]
        VStack(alignment: .leading, spacing: 12) {
            Text(mag.title).font(.kakao(size: 15, weight: .semibold)).foregroundStyle(t.muted)
                .padding(.horizontal, 20)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(mag.items) { it in
                        slide(it, cardW)
                            .id(it.id)
                            .contentShape(Rectangle())
                            .onTapGesture { onOpen(it.code, it.type == "course" ? it.name : nil) }
                    }
                }
                .scrollTargetLayout()
                .padding(.horizontal, 20)
            }
            .scrollTargetBehavior(.viewAligned)
            .scrollPosition(id: $pickID)
            if mag.items.count > 1 {                // 점 인디케이터
                let cur = mag.items.firstIndex { $0.id == pickID } ?? 0
                HStack(spacing: 6) {
                    ForEach(Array(mag.items.enumerated()), id: \.offset) { i, _ in
                        Circle().fill(t.muted).opacity(i == cur ? 1 : 0.35).frame(width: 6, height: 6)
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: 슬라이드 (정사각, 웹 ps-*)
    private func slide(_ it: CurationItem, _ cardW: CGFloat) -> some View {
        ZStack {
            Group {
                if let s = it.img, let url = URL(string: s) {
                    AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { fallbackGradient }
                } else { fallbackGradient }
            }
            // ps-shade — 아래 어둡게(글자 가독)
            LinearGradient(stops: [
                .init(color: .black.opacity(0.30), location: 0),
                .init(color: .black.opacity(0.12), location: 0.58),
                .init(color: .black.opacity(0.68), location: 1),
            ], startPoint: .top, endPoint: .bottom)
        }
        .frame(width: cardW, height: cardW)
        .overlay(alignment: .topLeading) {      // ps-head: 키커 + 제목
            VStack(alignment: .leading, spacing: 9) {
                if let sub = it.sub {
                    Text(sub).font(.kakao(size: 11, weight: .semibold)).foregroundStyle(.white)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(.black.opacity(0.42), in: RoundedRectangle(cornerRadius: 7))
                }
                if let title = it.title ?? it.name {
                    Text(title).font(.kakao(size: 22, weight: .bold)).foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.55), radius: 6, y: 1)
                }
            }
            .padding(.top, 30).padding(.horizontal, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(alignment: .bottom) {            // ps-desc: 가운데 정렬
            if let desc = it.desc {
                Text(desc).font(.kakao(size: 13, weight: .semibold)).foregroundStyle(.white)
                    .multilineTextAlignment(.center).lineSpacing(3)
                    .shadow(color: .black.opacity(0.7), radius: 6, y: 1)
                    .padding(.horizontal, cardW * 0.10).padding(.bottom, cardW * 0.17)
            }
        }
        .overlay(alignment: .bottomLeading) {     // ps-logo
            if let logo = it.logo {
                Text(logo).font(.kakao(size: 10)).foregroundStyle(.white.opacity(0.72)).padding(18)
            }
        }
        .overlay(alignment: .bottomTrailing) {    // ps-credit
            if let credit = it.credit {
                Text(credit).font(.kakao(size: 10)).foregroundStyle(.white.opacity(0.72))
                    .lineLimit(1).padding(18)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .shadow(color: .black.opacity(0.2), radius: 8, y: 6)
    }

    private var fallbackGradient: some View {
        LinearGradient(colors: [Color(hex: 0x2b2b2b), Color(hex: 0x171717)],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    // MARK: 아코디언 (지난 매거진 + 공식 추천) — 다크 필 + / −
    @ViewBuilder
    private func accordions(_ t: Theme) -> some View {
        VStack(spacing: 12) {
            if curations.count > 1 {
                archiveAccordion(t)
            }
            ForEach(Self.officialLists, id: \.label) { list in
                let members = catalog.mountains.filter(list.member)
                accordion(list.label, count: members.isEmpty ? nil : members.count, t) {
                    if members.isEmpty {
                        Text("등록된 산 준비 중").font(.kakao(size: 13)).foregroundStyle(t.muted)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 4)
                    } else {
                        ForEach(members) { m in
                            memberRow(m.name, "\(m.elev.map { "\($0)m" } ?? "") · \(m.region ?? "")", t) { onOpen(m.id, nil) }
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 20)
    }

    // "지난 매거진 보기" — 다른 매거진 목록(탭하면 캐러셀 전환)
    private func archiveAccordion(_ t: Theme) -> some View {
        accordion("지난 매거진 보기", count: nil, t) {
            ForEach(Array(curations.enumerated()), id: \.offset) { i, cu in
                if i != magIndex {
                    memberRow(cu.title, cu.items.first?.displayMountain ?? "", t) {
                        withAnimation(.easeOut(duration: 0.18)) {
                            magIndex = i; pickID = curations[i].items.first?.id
                            openLists.remove("지난 매거진 보기")
                        }
                    }
                }
            }
        }
    }

    private func accordion<Content: View>(_ label: String, count: Int?, _ t: Theme,
                                          @ViewBuilder _ content: () -> Content) -> some View {
        let open = openLists.contains(label)
        return VStack(spacing: 8) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) {
                    if open { openLists.remove(label) } else { openLists.insert(label) }
                }
            } label: {
                HStack(spacing: 6) {
                    Text(label).font(.kakao(size: 16, weight: .bold)).foregroundStyle(.white)
                    if let count { Text("\(count)").font(.kakao(size: 13, weight: .bold)).foregroundStyle(.white.opacity(0.6)) }
                    Spacer()
                    Text(open ? "−" : "+").font(.system(size: 20)).foregroundStyle(.white.opacity(0.8))
                }
                .padding(.horizontal, 16).padding(.vertical, 15)
                .background(cardColor, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            if open { VStack(spacing: 8) { content() } }
        }
    }

    // 아코디언 항목 — 테두리 카드 행(웹 famous-item)
    private func memberRow(_ name: String, _ meta: String, _ t: Theme, _ act: @escaping () -> Void) -> some View {
        Button(action: act) {
            HStack {
                Text(name).font(.kakao(size: 15, weight: .bold)).foregroundStyle(t.text)
                Spacer()
                Text(meta).font(.kakao(size: 12)).foregroundStyle(t.muted).lineLimit(1)
            }
            .padding(.horizontal, 16).padding(.vertical, 14)
            .background(t.elevated, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(t.line))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
