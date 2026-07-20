import SwiftUI

// 등반 종료 오터치 방지 — 랜덤 2자리 확인번호를 자체 숫자 키패드로 입력해야 종료된다.
// 스타일은 앱 전반(Theme + .kakao 폰트)을 따른다. 입력이 맞으면 onConfirm() → 종료 + 기록 저장.
struct ClimbEndConfirmView: View {
    let code: String                 // 제시된 2자리 확인번호
    var onConfirm: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var input = ""
    @State private var wrong = false

    private let keys: [[String]] = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["", "0", "⌫"]]

    var body: some View {
        let t = Theme(scheme: scheme)
        VStack(spacing: 0) {
            Spacer(minLength: 8)

            Text("등반 종료").font(.kakao(size: 20, weight: .bold)).foregroundStyle(t.text)
            Text("실수로 종료되지 않도록 아래 번호를 입력하세요")
                .font(.kakao(size: 13)).foregroundStyle(t.muted)
                .padding(.top, 4)

            // 제시된 확인번호
            Text(code)
                .font(.kakao(size: 38, weight: .bold).monospacedDigit()).foregroundStyle(t.text)
                .tracking(6)
                .padding(.horizontal, 30).padding(.vertical, 12)
                .background(t.surface, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(t.line))
                .padding(.top, 18)

            // 입력 칸 2개
            HStack(spacing: 12) {
                ForEach(0..<2, id: \.self) { i in
                    let chars = Array(input)
                    Text(i < chars.count ? String(chars[i]) : " ")
                        .font(.kakao(size: 30, weight: .bold).monospacedDigit()).foregroundStyle(t.text)
                        .frame(width: 62, height: 68)
                        .background(t.elevated, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(wrong ? Color.red : t.line, lineWidth: wrong ? 2 : 1))
                }
            }
            .padding(.top, 16)

            Text(wrong ? "번호가 일치하지 않습니다. 다시 입력하세요." : " ")
                .font(.kakao(size: 12)).foregroundStyle(wrong ? .red : .clear)
                .padding(.top, 8)

            // 숫자 키패드
            VStack(spacing: 10) {
                ForEach(keys, id: \.self) { row in
                    HStack(spacing: 10) {
                        ForEach(row, id: \.self) { k in keyButton(k, t) }
                    }
                }
            }
            .padding(.top, 6)

            Button { dismiss() } label: {
                Text("취소").font(.kakao(size: 15, weight: .semibold)).foregroundStyle(t.text)
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background(t.surface, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(t.line))
            }
            .padding(.top, 18)

            Spacer(minLength: 8)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(t.bg)
    }

    @ViewBuilder private func keyButton(_ k: String, _ t: Theme) -> some View {
        if k.isEmpty {
            Color.clear.frame(maxWidth: .infinity).frame(height: 58)
        } else {
            Button { press(k) } label: {
                Text(k).font(.kakao(size: k == "⌫" ? 20 : 24, weight: .bold)).foregroundStyle(t.text)
                    .frame(maxWidth: .infinity).frame(height: 58)
                    .background(t.elevated, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(t.line))
            }
            .buttonStyle(.plain)
        }
    }

    private func press(_ k: String) {
        if k == "⌫" {
            if !input.isEmpty { input.removeLast() }
            wrong = false
            return
        }
        guard input.count < 2 else { return }
        wrong = false
        input += k
        guard input.count == 2 else { return }
        if input == code {
            onConfirm()          // 종료 + 기록 저장은 호출측에서
            dismiss()
        } else {
            wrong = true
            input = ""           // 틀리면 초기화 후 재입력
        }
    }
}
