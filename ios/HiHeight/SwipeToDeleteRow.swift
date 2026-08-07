import SwiftUI
import UIKit

// 커스텀 스와이프 삭제 행 — 카드가 삭제 버튼 '위로' 미끄러지는 효과. (기록 탭·등반 탭 공용)
// 시스템 swipeActions 는 행 옆에 나란히 놓이는 구조라 (1)왼쪽 모서리 각짐 (2)카드와의 틈
// (3)겹침 효과 불가 — 세 가지를 동시에 해결할 수 없어 직접 구현한다.
//
// ⚠️ 제스처는 **UIKit 인식기**로 붙인다. SwiftUI DragGesture 로는 세로 스크롤이 씹혔다.
//    이 프로젝트에서 두 번 걸린 문제다:
//      2026-07-13 `1ec1a30` — "ScrollView + 커스텀 드래그는 세로 스크롤과 충돌"이라 판단해
//                  네이티브 List.swipeActions 로 갔다(그 주석이 RecordsView 에 남아 있다).
//      2026-07-25 `a736bd8` — 디자인 때문에 커스텀으로 되돌아오며 같은 충돌을 다시 안고 갔다.
//      2026-08-07 `0a26ba3` — onEnded 가드(축 고정)를 넣어 "세로 스크롤이 카드를 여는" 증상은
//                  고쳤지만, **씹힘 자체는 그대로**였다.
//    가드로 안 되는 이유: 씹힘은 판정 '이후'가 아니라 '이전'에 생긴다. 터치가 내려오는 순간
//    스크롤 컨테이너와 DragGesture 가 동시에 후보가 되고, 누구 것인지 정하는 동안 빠른 플릭이
//    한 번 먹힌다. simultaneousGesture·minimumDistance 로는 이 경쟁 자체가 사라지지 않는다.
//    UIKit 은 `gestureRecognizerShouldBegin` 에서 **시작 전에** 가려낼 수 있다 —
//    세로 우세 터치면 우리 pan 이 아예 시작하지 않아 스크롤이 온전히 살아난다.
struct SwipeToDeleteRow<Content: View>: View {
    let onDelete: () -> Void
    var corner: CGFloat = 14        // 감싸는 카드와 같은 모서리 반경으로 맞춘다
    // 행 탭 — content 에 .onTapGesture 를 달지 말고 이리로 넘긴다.
    // 제스처를 UIKit 오버레이가 받으므로 SwiftUI 탭은 이 위에서 동작하지 않는다.
    var onTap: (() -> Void)?
    let content: Content

    init(corner: CGFloat = 14,
         onDelete: @escaping () -> Void,
         onTap: (() -> Void)? = nil,
         @ViewBuilder content: () -> Content) {
        self.corner = corner
        self.onDelete = onDelete
        self.onTap = onTap
        self.content = content()
    }

    @State private var offset: CGFloat = 0
    @State private var open = false
    private let reveal: CGFloat = 84          // 열렸을 때 드러나는 삭제 영역 폭

    var body: some View {
        ZStack(alignment: .trailing) {
            // 아래 레이어 — 삭제 버튼(카드와 같은 라운드). 카드가 이 위를 덮는다.
            // 카드가 왼쪽으로 밀린 만큼만 드러나고, 그 영역엔 아래 제스처 오버레이가 없다
            // (오버레이는 카드에 붙어 함께 이동) → 삭제 버튼 탭이 막히지 않는다.
            Button(action: onDelete) {
                Image(systemName: "trash").font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: reveal).frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .background(Color.red, in: RoundedRectangle(cornerRadius: corner))

            // 위 레이어 — 카드 + 제스처 오버레이.
            content
                .overlay {
                    RowGestures(
                        onTap: {
                            if open { close() } else { onTap?() }   // 열려 있으면 먼저 닫는다
                        },
                        onPan: { dx in
                            let base: CGFloat = open ? -reveal : 0
                            offset = min(0, max(-reveal - 16, base + dx))   // 왼쪽으로만
                        },
                        onPanEnd: { dx in
                            let base: CGFloat = open ? -reveal : 0
                            withAnimation(.interactiveSpring(response: 0.32, dampingFraction: 0.86)) {
                                open = (base + dx) < -reveal / 2
                                offset = open ? -reveal : 0
                            }
                        },
                        onPanCancel: {
                            withAnimation(.interactiveSpring(response: 0.32, dampingFraction: 0.86)) {
                                offset = open ? -reveal : 0
                            }
                        })
                }
                .offset(x: offset)
        }
    }

    private func close() {
        withAnimation(.interactiveSpring(response: 0.32, dampingFraction: 0.86)) {
            open = false; offset = 0
        }
    }
}

// 행 제스처(가로 팬 + 탭)를 UIKit 인식기로 제공한다.
// 탭까지 여기서 받는 이유: 오버레이가 터치를 먼저 가져가므로 SwiftUI 의 .onTapGesture 를
// 카드 안에 두면 반응하지 않는다. 두 제스처를 한 곳에서 다뤄 우선순위도 명확해진다.
private struct RowGestures: UIViewRepresentable {
    let onTap: () -> Void
    let onPan: (CGFloat) -> Void
    let onPanEnd: (CGFloat) -> Void
    let onPanCancel: () -> Void

    func makeUIView(context: Context) -> UIView {
        let v = UIView()
        v.backgroundColor = .clear
        let pan = UIPanGestureRecognizer(target: context.coordinator,
                                         action: #selector(Coordinator.handlePan(_:)))
        pan.delegate = context.coordinator
        v.addGestureRecognizer(pan)

        let tap = UITapGestureRecognizer(target: context.coordinator,
                                         action: #selector(Coordinator.handleTap(_:)))
        tap.delegate = context.coordinator
        v.addGestureRecognizer(tap)
        return v
    }

    func updateUIView(_ v: UIView, context: Context) {
        context.coordinator.parent = self       // 클로저가 최신 상태를 잡도록 갱신
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: RowGestures
        init(_ p: RowGestures) { parent = p }

        @objc func handlePan(_ g: UIPanGestureRecognizer) {
            let dx = g.translation(in: g.view).x
            switch g.state {
            case .changed: parent.onPan(dx)
            case .ended:   parent.onPanEnd(dx)
            case .cancelled, .failed: parent.onPanCancel()
            default: break
            }
        }

        @objc func handleTap(_ g: UITapGestureRecognizer) { parent.onTap() }

        // ★ 핵심 — 세로 우세 터치에서는 pan 을 **시작시키지 않는다**.
        //   시작하지 않으면 스크롤 컨테이너가 경쟁 없이 그 터치를 가져가므로 스크롤이 매끄럽다.
        //   1.5 배는 여유 계수 — 엄지 스크롤은 호를 그려 가로 성분이 늘 조금씩 섞인다.
        func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
            guard let pan = g as? UIPanGestureRecognizer else { return true }   // 탭은 그대로
            let v = pan.velocity(in: pan.view)
            return abs(v.x) > abs(v.y) * 1.5
        }

        // 스크롤 인식기와 동시 인식하지 않는다 — 시작 판정에서 이미 갈랐으므로,
        // 우리 pan 이 시작됐다면 그 터치는 가로 스와이프가 맞다.
        func gestureRecognizer(_ g: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            false
        }
    }
}
