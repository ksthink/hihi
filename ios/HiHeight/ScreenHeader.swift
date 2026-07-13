import SwiftUI

// 탭 상단 고정 헤더 — 웹 .view-head 대응. 스크롤과 무관하게 상단 고정 + 하단 헤어라인.
// 본문(스크롤 영역)은 이 헤더 아래에 배치한다.
struct ScreenHeader<Trailing: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var trailing: () -> Trailing
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let t = Theme(scheme: scheme)
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.kakao(size: 26, weight: .bold)).foregroundStyle(t.text)
                Spacer(minLength: 8)
                trailing()
            }
            if let subtitle {
                Text(subtitle).font(.kakao(size: 13)).foregroundStyle(t.muted)
            }
        }
        .padding(.horizontal, 20).padding(.top, 6).padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.bg)
        .overlay(alignment: .bottom) { Rectangle().fill(t.line).frame(height: 0.5) }
    }
}

extension ScreenHeader where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil) {
        self.init(title: title, subtitle: subtitle) { EmptyView() }
    }
}
