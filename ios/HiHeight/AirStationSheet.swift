import SwiftUI

// 대기질 측정소 상세 — 지도의 핀이나 날씨 캡션의 측정소 이름을 누르면 뜬다.
// 웹 air.js:stationPopupHTML 과 같은 내용이다(웹은 지도 팝업, 여기는 시트).
//
// 위에서 아래로: 측정소(이름·거리·주소) → 지금 수치 → 예보 → 범례 → 잰 시각.
// "무엇을" 보고 "어떻게 읽는지"를 그 순서로 놓았다. 범례를 수치 옆이 아니라 아래에 둔 것은,
// 처음 한 번만 필요한 정보가 매번 시선을 먹지 않게 하기 위해서다.
//
// 예보는 **가로로 넘겨 본다.** 6일을 세로로 쌓으면 시트가 화면을 덮는다.
// 높이는 내용을 재서 정한다(고정값은 기기·글꼴에 따라 잘렸다 — 2026-08-10).
struct AirStationSheet: View {
    let air: AirQuality

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var contentH: CGFloat = 300

    var body: some View {
        let t = Theme(scheme: scheme)
        VStack(alignment: .leading, spacing: 0) {
            header(t)
            readings(t)
            forecastStrip(t)
            legend(t)
            if let at = air.observedAt {
                Text("\(at) 관측")
                    .font(.kakao(size: 10)).foregroundStyle(t.muted)
                    .padding(.top, 4)
            }
        }
        .padding(20)
        // ⚠️ `fixedSize` 가 핵심이다. 이게 없으면 VStack 이 시트 높이만큼 늘어난 채로 측정돼
        //    "잰 값 = 지금 detent" 가 되어 영영 줄어들지 못한다 — 내용이 작아도 카드가
        //    세로로 늘어난 채 남는다(2026-08-10 실측). 자연 높이를 재야 detent 가 수렴한다.
        .fixedSize(horizontal: false, vertical: true)
        .background(GeometryReader { g in
            Color.clear.preference(key: SheetHeightKey.self, value: g.size.height)
        })
        .onPreferenceChange(SheetHeightKey.self) { contentH = $0 }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(t.bg)
        // 상한을 둔다 — 측정이 어긋나도 시트가 화면을 덮지는 않게 하는 안전장치.
        .presentationDetents([.height(min(max(contentH, 160), 560))])
        .presentationDragIndicator(.visible)
    }

