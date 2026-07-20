import SwiftUI

// 강제 종료·크래시로 중단된 등반 복구 안내 — 시스템 다이얼로그 대신 앱 UI(Theme·kakao)로 통일.
// 선택지는 셋뿐: 이어서 계속 / 종료하고 저장 / 삭제. (미루기는 의미가 모호해 두지 않는다 →
// 결정할 때까지 닫히지 않으므로 세션이 어정쩡하게 남지 않는다.)
struct ClimbResumeView: View {
    let session: ClimbStore.PendingSession
    var onResume: () -> Void
    var onFinish: () -> Void
    var onDiscard: () -> Void

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let t = Theme(scheme: scheme)
        ZStack {
            Color.black.opacity(0.45).ignoresSafeArea()

            VStack(spacing: 0) {
                Text("진행 중이던 등반이 있습니다")
                    .font(.kakao(size: 17, weight: .bold)).foregroundStyle(t.text)
                    .padding(.top, 22)

                Text(startedText)
                    .font(.kakao(size: 12)).foregroundStyle(t.muted)
                    .padding(.top, 6)

                Text(summary)
                    .font(.kakao(size: 13, weight: .semibold)).foregroundStyle(t.text)
                    .multilineTextAlignment(.center)
                    .padding(.top, 10).padding(.horizontal, 20)

                VStack(spacing: 10) {
                    Button(action: onResume) {
                        Text("이어서 계속").font(.kakao(size: 15, weight: .bold))
                            .foregroundStyle(t.onAccent)
                            .frame(maxWidth: .infinity).padding(.vertical, 13)
                            .background(t.accent, in: RoundedRectangle(cornerRadius: 12))
                    }
                    Button(action: onFinish) {
                        Text("종료하고 저장").font(.kakao(size: 15, weight: .semibold))
                            .foregroundStyle(t.text)
                            .frame(maxWidth: .infinity).padding(.vertical, 13)
                            .background(t.surface, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(t.line))
                    }
                    Button(action: onDiscard) {
                        Text("삭제").font(.kakao(size: 15, weight: .semibold))
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity).padding(.vertical, 13)
                            .background(t.surface, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.red.opacity(0.4)))
                    }
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 22)
            }
            .frame(maxWidth: 340)
            .background(t.elevated, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(t.line))
            .padding(.horizontal, 28)
        }
    }

    private var summary: String {
        let name = session.courseName.isEmpty ? "등반" : session.courseName
        let km = String(format: "%.2f", session.distance / 1000)
        return "\(name)\n\(km)km · GPS \(session.track.count)지점"
    }

    private var startedText: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR")
        f.dateFormat = "M월 d일 HH:mm 시작"
        return f.string(from: session.startedAt)
    }
}
