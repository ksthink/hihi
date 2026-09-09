import SwiftUI

// 인트로 스플래시 — 웹 #splash(app.js splash) 이식.
// 태그라인(0.25s) → 브랜드(1.15s) → 저작권(1.6s) 순차 페이드인, 2.8s 에 페이드아웃 → 제거.
// 지도·카탈로그 초기 로딩을 자연스럽게 가리는 역할도 겸한다.
struct SplashView: View {
    let onFinished: () -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var hikerIn = false
    @State private var tagIn = false
    @State private var brandIn = false
    @State private var copyIn = false
    @State private var fadeOut = false

    var body: some View {
        let t = Theme(scheme: scheme)
        ZStack {
            t.bg.ignoresSafeArea()

            VStack(spacing: 20) {
                HikerWalk(cell: 5, tint: t.text)               // 걷는 등산가 (HikerSprite)
                    .opacity(hikerIn ? 1 : 0)
                    .padding(.bottom, 4)
                Text("끊임없이 걷다, 오롯이 몰입하다")          // .sp-tag
                    .font(.kakao(size: 15, weight: .light)).foregroundStyle(t.muted)
                    .tracking(0.6)
                    .opacity(tagIn ? 1 : 0).offset(y: tagIn ? 0 : 12)
                VStack(spacing: 8) {                          // .sp-brand
                    Text("하이-하잇").font(.kakao(size: 32, weight: .bold))
                        .foregroundStyle(t.text).tracking(-0.5)
                    Text("HI-Hike").font(.kakao(size: 12)).foregroundStyle(t.muted).tracking(3)
                }
                .opacity(brandIn ? 1 : 0).offset(y: brandIn ? 0 : 12)
            }

            VStack {                                          // .sp-copy (하단 고정)
                Spacer()
                Text("© metaphr").font(.kakao(size: 11)).foregroundStyle(t.muted).tracking(1.5)
                    .opacity(copyIn ? 1 : 0).offset(y: copyIn ? 0 : 12)
                    .padding(.bottom, 34)
            }

            VStack {                                          // 빌드 식별 (상단 좌측)
                HStack {
                    Text(buildStamp)
                        .font(.kakao(size: 9)).foregroundStyle(t.muted).opacity(0.7)
                        .tracking(0.4)
                    Spacer(minLength: 0)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20).padding(.top, 8)
        }
        .opacity(fadeOut ? 0 : 1)
        .task {
            withAnimation(.easeOut(duration: 0.8)) { hikerIn = true }
            withAnimation(.easeOut(duration: 1).delay(0.25)) { tagIn = true }
            withAnimation(.easeOut(duration: 1).delay(1.15)) { brandIn = true }
            withAnimation(.easeOut(duration: 1).delay(1.6)) { copyIn = true }
            try? await Task.sleep(nanoseconds: 2_800_000_000)   // 웹 2.8s 노출
            withAnimation(.easeInOut(duration: 0.65)) { fadeOut = true }
            try? await Task.sleep(nanoseconds: 700_000_000)     // 페이드아웃(.65s) 후 제거
            onFinished()
        }
    }

    // 빌드 식별 문자열 — "build 250 · 07-29 14:32".
    // 번호는 CFBundleVersion(testflight.sh 가 git 커밋 수로 주입, 로컬은 project.yml 기본값 1),
    // 시각은 실행 파일 수정시각 — 빌드마다 자동 갱신되므로 별도 주입 없이 로컬 빌드도 맞는다.
    private var buildStamp: String {
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        guard let url = Bundle.main.executableURL,
              let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?
                  .contentModificationDate else { return "build \(b)" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")   // 기기 12시간제 설정과 무관하게 24시간 표기
        f.dateFormat = "MM-dd HH:mm"
        return "build \(b) · \(f.string(from: date))"
    }
}
