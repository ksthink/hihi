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
    // 이 드래그의 축 — 첫 판정에서 정하고 제스처가 끝날 때까지 유지한다(축 고정).
    // 매 이벤트마다 다시 재면 손가락이 호를 그릴 때 판정이 흔들린다.
    @State private var horizontal: Bool?
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
                // simultaneousGesture — 세로 스크롤과 '동시 인식'. .gesture 로 붙이면 세로 드래그도
                // 이 제스처가 선점한 뒤 아래 가드로 무시해버려, 그 터치가 List 스크롤로 넘어가지 못하고
                // 세로 스크롤이 간헐적으로 막혔다(가로 우세일 때만 카드 이동, 스크롤은 항상 살아있게).
                .simultaneousGesture(
                    DragGesture(minimumDistance: 12)
                        .onChanged { v in
                            if horizontal == nil {      // 축은 이 드래그에서 한 번만 정한다
                                horizontal = abs(v.translation.width) > abs(v.translation.height)
                            }
                            guard horizontal == true else { return }
                            let base: CGFloat = open ? -reveal : 0
                            offset = min(0, max(-reveal - 16, base + v.translation.width))   // 왼쪽으로만
                        }
                        .onEnded { v in
                            defer { horizontal = nil }
                            // ⚠️ onEnded 에도 같은 가드가 있어야 한다. 예전엔 onChanged 에만 있어서,
                            //    세로로 스크롤하다 손가락이 왼쪽으로 42pt(reveal/2)만 밀려도 카드가
                            //    열렸다 — 엄지 스크롤은 호를 그리므로 흔한 일이다. 그렇게 열리면
                            //    위 오버레이가 다음 터치를 '닫기'로 삼켜, 스크롤이 한 번 씹히는
                            //    증상이 됐다(2026-08-07 등반·기록 탭 보고).
                            guard horizontal == true else { return }
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
