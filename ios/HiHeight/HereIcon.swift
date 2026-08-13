import UIKit

// 내 위치 픽토그램 — **웹 `here-icon.js` 의 `HERE_GRID` 와 같은 격자**다.
// POIIcons 와 같은 계약: 같은 지점이 플랫폼마다 다른 그림으로 보이지 않게, 좌표를 그대로 옮긴다.
//
// 원본(2026-08-13 사용자 제공)을 실측해 옮겼다 — 40pt 캔버스에서 인물이 17×28pt,
// 머리 7×7pt, 머리와 몸통 사이 4pt. 셀 3.5pt 로 나누면 5칸 × 8줄로 떨어진다.
// 머리가 몸통 중심에서 반 칸 왼쪽인 것도 원본 그대로다(대칭으로 고치지 않았다).
enum HereIcon {
    static let grid = [
        ".##..",
        ".##..",
        ".....",
        "#####",
        "#####",
        "#####",
        "##.##",
        "##.##",
    ]
    static let cols = 5
    static let rows = 8

    /// 지도 위 기본 셀 크기. 8줄 × 2.5 = 20pt — 예전 원형 점(22pt)과 비슷한 무게로 보인다.
    static let cell: CGFloat = 2.5
    /// 반대색 헤일로 두께. 흑백 지도에서 등고선·등산로와 겹쳐도 읽히게 하는 유일한 장치다
    /// (예전 점의 흰 테두리 3pt 역할). 2x 화면에서 3px 로 떨어지도록 1.5 로 둔다.
    static let halo: CGFloat = 1.5

    static var size: CGSize {
        CGSize(width: CGFloat(cols) * cell + halo * 2, height: CGFloat(rows) * cell + halo * 2)
    }

    /// 채운 칸의 합집합 경로. 원점은 (halo, halo) — 헤일로가 밖으로 삐져나갈 자리를 남긴다.
    static func path() -> UIBezierPath {
        let p = UIBezierPath()
        for (r, row) in grid.enumerated() {
            for (c, ch) in row.enumerated() where ch == "#" {
                p.append(UIBezierPath(rect: CGRect(x: halo + CGFloat(c) * cell,
                                                   y: halo + CGFloat(r) * cell,
                                                   width: cell, height: cell)))
            }
        }
        return p
    }

    /// 등반 중 심볼 레이어용 이미지(`climb-pos`). 탐험은 CAShapeLayer 로 같은 경로를 직접 그린다.
    static func image(ink: UIColor, casing: UIColor) -> UIImage {
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 2                      // 셀 2.5pt → 5px, 헤일로 1.5pt → 3px. 정수라 계단이 뭉개지지 않는다.
        fmt.opaque = false
        return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in
            let p = path()
            // 헤일로는 **먼저** 굵게 긋고 그 위에 채운다 — 선의 안쪽 절반은 칠에 덮이므로
            // 결과적으로 바깥으로 halo 만큼만 남는다. 칸끼리 맞닿은 변도 같은 이유로 지워진다.
            casing.setStroke()
            p.lineWidth = halo * 2
            p.lineJoinStyle = .miter       // 픽셀 그림이라 모서리를 둥글리지 않는다
            p.stroke()
            ink.setFill()
            p.fill()
        }
    }
}
