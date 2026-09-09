import SwiftUI

// 지도 저장 확인 창 — **두 경로가 함께 쓴다.**
//   ① 등반 탭: 팩 없이 등반을 시작할 때의 권유(무시하고 시작 버튼 있음)
//   ② 탐험 탭: [지도 다운] 버튼(무시가 없으니 그 버튼을 감춘다 — onIgnore 를 넘기지 않으면 사라진다)
// 시스템 confirmationDialog 대신 앱 UI 로 통일.
// (ClimbResumeView 와 같은 형태: 딤 배경 + 둥근 카드 + 세로 버튼, Theme·kakao 폰트)
// 시스템 다이얼로그는 커스텀 폰트가 적용되지 않고 버튼 배치도 앱과 달라 이질적이었다.
//
// 저장을 고르면 이 창을 닫지 않고 진행률을 보여준다 — 다운로드가 끝나야 등반이 시작되므로,
// 창이 사라지면 아무 일도 일어나지 않는 것처럼 보인다.
struct PackPromptView: View {
    let mountainName: String
    var sizeText: String? = nil          // "약 2.9MB" — 없으면 용량 줄을 통째로 뺀다
    /// 창 성격을 정하는 한 줄. 기본값은 등반 시작 권유 문구다.
    var message: String = "등반 중 배터리 절약을 위해\n지도 다운을 권장합니다."
    var downloading: Bool = false
    var progress: Double = 0
    var status: String = ""
    var onSave: () -> Void
    var onIgnore: (() -> Void)? = nil    // nil 이면 "무시하고 시작" 버튼 자체가 없다
    var onCancel: () -> Void

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let t = Theme(scheme: scheme)
        ZStack {
            Color.black.opacity(0.45).ignoresSafeArea()

            VStack(spacing: 0) {
                Text("지도 다운로드")
                    .font(.kakao(size: 17, weight: .bold)).foregroundStyle(t.text)
                    .padding(.top, 22)

                Text(message)
                    .font(.kakao(size: 13)).foregroundStyle(t.muted)
                    .multilineTextAlignment(.center).lineSpacing(2)
                    .padding(.top, 8).padding(.horizontal, 20)

                // 용량은 **누르기 전에** 알려야 한다 — 셀룰러에서 수 MB 를 예고 없이 받게 하지 않는다.
                // 웹 app.js 와 같은 문구. 카탈로그에 값이 없으면 이 줄 자체가 없다.
                if let size = sizeText {
                    Text("지도 용량이 클 수 있어요 (\(size)).\nWi-Fi 상태에서 진행해 주세요.")
                        .font(.kakao(size: 12)).foregroundStyle(t.muted)
                        .multilineTextAlignment(.center).lineSpacing(2)
                        .padding(.top, 6).padding(.horizontal, 20)
                }

                if !mountainName.isEmpty {
                    Text(mountainName)
                        .font(.kakao(size: 13, weight: .semibold)).foregroundStyle(t.text)
                        .padding(.top, 12)
                }

                if downloading {
                    VStack(spacing: 6) {
                        ProgressView(value: progress).tint(t.accent)
                        Text(status).font(.kakao(size: 11)).foregroundStyle(t.muted)
                    }
                    .padding(.horizontal, 20).padding(.top, 16)
                }

                VStack(spacing: 10) {
                    Button(action: onSave) {
                        Text(downloading ? "저장 중…" : "지도 저장")
                            .font(.kakao(size: 15, weight: .bold))
                            .foregroundStyle(t.onAccent)
                            .frame(maxWidth: .infinity).padding(.vertical, 13)
                            .background(t.accent, in: RoundedRectangle(cornerRadius: 12))
                    }
                    if let onIgnore {
                        Button(action: onIgnore) {
                            Text("무시하고 시작").font(.kakao(size: 15, weight: .semibold))
                                .foregroundStyle(t.text)
                                .frame(maxWidth: .infinity).padding(.vertical, 13)
                                .background(t.surface, in: RoundedRectangle(cornerRadius: 12))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(t.line))
                        }
                    }
                    Button(action: onCancel) {
                        Text("취소").font(.kakao(size: 14))
                            .foregroundStyle(t.muted)
                            .frame(maxWidth: .infinity).padding(.vertical, 10)
                    }
                }
                .buttonStyle(.plain)
                .disabled(downloading)                 // 다운로드 중엔 중복 실행 방지
                .opacity(downloading ? 0.5 : 1)
                .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 18)
            }
            .frame(maxWidth: 340)
            .background(t.elevated, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(t.line))
            .padding(.horizontal, 24)
        }
    }
}
