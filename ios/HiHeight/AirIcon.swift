import UIKit

// 대기질 측정소 핀 안의 통풍 기호 — 바람 세 줄이 끝에서 말린다.
//
// 원본: woods.co.kr `icon_category_air_purifier.svg` (2026-08-27 사용자 지정).
// 313.39×351.96 캔버스에 stroke-width 18 · round cap 인 선 3개. **웹 style.css 의
// `--air-icon` 마스크와 같은 좌표**를 쓴다 — 한쪽을 고치면 다른 쪽에서 같은 숫자를 찾을 것.
//
// SVG 원호(A 명령)는 끝점·반지름·플래그로 적혀 있어 그대로는 못 옮긴다. 표준 변환으로
// 중심과 각도를 미리 구해 뒀다(sweep=0 → 각도가 **줄어드는** 방향 = clockwise: false):
//   ① 중심 (135.31,143.26) r 22.84 ·  90° → -163.10°
//   ② 중심 (174.04,258.18) r 30.89 · 180° →  -90°
//   ③ 중심 (227.10,159.80) r 37.00 ·  90° → -180°
enum AirIcon {
    // 잉크 경계 — 선 굵기(±9)까지 포함한 값이라 이 사각형 안에 그림이 온전히 들어간다.
    private static let bx: CGFloat = 40.31, by: CGFloat = 113.80
    private static let bw: CGFloat = 232.79, bh: CGFloat = 184.27
    private static let stroke: CGFloat = 18

    /// 핀(지름 22pt) 안에 들어갈 폭. 이보다 작으면 세 줄이 뭉개져 얼룩으로 보인다.
    static let width: CGFloat = 14
    static var size: CGSize { CGSize(width: width, height: width * bh / bw) }

    static func image(ink: UIColor) -> UIImage {
        let s = width / bw
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 3                     // 선이 1pt 남짓이라 2x 로는 계단이 진다
        fmt.opaque = false
        return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in
            func P(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: (x - bx) * s, y: (y - by) * s)
            }
            let d = CGFloat.pi / 180
            let p = UIBezierPath()
            p.move(to: P(69.13, 166.10)); p.addLine(to: P(135.32, 166.10))
            p.addArc(withCenter: P(135.31, 143.26), radius: 22.84 * s,
                     startAngle: 89.98 * d, endAngle: -163.10 * d, clockwise: false)
            p.move(to: P(143.15, 258.17))
            p.addArc(withCenter: P(174.04, 258.18), radius: 30.89 * s,
                     startAngle: 179.98 * d, endAngle: -90.07 * d, clockwise: false)
            p.addLine(to: P(69.13, 227.29))
            p.move(to: P(49.31, 196.80)); p.addLine(to: P(227.10, 196.80))
            p.addArc(withCenter: P(227.10, 159.80), radius: 37 * s,
                     startAngle: 90 * d, endAngle: -180 * d, clockwise: false)
            p.lineWidth = stroke * s
            p.lineCapStyle = .round       // 원본 stroke-linecap="round"
            p.lineJoinStyle = .round
            ink.setStroke()
            p.stroke()
        }
    }
}
