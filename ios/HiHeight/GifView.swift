import SwiftUI
import UIKit
import ImageIO
import UniformTypeIdentifiers

// 움직이는 GIF 재생 — 추천 탭 큐레이션 커버용.
//
// ⚠️ SwiftUI 의 AsyncImage 는 GIF 의 **첫 프레임만** 그린다(Image 가 정지 이미지라서).
//    관리자에서 GIF 를 올릴 수 있게 되면서(2026-08-01) 움짤이 정지 화면으로 보였다.
//    UIImageView 는 `UIImage.animatedImage(with:duration:)` 를 그대로 재생하므로
//    UIViewRepresentable 로 감싸 쓴다.
//
// 프레임 지연은 kCGImagePropertyGIFDictionary 에서 읽는다 —
//   UnclampedDelayTime 우선(브라우저가 쓰는 값), 없으면 DelayTime.
//   둘 다 0 이거나 지나치게 짧으면 100ms 로 보정한다(웹 브라우저와 같은 관례).
struct GifView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> UIImageView {
        let v = UIImageView()
        v.contentMode = .scaleAspectFill
        v.clipsToBounds = true
        // 셀 폭에 맞춰 늘어나되 이미지 고유 크기가 레이아웃을 밀지 않게.
        v.setContentHuggingPriority(.defaultLow, for: .horizontal)
        v.setContentHuggingPriority(.defaultLow, for: .vertical)
        v.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        v.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        load(into: v)
        return v
    }

    func updateUIView(_ v: UIImageView, context: Context) {
        // 같은 URL 을 다시 그리지 않는다(스크롤 중 재생이 처음부터 되감기는 것 방지).
        guard context.coordinator.url != url else { return }
        load(into: v)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator { var url: URL? }

    private func load(into v: UIImageView) {
        let target = url
        GifLoader.image(for: target) { img in
            guard let img else { return }
            v.image = img
        }
    }
}

// GIF 다운로드 + 디코드 캐시. 캐러셀을 좌우로 넘길 때마다 다시 받지 않게 한다.
enum GifLoader {
    // 디코드된 UIImage 를 캐시한다(데이터만 캐시하면 넘길 때마다 프레임을 다시 만든다).
    // 총량 제한만 두고 개수는 열어 둔다 — 큐레이션 커버는 많아야 수십 장이다.
    private static let cache: NSCache<NSURL, UIImage> = {
        let c = NSCache<NSURL, UIImage>()
        c.totalCostLimit = 64 * 1024 * 1024   // 64MB
        return c
    }()

    static func image(for url: URL, completion: @escaping (UIImage?) -> Void) {
        if let hit = cache.object(forKey: url as NSURL) {
            completion(hit)
            return
        }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data, let img = animatedImage(from: data) else {
                DispatchQueue.main.async { completion(nil) }
                return
            }
            // 비용 = 대략적인 픽셀 바이트 수(프레임 수 × 한 장 크기).
            let cost = Int(img.size.width * img.size.height * 4) * max(img.images?.count ?? 1, 1)
            cache.setObject(img, forKey: url as NSURL, cost: cost)
            DispatchQueue.main.async { completion(img) }
        }.resume()
    }

    /// GIF 데이터 → 애니메이션 UIImage. 단일 프레임이면 그 한 장을 그대로 돌려준다.
    static func animatedImage(from data: Data) -> UIImage? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let count = CGImageSourceGetCount(src)
        guard count > 0 else { return nil }
        if count == 1 {
            return CGImageSourceCreateImageAtIndex(src, 0, nil).map(UIImage.init(cgImage:))
        }

        var frames: [UIImage] = []
        var total: Double = 0
        frames.reserveCapacity(count)
        for i in 0..<count {
            guard let cg = CGImageSourceCreateImageAtIndex(src, i, nil) else { continue }
            frames.append(UIImage(cgImage: cg))
            total += delay(src, i)
        }
        guard !frames.isEmpty else { return nil }
        return UIImage.animatedImage(with: frames, duration: total)
    }

    private static func delay(_ src: CGImageSource, _ i: Int) -> Double {
        guard let props = CGImageSourceCopyPropertiesAtIndex(src, i, nil) as? [CFString: Any],
              let gif = props[kCGImagePropertyGIFDictionary] as? [CFString: Any]
        else { return 0.1 }
        // Unclamped 가 원본 값. DelayTime 은 브라우저 호환을 위해 0.01 미만이 잘려 온다.
        let unclamped = (gif[kCGImagePropertyGIFUnclampedDelayTime] as? Double) ?? 0
        let clamped = (gif[kCGImagePropertyGIFDelayTime] as? Double) ?? 0
        let d = unclamped > 0 ? unclamped : clamped
        // 0 이거나 비정상적으로 짧으면 100ms — 브라우저와 같은 관례(그대로 두면 정신없이 깜박인다).
        return d < 0.011 ? 0.1 : d
    }
}

extension URL {
    /// 이 URL 이 GIF 인가(확장자 기준, 대소문자 무시).
    var isGif: Bool { pathExtension.lowercased() == "gif" }
}
