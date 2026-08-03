import UIKit

// 기저지도·스팟 POI 아이콘 — **웹 `poi-icons.js` 의 `makePoiIcon` 과 같은 그림**을 그린다.
//
// ⚠️ 예전에는 SF Symbols 로 대체했다(`poi-place_of_worship` → `building.columns.fill` 등).
//    id 만 맞추면 된다고 본 계약이었는데, 같은 지점이 플랫폼마다 다른 그림으로 보였다 —
//    사찰이 웹에서는 卍, 앱에서는 그리스 신전 모양이었다(2026-08-01 보고).
//    기호는 의미를 담으므로 id 뿐 아니라 **렌더까지** 웹과 맞춘다.
//
// 좌표계는 웹 캔버스와 동일한 20pt 기준(2x 렌더). 웹 코드의 숫자를 그대로 옮겨,
// 한쪽을 고칠 때 다른 쪽에서 같은 줄을 찾을 수 있게 했다.
enum POIIcons {

    // 글자 아이콘 — 웹 POI_TEXT 와 같은 표기.
    private static let text: [String: String] = [
        "toilets": "WC", "parking": "P", "information": "i",
        "place_of_worship": "卍", "helipad": "H",
    ]

    // 스타일이 참조하는 이름 전체(기저 POI + 팩 스팟 편의시설).
    // ⚠️ 네이티브에는 웹의 styleimagemissing 같은 지연 생성이 없다 — 여기 빠지면
    //    아이콘뿐 아니라 **라벨까지 통째로** 안 그려진다(2026-07-23 전철역 사고).
    static let names = [
        "poi-station", "poi-bus_stop", "poi-place_of_worship", "poi-information",
        "poi-viewpoint", "poi-toilets", "poi-shelter", "poi-helipad",
        "poi-drinking_water", "poi-parking",
    ]

