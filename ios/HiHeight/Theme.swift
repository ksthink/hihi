import SwiftUI

// 웹 style.css :root 흑백 디자인 토큰의 네이티브 대응(IOS.md §4 디자인 시스템).
extension Color {
    init(hex: UInt) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xff) / 255,
                  green: Double((hex >> 8) & 0xff) / 255,
                  blue: Double(hex & 0xff) / 255,
                  opacity: 1)
    }
}

struct Theme {
    let dark: Bool
    init(scheme: ColorScheme) { dark = scheme == .dark }

    var bg: Color       { Color(hex: dark ? 0x000000 : 0xffffff) }
    var surface: Color  { Color(hex: dark ? 0x0c0c0c : 0xf2f2f2) }
    var elevated: Color { Color(hex: dark ? 0x171717 : 0xffffff) }
    var text: Color     { Color(hex: dark ? 0xf2f2f2 : 0x111111) }
    var muted: Color    { Color(hex: dark ? 0x8c8c8c : 0x767676) }
    var line: Color     { Color(hex: dark ? 0x2a2a2a : 0xe3e3e3) }
    var accent: Color   { Color(hex: dark ? 0xf2f2f2 : 0x111111) }
    var onAccent: Color { Color(hex: dark ? 0x000000 : 0xffffff) }
}
