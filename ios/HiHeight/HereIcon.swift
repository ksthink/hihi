import UIKit

// 내 위치 픽토그램 — **웹 `here-icon.js` 의 `HERE_GRID` 와 같은 격자**다.
// POIIcons 와 같은 계약: 같은 지점이 플랫폼마다 다른 그림으로 보이지 않게, 좌표를 그대로 옮긴다.
//
// 원본 `pin.png`(64×64, 2026-08-13 사용자 제공)의 픽셀을 그대로 읽어 옮겼다.
// 잉크는 x 22~37 · y 12~55 에 있고 **2px 격자에 한 칸도 어긋나지 않는다** → 8칸 × 22줄.
//
// ⚠️ 눈대중으로 옮기지 말 것. 처음엔 화면에 뜬 그림을 보고 5칸 × 8줄로 읽었는데,
//    실제 비율이 1:2.75 인 것을 1:1.6 으로 만들어 인물이 세로로 눌렸다(2026-08-13 실기).
//    격자를 바꿀 일이 생기면 원본 PNG 를 다시 픽셀 단위로 읽을 것.
enum HereIcon {
    static let grid = [
        "..####..",
        "..####..",
        "..####..",
        "..####..",
        "........",
        "........",
        "########",
        "########",
        "##....##",
        "##....##",
        "##....##",
        "##....##",
        "##....##",
        "########",
        "########",
        "###..###",
        ".##..##.",
        ".##..##.",
        ".##..##.",
        ".##..##.",
        ".##..##.",
        ".##..##.",
    ]
    static let cols = 8
    static let rows = 22

    /// 지도 위 기본 셀 크기. 22줄 × 1 = 22pt — 예전 원형 점(지름 22pt)과 같은 높이다.
    static let cell: CGFloat = 1
    /// 반대색 헤일로 두께 = 한 칸. 흑백 지도에서 등고선·등산로와 겹쳐도 읽히게 하는 유일한
    /// 장치다(예전 점의 흰 테두리 3pt 역할). 픽셀 그림이라 칸 단위로 두르는 것이 자연스럽다.
    static let halo: CGFloat = 1

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
        fmt.scale = 3                      // 셀 1pt → 3px. 칸이 작아 2x 로는 계단이 뭉개진다.
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
