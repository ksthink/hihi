import SwiftUI

// 앱 UI 폰트 — YK Green Forest(유한, 3 weight: Light/Medium/Bold) 전면 적용.
// 실제 face 3종이라 요청 굵기를 근접 매핑(faux 없음):
//   light·thin·ultraLight → Light, regular·medium → Medium, semibold·bold·heavy·black → Bold.
// (함수명 kakao 는 89개 호출부 호환 위해 유지 — 실제 폰트는 YK Green Forest.)
// 지도 라벨은 별도(글리프 파이프라인)라 여기서 다루지 않는다.
extension Font {
    static func kakao(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .ultraLight, .thin, .light: name = "YKGreenForestL"
        case .semibold, .bold, .heavy, .black: name = "YKGreenForestB"
        default: name = "YKGreenForestM"        // regular·medium
        }
        return .custom(name, size: size)
    }
}
