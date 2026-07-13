import SwiftUI

// 시간대별 예보 스트립 — weather.js renderStrip 대응. 등반 카드용(제목 없음 · 캡션만).
// 칩: 웹 .wx-chip (min-width 52, 테두리, 지금 칩은 굵은 테두리). 가로 스크롤 + 옆 칩 살짝 보임.
struct WeatherStrip: View {
    let hours: [WeatherHour]
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let t = Theme(scheme: scheme)
        VStack(spacing: 5) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) { ForEach(hours) { WeatherChip(hour: $0) } }
            }
            Text("\(WeatherService.baseLabel) · 가장 가까운 관측지 기준")    // 웹 .wx-note
                .font(.kakao(size: 11)).foregroundStyle(t.muted)
        }
    }
}

// 예보 1칸 — 웹 .wx-chip. 시각 · 아이콘 · 기온 · (강수확률).
struct WeatherChip: View {
    let hour: WeatherHour
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let t = Theme(scheme: scheme)
        let s = WeatherService.state(hour)
        return VStack(spacing: 3) {
            Text(hour.isNow ? "지금" : "\(hour.hh)시")                    // .wx-time
                .font(.kakao(size: 11, weight: .semibold))
                .foregroundStyle(hour.isNow ? t.text : t.muted)
            Image(systemName: s.symbol)                                  // .wx-ic
                .font(.system(size: 20)).foregroundStyle(t.text).frame(height: 22)
            Text(hour.tmp.map { "\(Int($0.rounded()))°" } ?? "–")        // .wx-tmp
                .font(.kakao(size: 13, weight: .bold)).foregroundStyle(t.text)
            if hour.pty > 0, let pop = hour.pop {                        // .wx-pop
                Text("\(pop)%").font(.kakao(size: 10)).foregroundStyle(t.muted)
            }
        }
        .frame(minWidth: 52)
        .padding(.vertical, 7).padding(.horizontal, 8)
        .background(t.bg, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(hour.isNow ? t.text : t.line))
    }
}
