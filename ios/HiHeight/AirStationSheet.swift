import SwiftUI

// 대기질 측정소 상세 — 지도의 핀이나 날씨 캡션의 측정소 이름을 누르면 뜬다.
// 웹 air.js:stationPopupHTML 과 같은 내용이다(웹은 지도 팝업, 여기는 시트).
//
// 수치는 **등급과 함께** 보여야 뜻이 통한다 — "미세 16" 만으로는 좋은 건지 알 수 없다.
// 실황(수치)과 예보(등급)는 서로 다른 API 라 한쪽만 오는 경우가 있고, 그때는 온 것만 보인다.
struct AirStationSheet: View {
    let air: AirQuality

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let t = Theme(scheme: scheme)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(air.station ?? "") 측정소")
                    .font(.kakao(size: 19, weight: .bold)).foregroundStyle(t.text)
                Spacer()
                Button("닫기") { dismiss() }
                    .font(.kakao(size: 14)).foregroundStyle(t.muted)
            }

            if let d = air.distanceKm {
                Text("이 산에서 \(String(format: "%.1f", d))km")
                    .font(.kakao(size: 13)).foregroundStyle(t.muted).padding(.top, 3)
            }
            if let addr = air.addr, !addr.isEmpty {
                Text(addr)
                    .font(.kakao(size: 12)).foregroundStyle(t.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }

            if air.pm10 != nil || air.pm25 != nil {
                VStack(spacing: 8) {
                    reading("미세먼지", air.pm10, air.pm10Grade, t)
                    reading("초미세먼지", air.pm25, air.pm25Grade, t)
                }
                .padding(.top, 16)
                if let at = air.observedAt {
                    Text("\(at) 관측")
                        .font(.kakao(size: 11)).foregroundStyle(t.muted).padding(.top, 8)
                }
            }

            if air.today != nil || air.tomorrow != nil {
                Divider().background(t.line).padding(.vertical, 14)
                Text("미세먼지 예보")
                    .font(.kakao(size: 13, weight: .bold)).foregroundStyle(t.text)
                HStack(spacing: 18) {
                    if let g = air.today { forecast("오늘", g, t) }
                    if let g = air.tomorrow { forecast("내일", g, t) }
                }
                .padding(.top, 8)
                // 이 값이 왜 시간대별로 안 변하는지 밝힌다 — 칩에 같은 값이 반복되는 이유다.
                Text("예보는 권역 단위 하루 한 값입니다(에어코리아). 시간대별 값은 제공되지 않습니다.")
                    .font(.kakao(size: 11)).foregroundStyle(t.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
            }

            Spacer(minLength: 0)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.bg)
        // 내용만큼만 — 예보 블록이 없으면 그만큼 낮춘다(빈 공간이 남으면 무언가 빠진 것처럼 보인다).
        .presentationDetents([.height(air.today != nil || air.tomorrow != nil ? 350 : 250)])
    }

    @ViewBuilder
    private func reading(_ label: String, _ v: Int?, _ grade: Int?, _ t: Theme) -> some View {
        if let v {
            HStack {
                Text(label).font(.kakao(size: 14)).foregroundStyle(t.muted)
                Spacer()
                Text("\(v)").font(.kakao(size: 20, weight: .bold).monospacedDigit())
                    .foregroundStyle(t.text)
                Text("㎍/㎥").font(.kakao(size: 11)).foregroundStyle(t.muted)
                if let g = AirQuality.gradeLabel(grade) {
                    Text(g).font(.kakao(size: 12, weight: .bold)).foregroundStyle(t.text)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(t.surface, in: Capsule())
                        .overlay(Capsule().strokeBorder(t.line))
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(t.elevated, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(t.line))
        }
    }

    private func forecast(_ when: String, _ grade: String, _ t: Theme) -> some View {
        VStack(spacing: 3) {
            Text(when).font(.kakao(size: 11)).foregroundStyle(t.muted)
            Text(grade).font(.kakao(size: 15, weight: .bold)).foregroundStyle(t.text)
        }
        .frame(minWidth: 62)
        .padding(.vertical, 8)
        .background(t.elevated, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(t.line))
    }
}
