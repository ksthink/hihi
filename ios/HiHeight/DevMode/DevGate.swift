import SwiftUI

// 개발자 모드 진입점 — 프로필 수정 화면 로그아웃 아래에 놓는 토글. (DevMode/ — 삭제 대상)
struct DevGate: View {
    @ObservedObject var dev = DevStore.shared
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let t = Theme(scheme: scheme)
        Toggle(isOn: Binding(
            get: { dev.enabled },
            set: { on in dev.enabled = on; if on { dev.hudVisible = true } }
        )) {
            Text("개발자 모드").font(.kakao(size: 12)).foregroundStyle(t.muted)
        }
        .tint(t.accent)
        .padding(.horizontal, 4)
    }
}
