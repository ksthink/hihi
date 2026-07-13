import SwiftUI

// 고도 스파크라인 — 코스 profile(48점)을 정규화해 Path 로 그린다(웹 climb-profile 대응).
// 순수 SwiftUI(런타임 이미지 불필요). min~max 를 세로로 채워 상대 기복만 보여준다.
struct Sparkline: Shape {
    let points: [Double]

    func path(in rect: CGRect) -> Path {
        var p = Path()
        guard points.count > 1 else { return p }
        let mn = points.min() ?? 0
        let mx = points.max() ?? 1
        let range = max(mx - mn, 1)
        let stepX = rect.width / CGFloat(points.count - 1)
        for (i, v) in points.enumerated() {
            let x = CGFloat(i) * stepX
            let y = rect.height - CGFloat((v - mn) / range) * rect.height
            if i == 0 { p.move(to: CGPoint(x: x, y: y)) }
            else { p.addLine(to: CGPoint(x: x, y: y)) }
        }
        return p
    }
}
