import SwiftUI
import UIKit

// 프로필 사진 조정 — 원형 가이드 안에서 끌어 위치를, 오므렸다 벌려 확대/축소를 맞춘다.
// 확정하면 원형으로 잘라낸 정사각 이미지를 돌려준다(ImageRenderer 로 화면 구성 그대로 렌더).
struct AvatarCropView: View {
    let image: UIImage
    var onCancel: () -> Void
    var onDone: (UIImage) -> Void

    @Environment(\.colorScheme) private var scheme

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    private let side: CGFloat = 288          // 크롭 원 지름(= 편집 영역 한 변)
    private let outPixels: CGFloat = 512     // 산출 이미지 크기

    var body: some View {
        let t = Theme(scheme: scheme)
        VStack(spacing: 0) {
            Text("프로필 사진 조정")
                .font(.kakao(size: 17, weight: .bold)).foregroundStyle(t.text)
                .padding(.top, 24)
            Text("끌어서 위치를, 두 손가락으로 확대·축소하세요")
                .font(.kakao(size: 12)).foregroundStyle(t.muted)
                .padding(.top, 6)

            editor
                .padding(.top, 22)

            // 확대 배율 슬라이더 — 한 손으로도 조정 가능하게
            HStack(spacing: 10) {
                Image(systemName: "minus.magnifyingglass").font(.system(size: 13)).foregroundStyle(t.muted)
                Slider(value: $scale, in: 1...5) { editing in if !editing { lastScale = scale } }
                    .tint(t.accent)
                Image(systemName: "plus.magnifyingglass").font(.system(size: 13)).foregroundStyle(t.muted)
            }
            .padding(.horizontal, 32).padding(.top, 18)

            Button("원래 크기로") { reset() }
                .font(.kakao(size: 13)).foregroundStyle(t.muted)
                .padding(.top, 10)

            Spacer(minLength: 12)

            VStack(spacing: 10) {
                Button { onDone(render()) } label: {
                    Text("적용").font(.kakao(size: 15, weight: .bold))
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
            .padding(.horizontal, 24).padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(t.bg)
    }

    // 편집 영역 — 사진 + 원 바깥 딤 + 원형 가이드선.
    private var editor: some View {
        ZStack {
            photo
            Rectangle().fill(Color.black.opacity(0.45))     // 원 밖만 어둡게(원은 뚫림)
                .frame(width: side, height: side)
                .mask {
                    Rectangle()
                        .overlay { Circle().blendMode(.destinationOut) }
                        .compositingGroup()
                }
                .allowsHitTesting(false)
            Circle().strokeBorder(.white.opacity(0.9), lineWidth: 2)   // 가이드 라인
                .frame(width: side, height: side)
                .allowsHitTesting(false)
        }
        .frame(width: side, height: side)
        .contentShape(Rectangle())
        .gesture(
            DragGesture()
                .onChanged { v in
                    offset = CGSize(width: lastOffset.width + v.translation.width,
                                    height: lastOffset.height + v.translation.height)
                }
                .onEnded { _ in lastOffset = offset }
        )
        .simultaneousGesture(
            MagnificationGesture()
                .onChanged { v in scale = min(5, max(1, lastScale * v)) }
                .onEnded { _ in lastScale = scale }
        )
    }

    // 렌더와 화면이 어긋나지 않도록 같은 구성을 쓴다.
    private var photo: some View {
        Image(uiImage: image)
            .resizable().scaledToFill()
            .scaleEffect(scale)
            .offset(offset)
            .frame(width: side, height: side)
            .clipped()
    }

    private func reset() {
        withAnimation(.easeOut(duration: 0.2)) {
            scale = 1; lastScale = 1; offset = .zero; lastOffset = .zero
        }
    }

    // 화면에 보이는 원 영역을 그대로 잘라 정사각 이미지로.
    @MainActor private func render() -> UIImage {
        let r = ImageRenderer(content: photo.clipShape(Circle()).frame(width: side, height: side))
        r.scale = outPixels / side
        return r.uiImage ?? image
    }
}
