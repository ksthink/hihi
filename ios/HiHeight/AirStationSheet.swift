import SwiftUI

// 대기질 측정소 상세 — 지도의 핀이나 날씨 캡션의 측정소 이름을 누르면 뜬다.
// 웹 air.js:stationPopupHTML 과 같은 내용이다(웹은 지도 팝업, 여기는 시트).
//
// 수치는 **등급과 함께** 보여야 뜻이 통한다 — "미세 16" 만으로는 좋은 건지 알 수 없다.
// 실황(수치)과 예보(등급)는 서로 다른 API 라 한쪽만 오는 경우가 있고, 그때는 온 것만 보인다.
//
// 예보는 **가로로 넘겨 본다.** 6일을 세로로 쌓으면 시트가 화면을 덮는다(2026-08-10: 고정
// 높이로 두었더니 기기에 따라 위아래가 잘렸다). 높이는 내용을 재서 정한다 — 아래 참고.
struct AirStationSheet: View {
    let air: AirQuality

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var contentH: CGFloat = 300

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
                    .lineLimit(1)                       // 주소가 길어도 시트 높이를 흔들지 않게
                    .padding(.top, 2)
            }

            if air.pm10 != nil || air.pm25 != nil {
                VStack(spacing: 8) {
                    reading("미세먼지", air.pm10, air.pm10Grade, t)
                    reading("초미세먼지", air.pm25, air.pm25Grade, t)
                }
                .padding(.top, 14)
                if let at = air.observedAt {
                    Text("\(at) 관측")
                        .font(.kakao(size: 11)).foregroundStyle(t.muted).padding(.top, 6)
                }
            }

            if let fc = air.forecast, !fc.isEmpty {
                Divider().background(t.line).padding(.vertical, 12)
                Text("예보")
                    .font(.kakao(size: 13, weight: .bold)).foregroundStyle(t.text)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 7) {
                        ForEach(fc) { day(  $0, t) }
                    }
                    .padding(.horizontal, 20)           // 스크롤 안쪽 여백 — 바깥 패딩을 상쇄한 만큼
                }
                .padding(.horizontal, -20)              // 칩이 화면 가장자리까지 흐르게
                .padding(.top, 8)
                // 앞뒤가 다른 자료임을 밝힌다 — 같은 줄에 있으면 같은 척도로 읽힌다.
                Text(hasWeekly
                     ? "오늘·내일은 미세먼지 등급, 모레부터는 초미세먼지 주간전망(낮음·높음)입니다."
                     : "권역 단위 하루 한 값입니다(에어코리아).")
                    .font(.kakao(size: 11)).foregroundStyle(t.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        // 높이를 **내용에서 읽는다.** 고정값을 쓰면 기기·글꼴 크기에 따라 잘리거나 빈다.
        .background(GeometryReader { g in
            Color.clear.preference(key: SheetHeightKey.self, value: g.size.height)
        })
        .onPreferenceChange(SheetHeightKey.self) { contentH = $0 }
        .background(t.bg)
        .presentationDetents([.height(max(contentH, 160))])
        .presentationDragIndicator(.visible)
    }

    private var hasWeekly: Bool { air.forecast?.contains(where: \.isWeekly) ?? false }

    // 예보 한 칸 — 날짜 + 등급. 주간전망은 테두리를 점선으로 두어 다른 자료임을 눈으로도 알린다.
    private func day(_ f: AirForecast, _ t: Theme) -> some View {
        VStack(spacing: 3) {
            Text(Self.label(for: f.date)).font(.kakao(size: 11)).foregroundStyle(t.muted)
            Text(f.grade).font(.kakao(size: 14, weight: .bold)).foregroundStyle(t.text)
        }
        .frame(minWidth: 58)
        .padding(.vertical, 8).padding(.horizontal, 4)
        .background(t.elevated, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(
            t.line, style: StrokeStyle(lineWidth: 1, dash: f.isWeekly ? [3, 2] : [])))
    }

    /// "2026-08-12" → 오늘·내일이면 그 말로, 아니면 "8.12(수)".
    static func label(for date: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR")
        f.timeZone = TimeZone(identifier: "Asia/Seoul")
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: date) else { return date }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Seoul")!
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: Date()),
                                      to: cal.startOfDay(for: d)).day ?? 0
        if days == 0 { return "오늘" }
        if days == 1 { return "내일" }
        f.dateFormat = "M.d(E)"
        return f.string(from: d)
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
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(t.elevated, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(t.line))
        }
    }
}

// 시트 높이를 내용에서 끌어올리는 통로.
private struct SheetHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}
