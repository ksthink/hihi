import SwiftUI

// 추천 탭 — 하이하잇 PICK 캐러셀(큐레이션). 웹 renderReco/pickCarousel 대응.
// 슬라이드 탭 → 해당 산을 탐험 탭에서 연다(onOpen). 공식 추천 아코디언은 후속 슬라이스.
struct RecoView: View {
    @ObservedObject var catalog: CatalogStore
    let onOpen: (String) -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var curations: [Curation] = []
    @State private var openLists: Set<String> = []

    // 공식 추천 카테고리 (app.js:1009) — 산의 famous/lists 로 분류.
    private static let officialLists: [(label: String, member: (Mountain) -> Bool)] = [
        ("대한민국 100대 명산", { $0.famous == true }),
        ("블랙야크(BAC) 명산 100", { ($0.lists ?? []).contains("bac100") }),
        ("국립공원공단 공식탐방로", { ($0.lists ?? []).contains("knps") }),
    ]

    var body: some View {
        let t = Theme(scheme: scheme)
        ZStack {
            t.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    Text("추천").font(.system(size: 30, weight: .bold)).foregroundStyle(t.text)
                        .padding(.horizontal, 20).padding(.top, 8)
                    if curations.isEmpty {
                        Text("추천을 불러오는 중…").font(.footnote).foregroundStyle(t.muted)
                            .padding(.horizontal, 20)
                    }
                    ForEach(curations) { cu in
                        group(cu, t)
                    }
                    officialSection(t)
                }
                .padding(.bottom, 24)
            }
        }
        .task { curations = await CurationLoader.load() }
    }

    // MARK: 공식 추천 아코디언 (100대 명산·BAC·KNPS)
    private func officialSection(_ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("공식 추천").font(.system(size: 15, weight: .semibold)).foregroundStyle(t.muted)
                .padding(.horizontal, 20)
            VStack(spacing: 0) {
                ForEach(Self.officialLists, id: \.label) { list in
                    accordion(list.label, members: catalog.mountains.filter(list.member), t)
                }
            }
            .padding(.horizontal, 20)
        }
    }

    private func accordion(_ label: String, members: [Mountain], _ t: Theme) -> some View {
        let open = openLists.contains(label)
        return VStack(spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) {
                    if open { openLists.remove(label) } else { openLists.insert(label) }
                }
            } label: {
                HStack {
                    Text(label).font(.system(size: 15, weight: .semibold)).foregroundStyle(t.text)
                    if !members.isEmpty {
                        Text("\(members.count)").font(.system(size: 13, weight: .semibold)).foregroundStyle(t.muted)
                    }
                    Spacer()
                    Image(systemName: "chevron.down").font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(t.muted).rotationEffect(.degrees(open ? 180 : 0))
                }
                .padding(.vertical, 14)
            }
            .buttonStyle(.plain)
            if open {
                if members.isEmpty {
                    Text("등록된 산 준비 중").font(.system(size: 13)).foregroundStyle(t.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.bottom, 12)
                } else {
                    ForEach(members) { m in memberRow(m, t) }
                }
            }
            Rectangle().fill(t.line).frame(height: 0.5)
        }
    }

    private func memberRow(_ m: Mountain, _ t: Theme) -> some View {
        Button { onOpen(m.id) } label: {
            HStack {
                Text(m.name).font(.system(size: 14)).foregroundStyle(t.text)
                Spacer()
                Text([m.elev.map { "\($0)m" }, m.region].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 12)).foregroundStyle(t.muted)
            }
            .padding(.vertical, 9).padding(.leading, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func group(_ cu: Curation, _ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(cu.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(t.muted)
                .padding(.horizontal, 20)
            TabView {
                ForEach(cu.items) { it in
                    slide(it)
                        .padding(.horizontal, 20)
                        .contentShape(Rectangle())
                        .onTapGesture { onOpen(it.code) }
                }
            }
            .tabViewStyle(.page(indexDisplayMode: cu.items.count > 1 ? .automatic : .never))
            .indexViewStyle(.page(backgroundDisplayMode: .interactive))
            .frame(height: 340)
        }
    }

    // 슬라이드 — 커버 이미지 위에 어둡게 깔고 흰 텍스트(웹 ps-* 오버레이). 이미지 없으면 그라디언트.
    private func slide(_ it: CurationItem) -> some View {
        ZStack(alignment: .bottomLeading) {
            Group {
                if let s = it.img, let url = URL(string: s) {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFill()
                        } else {
                            fallbackGradient
                        }
                    }
                } else {
                    fallbackGradient
                }
            }
            LinearGradient(colors: [.clear, .black.opacity(0.75)],
                           startPoint: .center, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 6) {
                if let sub = it.sub {
                    Text(sub).font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.85))
                }
                if let title = it.title {
                    Text(title).font(.system(size: 22, weight: .bold)).foregroundStyle(.white)
                } else if let name = it.name {
                    Text(name).font(.system(size: 22, weight: .bold)).foregroundStyle(.white)
                }
                if let desc = it.desc {
                    Text(desc).font(.system(size: 13)).foregroundStyle(.white.opacity(0.9))
                        .lineLimit(2)
                }
                if let logo = it.logo {
                    Text(logo).font(.system(size: 11)).foregroundStyle(.white.opacity(0.7)).padding(.top, 2)
                }
            }
            .padding(18)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 300)
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private var fallbackGradient: some View {
        LinearGradient(colors: [Color(hex: 0x3a3a3a), Color(hex: 0x0d0d0d)],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}
