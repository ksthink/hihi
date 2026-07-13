import SwiftUI

// 앱 UI 폰트 — MonaS12 (웨이트 2종: Regular/Bold) 전면 적용.
// face 2종이라 요청 굵기를 속성에 따라 근접 매핑(faux 없음):
//   semibold·bold·heavy·black → Bold, 그 외(ultraLight·thin·light·regular·medium) → Regular.
// (함수명 kakao 는 89개 호출부 호환 위해 유지 — 실제 폰트는 MonaS12. .custom 은 PostScript 명.)
// 지도 라벨은 별도(글리프 파이프라인)라 여기서 다루지 않는다.
extension Font {
    static func kakao(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .semibold, .bold, .heavy, .black: name = "MonaS12-Bold"
        default: name = "MonaS12-Regular"       // ultraLight·thin·light·regular·medium
        }
        return .custom(name, size: size)
    }
}
