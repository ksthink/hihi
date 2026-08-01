import SwiftUI

// 확인 팝업 — 시스템 confirmationDialog 대신 앱 UI 로 통일(PackPromptView·ClimbResumeView 와 같은 형태).
// 시스템 다이얼로그는 커스텀 폰트(MonaS12)가 적용되지 않고 버튼 배치도 앱과 달라 이질적이다.
// 딤 배경 + 둥근 카드 + 세로 버튼(주 동작 = accent, 취소 = muted 텍스트).
struct ConfirmPromptView: View {
    let title: String
    let message: String
    var confirmLabel: String = "예"
    var cancelLabel: String = "취소"
    var onConfirm: () -> Void
    var onCancel: () -> Void

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let t = Theme(scheme: scheme)
        ZStack {
            // 배경 탭 = 취소. 시스템 다이얼로그의 바깥 탭 동작과 같게.
            Color.black.opacity(0.45).ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture(perform: onCancel)

            VStack(spacing: 0) {
                Text(title)
                    .font(.kakao(size: 17, weight: .bold)).foregroundStyle(t.text)
                    .padding(.top, 22)

                Text(message)
                    .font(.kakao(size: 13)).foregroundStyle(t.muted)
                    .multilineTextAlignment(.center).lineSpacing(2)
                    .padding(.top, 8).padding(.horizontal, 20)

                VStack(spacing: 10) {
                    Button(action: onConfirm) {
                        Text(confirmLabel)
                            .font(.kakao(size: 15, weight: .bold))
                            .foregroundStyle(t.onAccent)
                            .frame(maxWidth: .infinity).padding(.vertical, 13)
                            .background(t.accent, in: RoundedRectangle(cornerRadius: 12))
                    }
                    Button(action: onCancel) {
                        Text(cancelLabel).font(.kakao(size: 14))
                            .foregroundStyle(t.muted)
                            .frame(maxWidth: .infinity).padding(.vertical, 10)
                    }
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 18)
            }
            .frame(maxWidth: 340)
            .background(t.elevated, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(t.line))
            .padding(.horizontal, 24)
        }
    }
}
