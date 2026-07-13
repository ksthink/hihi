import SwiftUI

// 앱 UI 폰트 — 웹과 동일한 KakaoSmallSans(3 weight: Light 300 / Regular 400 / Bold 700).
// 시스템 폰트(.system) 대체. Kakao 에 없는 중간 굵기는 웹(400/700만 사용)처럼 근접값 매핑:
//   semibold·heavy·black → Bold, medium·regular → Regular, light·thin → Light.
// 지도 라벨은 별도(Nanum Gothic Coding 글리프)라 여기서 다루지 않는다.
extension Font {
    static func kakao(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .ultraLight, .thin, .light: name = "KakaoSmallSans-Light"
        case .semibold, .bold, .heavy, .black: name = "KakaoSmallSans-Bold"
        default: name = "KakaoSmallSans-Regular"
        }
        return .custom(name, size: size)
    }
}
