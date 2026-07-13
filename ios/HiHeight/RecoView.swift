import SwiftUI

// 추천 탭 — 하이하잇 PICK 캐러셀(큐레이션). 웹 renderReco/pickCarousel 대응.
// 슬라이드 탭 → 해당 산을 탐험 탭에서 연다(onOpen). 공식 추천 아코디언은 후속 슬라이스.
struct RecoView: View {
    @ObservedObject var catalog: CatalogStore
    let onOpen: (String) -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var curations: [Curation] = []

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
                }
                .padding(.bottom, 24)
            }
        }
        .task { curations = await CurationLoader.load() }
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
