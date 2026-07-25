import SwiftUI

// 등반거리가 100m 이하로 짧을 때 저장 여부 확인 — 시스템 다이얼로그 대신 앱 UI 로 통일.
// (PackPromptView 와 같은 형태: 딤 배경 + 둥근 카드 + 세로 버튼, Theme·kakao 폰트)
//   저장 → 기존대로 기록 저장.   취소 → 저장하지 않고 등반 종료.
struct ShortClimbConfirmView: View {
    let distanceM: Double
    var onSave: () -> Void
    var onCancel: () -> Void

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let t = Theme(scheme: scheme)
        ZStack {
            Color.black.opacity(0.45).ignoresSafeArea()

            VStack(spacing: 0) {
                Text("짧은 등반")
                    .font(.kakao(size: 17, weight: .bold)).foregroundStyle(t.text)
                    .padding(.top, 22)

                Text("등반거리가 100m 이하로 짧습니다.\n저장하시나요?")
                    .font(.kakao(size: 13)).foregroundStyle(t.muted)
                    .multilineTextAlignment(.center).lineSpacing(2)
                    .padding(.top, 8).padding(.horizontal, 20)

                Text("이동 \(Int(distanceM.rounded()))m")
                    .font(.kakao(size: 13, weight: .semibold).monospacedDigit()).foregroundStyle(t.text)
                    .padding(.top, 12)

                VStack(spacing: 10) {
                    Button(action: onSave) {
                        Text("저장").font(.kakao(size: 15, weight: .bold))
                            .foregroundStyle(t.onAccent)
                            .frame(maxWidth: .infinity).padding(.vertical, 13)
                            .background(t.accent, in: RoundedRectangle(cornerRadius: 12))
                    }
                    Button(action: onCancel) {
                        Text("취소").font(.kakao(size: 15, weight: .semibold))
                            .foregroundStyle(t.text)
                            .frame(maxWidth: .infinity).padding(.vertical, 13)
                            .background(t.surface, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(t.line))
                    }
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 20)
            }
            .frame(maxWidth: 340)
            .background(t.elevated, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(t.line))
            .padding(.horizontal, 24)
        }
    }
}