    static func make(_ id: String, dark: Bool) -> UIImage? {
        let kind = id.hasPrefix("poi-") ? String(id.dropFirst(4)) : id
        let fg = dark ? UIColor(white: 0.949, alpha: 1) : UIColor(white: 0.067, alpha: 1)  // #f2f2f2 / #111
        let bg = dark ? UIColor.black : UIColor.white
        let S: CGFloat = 20, P: CGFloat = 2

        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 2                      // 웹 캔버스 2x 와 동일
        fmt.opaque = false
        let r = UIGraphicsImageRenderer(size: CGSize(width: S, height: S), format: fmt)

        return r.image { rc in
            let c = rc.cgContext

            // 배지 — 역·헬기장은 원형(관제 기호 관례), 나머지는 라운드 사각.
            let badge: UIBezierPath = (kind == "station" || kind == "helipad")
                ? UIBezierPath(arcCenter: CGPoint(x: S / 2, y: S / 2), radius: S / 2 - P,
                               startAngle: 0, endAngle: .pi * 2, clockwise: true)
                : UIBezierPath(roundedRect: CGRect(x: P, y: P, width: S - 2 * P, height: S - 2 * P),
                               cornerRadius: 4)
            bg.setFill(); badge.fill()
            fg.setStroke(); badge.lineWidth = 1.4; badge.stroke()

            fg.setFill(); fg.setStroke()

            if let t = text[kind] {
                // 글자 아이콘 (WC · P · i · 卍) — 두 글자는 8pt, 한 글자는 11pt.
                let size: CGFloat = t.count > 1 ? 8 : 11
                let attrs: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: size, weight: .bold),
                    .foregroundColor: fg,
                ]
                let str = NSAttributedString(string: t, attributes: attrs)
                let b = str.size()
                // 웹은 textBaseline=middle, y = S/2 + 0.5 — 시각 중심을 맞춘다.
                str.draw(at: CGPoint(x: (S - b.width) / 2, y: (S - b.height) / 2 + 0.5))

            } else if kind == "bus_stop" {
                // 버스: 차체 + 창 + 바퀴
                UIBezierPath(roundedRect: CGRect(x: 5.5, y: 5, width: 9, height: 8), cornerRadius: 1.5).fill()
                bg.setFill()
                UIBezierPath(rect: CGRect(x: 6.5, y: 6.5, width: 7, height: 2.5)).fill()
                fg.setFill()
                UIBezierPath(ovalIn: CGRect(x: 7.5 - 1.2, y: 14 - 1.2, width: 2.4, height: 2.4)).fill()
                UIBezierPath(ovalIn: CGRect(x: 12.5 - 1.2, y: 14 - 1.2, width: 2.4, height: 2.4)).fill()

            } else if kind == "station" {
                // 전철: 차체 + 창 + 하단 레일
                UIBezierPath(roundedRect: CGRect(x: 6, y: 4.5, width: 8, height: 8.5), cornerRadius: 2).fill()
                bg.setFill()
                UIBezierPath(rect: CGRect(x: 7, y: 6, width: 6, height: 3)).fill()
                fg.setStroke()
                let rail = UIBezierPath()
                rail.lineWidth = 1
                rail.move(to: CGPoint(x: 6.5, y: 15.5)); rail.addLine(to: CGPoint(x: 9, y: 13))
                rail.move(to: CGPoint(x: 13.5, y: 15.5)); rail.addLine(to: CGPoint(x: 11, y: 13))
                rail.stroke()

            } else if kind == "drinking_water" {
                // 물방울
                let p = UIBezierPath()
                p.move(to: CGPoint(x: S / 2, y: 4.5))
                p.addCurve(to: CGPoint(x: 14, y: 12),
                           controlPoint1: CGPoint(x: 13.5, y: 8.5), controlPoint2: CGPoint(x: 14, y: 10.5))
                p.addArc(withCenter: CGPoint(x: S / 2, y: 12), radius: 4,
                         startAngle: 0, endAngle: .pi, clockwise: true)
                p.addCurve(to: CGPoint(x: S / 2, y: 4.5),
                           controlPoint1: CGPoint(x: 6, y: 10.5), controlPoint2: CGPoint(x: 6.5, y: 8.5))
                p.fill()

            } else if kind == "viewpoint" {
                // 조망점: 시점(점) + 부챗살(국제 지도 관례)
                let fan = UIBezierPath()
                fan.lineWidth = 1.3
                fan.lineCapStyle = .round
                for a in [-52.0, -26.0, 0.0, 26.0, 52.0] {
                    let rad = (a - 90) * .pi / 180
                    fan.move(to: CGPoint(x: S / 2, y: 13.5))
                    fan.addLine(to: CGPoint(x: S / 2 + cos(rad) * 8, y: 13.5 + sin(rad) * 8))
                }
                fan.stroke()
                UIBezierPath(ovalIn: CGRect(x: S / 2 - 1.8, y: 13.5 - 1.8, width: 3.6, height: 3.6)).fill()

            } else if kind == "shelter" {
                // 정자: 지붕(팔작 곡선) + 기둥 2 + 마루
                let roof = UIBezierPath()
                roof.move(to: CGPoint(x: 4.5, y: 9))
                roof.addQuadCurve(to: CGPoint(x: 15.5, y: 9), controlPoint: CGPoint(x: S / 2, y: 3))
                roof.addLine(to: CGPoint(x: 4.5, y: 9))
                roof.fill()
                let posts = UIBezierPath()
                posts.lineWidth = 1.5
                posts.lineCapStyle = .round
                posts.move(to: CGPoint(x: 7, y: 9.5)); posts.addLine(to: CGPoint(x: 7, y: 14.5))
                posts.move(to: CGPoint(x: 13, y: 9.5)); posts.addLine(to: CGPoint(x: 13, y: 14.5))
                posts.stroke()
                UIBezierPath(rect: CGRect(x: 5, y: 14.5, width: 10, height: 1.4)).fill()

            } else {
                c.clear(CGRect(x: 0, y: 0, width: S, height: S))   // 모르는 아이콘은 만들지 않음
            }
        }
    }
}
