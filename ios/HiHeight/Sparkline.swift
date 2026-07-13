import SwiftUI

// 고도 프로파일 — 웹 profileSVG(app.js:1303) 대응. 채움 영역(prof-area)+선(prof-line) 2겹으로 그린다.
// closed=true 면 선 아래를 하단까지 닫아 채움 영역. pad = 가장자리 여백(웹 3px).
// 세로는 min~max 정규화(위=높은 고도) — 상대 기복만 표현.
struct Sparkline: Shape {
    let points: [Double]
    var closed = false
    var pad: CGFloat = 3

    func path(in rect: CGRect) -> Path {
        var p = Path()
        guard points.count > 1 else { return p }
        let mn = points.min() ?? 0, mx = points.max() ?? 1
        let range = max(mx - mn, 1)
        let w = rect.width - 2 * pad, h = rect.height - 2 * pad
        func pt(_ i: Int) -> CGPoint {
            CGPoint(x: pad + w * CGFloat(i) / CGFloat(points.count - 1),
                    y: pad + h * (1 - CGFloat((points[i] - mn) / range)))
        }
        p.move(to: pt(0))
        for i in 1..<points.count { p.addLine(to: pt(i)) }
        if closed {                                   // 채움 영역: 하단 우 → 하단 좌 → 닫기
            p.addLine(to: CGPoint(x: rect.width - pad, y: rect.height - pad))
            p.addLine(to: CGPoint(x: pad, y: rect.height - pad))
            p.closeSubpath()
        }
        return p
    }
}

// 프로파일 뷰 — 채움 영역(text 10%) + 선 (웹 prof-area/prof-line).
struct ProfileView: View {
    let points: [Double]
    let color: Color
    var lineWidth: CGFloat = 1.5

    var body: some View {
        ZStack {
            Sparkline(points: points, closed: true).fill(color.opacity(0.1))
            Sparkline(points: points)
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
        }
    }
}