    // ── 측정소 ──────────────────────────────────────────────
    private func header(_ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(air.station ?? "") 측정소")
                    .font(.kakao(size: 18, weight: .bold)).foregroundStyle(t.text)
                if let d = air.distanceKm {
                    // ⚠️ 화살표는 **SF Symbol 로** 그린다. `↔`(U+2194) 는 카카오 폰트에 없어
                    //    조용히 사라진다 — 지도 핀의 ㎛ 와 같은 함정이다(2026-08-10).
                    HStack(spacing: 2) {
                        Image(systemName: "arrow.left.and.right")
                            .font(.system(size: 8, weight: .semibold))
                        Text("\(String(format: "%.1f", d))km").font(.kakao(size: 11))
                    }
                    .foregroundStyle(t.muted)
                }
                Spacer(minLength: 8)
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(t.muted)
                        .frame(width: 28, height: 28)      // 손가락이 닿을 만큼은 넓게
                        .contentShape(Rectangle())
                }
            }
            if let addr = air.addr, !addr.isEmpty {
                Text(addr)
                    .font(.kakao(size: 11)).foregroundStyle(t.muted)
                    .lineLimit(1)                          // 주소가 길어도 시트 높이를 흔들지 않게
            }
        }
    }

    // ── 지금 수치 — 미세·초미세를 한 행에 ────────────────────
    @ViewBuilder
    private func readings(_ t: Theme) -> some View {
        if air.pm10 != nil || air.pm25 != nil {
            HStack(spacing: 0) {
                reading("미세먼지", air.pm10, air.pm10Grade, t)
                Rectangle().fill(t.line).frame(width: 1).padding(.vertical, 8)
                reading("초미세먼지", air.pm25, air.pm25Grade, t)
            }
            .background(t.elevated, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(t.line))
            .padding(.top, 14)
        }
    }

    private func reading(_ label: String, _ v: Int?, _ grade: Int?, _ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.kakao(size: 11)).foregroundStyle(t.muted)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(v.map(String.init) ?? "–")
                    .font(.kakao(size: 21, weight: .bold).monospacedDigit())
                    .foregroundStyle(t.text)
                Text("㎍/㎥").font(.kakao(size: 10)).foregroundStyle(t.muted)
                Spacer(minLength: 4)
                if let g = grade, let tone = AirTone(rawValue: g),
                   let name = AirQuality.gradeLabel(g) {
                    badge(name, tone, t, size: 11)
                }
            }
        }
        .padding(.horizontal, 13).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // ── 예보 ────────────────────────────────────────────────
    @ViewBuilder
    private func forecastStrip(_ t: Theme) -> some View {
        if let fc = air.forecast, !fc.isEmpty {
            Text("예보")
                .font(.kakao(size: 12, weight: .bold)).foregroundStyle(t.text)
                .padding(.top, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    ForEach(fc) { day($0, t) }
                }
                .padding(.horizontal, 20)        // 스크롤 안쪽 여백 — 바깥 패딩을 상쇄한 만큼
            }
            .padding(.horizontal, -20)           // 칸이 화면 가장자리까지 흐르게
            .padding(.top, 7)
        }
    }

    /// 예보 한 칸 — 일자 · 공백 · 등급. 주간전망은 점선 테두리와 `PM2.5` 꼬리표로 구분한다.
    /// 어휘는 4단계로 통일했으므로(AirForecast.label) 칸만 봐서는 자료가 다른 줄 모른다.
    private func day(_ f: AirForecast, _ t: Theme) -> some View {
        // ⚠️ 여기에 `Spacer` 를 쓰지 않는다. 시트 높이를 내용에서 재는 구조라(SheetHeightKey),
        //    늘어나는 뷰가 하나라도 있으면 높이 → detent → 높이로 되먹임이 걸려 시트가
        //    화면을 덮을 때까지 부푼다(2026-08-10 실측). 간격은 고정값으로만 준다.
        VStack(spacing: 0) {
            Text(Self.label(for: f.date))
                .font(.kakao(size: 11)).foregroundStyle(t.muted)
            badge(f.label, f.tone, t, size: 12)
                .padding(.top, 9)                // 일자 아래 숨 쉴 자리
            Text(f.isWeekly ? "PM2.5" : " ")     // 자리를 늘 잡아 칸 높이를 맞춘다
                .font(.kakao(size: 9)).foregroundStyle(t.muted)
                .padding(.top, 3)
        }
        .frame(minWidth: 74)
        .padding(.vertical, 9).padding(.horizontal, 5)
        .background(t.elevated, in: RoundedRectangle(cornerRadius: 11))
        .overlay(RoundedRectangle(cornerRadius: 11).strokeBorder(
            t.line, style: StrokeStyle(lineWidth: 1, dash: f.isWeekly ? [3, 2] : [])))
    }

    // ── 범례 ────────────────────────────────────────────────
    // 등급 배지와 **같은 명도**를 쓴다. 그래야 위에서 본 배지를 여기서 대조할 수 있다.
    private func legend(_ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 5) {
                ForEach(AirTone.legend, id: \.1) { tone, name in
                    HStack(spacing: 3) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(tone.background(dark: t.dark))
                            .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(t.line))
                            .frame(width: 11, height: 11)
                        Text(name).font(.kakao(size: 10)).foregroundStyle(t.muted)
                    }
                }
            }
            Text("미세 30/80/150 · 초미세 15/35/75 ㎍/㎥")
                .font(.kakao(size: 10)).foregroundStyle(t.muted)
        }
        .padding(.top, 14)
    }

    private func badge(_ text: String, _ tone: AirTone, _ t: Theme, size: CGFloat) -> some View {
        Text(text)
            .font(.kakao(size: size, weight: .bold))
            .foregroundStyle(tone.foreground(dark: t.dark))
            .lineLimit(1).minimumScaleFactor(0.8)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(tone.background(dark: t.dark), in: Capsule())
            .overlay(Capsule().strokeBorder(t.line))
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
}

// 시트 높이를 내용에서 끌어올리는 통로.
private struct SheetHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}
