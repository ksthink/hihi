import SwiftUI

// M1 탐험 화면 — 카탈로그 주도 지도. 산 선택 → 카메라 + 등고선 오버레이 전환.
// 임시 산 선택 메뉴는 M1-S2 검색 UI 로 교체 예정(지금은 데이터 구동 검증용).
struct ContentView: View {
    @Environment(\.colorScheme) private var scheme
    @StateObject private var catalog = CatalogStore()

    var body: some View {
        ZStack(alignment: .top) {
            MapView(styleResource: scheme == .dark ? "basemap-dark" : "basemap-light",
                    mountain: catalog.selected)
                .ignoresSafeArea()

            if !catalog.mountains.isEmpty {
                mountainPicker
                    .padding(.top, 8)
            } else if let err = catalog.error {
                Text(err)
                    .font(.footnote).padding(8)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                    .padding(.top, 8)
            }
        }
        .task { await catalog.load() }
    }

    private var mountainPicker: some View {
        Menu {
            ForEach(catalog.mountains) { m in
                Button {
                    catalog.selected = m
                } label: {
                    Label(m.elev.map { "\(m.name) · \($0)m" } ?? m.name,
                          systemImage: m.id == catalog.selected?.id ? "checkmark" : "mountain.2")
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(catalog.selected?.name ?? "산 선택")
                    .font(.system(size: 15, weight: .semibold))
                Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold))
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 16).padding(.vertical, 9)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(.primary.opacity(0.12)))
        }
    }
}
