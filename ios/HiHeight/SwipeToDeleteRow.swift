import SwiftUI

// 커스텀 스와이프 삭제 행 — 카드가 삭제 버튼 '위로' 미끄러지는 효과. (기록 탭·등반 탭 공용)
// 시스템 swipeActions 는 행 옆에 나란히 놓이는 구조라 (1)왼쪽 모서리 각짐 (2)카드와의 틈
// (3)겹침 효과 불가 — 세 가지를 동시에 해결할 수 없어 직접 구현한다.
// 세로 스크롤과의 충돌을 피하려 가로 우세 드래그일 때만 반응한다.
struct SwipeToDeleteRow<Content: View>: View {
    let onDelete: () -> Void
    var corner: CGFloat = 14        // 감싸는 카드와 같은 모서리 반경으로 맞춘다
    let content: Content

    init(corner: CGFloat = 14, onDelete: @escaping () -> Void, @ViewBuilder content: () -> Content) {
        self.corner = corner
        self.onDelete = onDelete
        self.content = content()
    }

    @State private var offset: CGFloat = 0
    @State private var open = false
    private let reveal: CGFloat = 84          // 열렸을 때 드러나는 삭제 영역 폭

    var body: some View {
        ZStack(alignment: .trailing) {
            // 아래 레이어 — 삭제 버튼(카드와 같은 라운드). 카드가 이 위를 덮는다.
            Button(action: onDelete) {
                Image(systemName: "trash").font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: reveal).frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .background(Color.red, in: RoundedRectangle(cornerRadius: corner))

            // 위 레이어 — 카드. 열려 있을 때 카드를 누르면 닫힌다(잘못된 이동 방지).
            content
                .overlay {
                    if open {
                        Color.black.opacity(0.001).contentShape(Rectangle())
                            .onTapGesture { close() }
                    }
                }
                .offset(x: offset)
                .gesture(
                    DragGesture(minimumDistance: 12)
                        .onChanged { v in
                            guard abs(v.translation.width) > abs(v.translation.height) else { return }
                            let base: CGFloat = open ? -reveal : 0
                            offset = min(0, max(-reveal - 16, base + v.translation.width))   // 왼쪽으로만
                        }
                        .onEnded { v in
                            let base: CGFloat = open ? -reveal : 0
                            let end = base + v.translation.width
                            withAnimation(.interactiveSpring(response: 0.32, dampingFraction: 0.86)) {
                                open = end < -reveal / 2
                                offset = open ? -reveal : 0
                            }
                        }
                )
        }
    }

    private func close() {
        withAnimation(.interactiveSpring(response: 0.32, dampingFraction: 0.86)) {
            open = false; offset = 0
        }
    }
}
