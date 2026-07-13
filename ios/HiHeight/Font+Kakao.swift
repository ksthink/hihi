import SwiftUI

// 앱 UI 폰트 — Mulmaru(단일 웨이트) 전면 적용. 모든 UI 텍스트가 이 헬퍼를 통한다.
// 단일 face 라 요청 굵기(bold 등)는 시스템 합성(faux)으로 근사한다.
// (함수명 kakao 는 89개 호출부 호환 위해 유지 — 실제 폰트는 Mulmaru.)
// 지도 라벨은 별도(글리프 파이프라인)라 여기서 다루지 않는다.
extension Font {
    static func kakao(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom("Mulmaru", size: size).weight(weight)
    }
}
