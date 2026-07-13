import SwiftUI

// 등반 탭 — 웹 #view-deung(climb-card) 재현.
// 탐험 탭에서 고른 코스의 거리·시간·난이도·고도·프로파일을 보여주고 "등반 시작" 진입점을 둔다.
// 실시간 GPS 트래킹·HUD·기록 저장은 M5(CoreLocation/백그라운드 위치) 단계에서 구현한다.
struct DeungView: View {
    @ObservedObject var climb: ClimbStore
    @Environment(\.colorScheme) private var scheme
    @State private var showTrackingNote = false

    var body: some View {
        let t = Theme(scheme: scheme)
        ZStack {
            t.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header(t)
                    card(t)
                }
                .padding(20)
            }
        }
    }

    private func header(_ t: Theme) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("등반").font(.system(size: 30, weight: .bold)).foregroundStyle(t.text)
            if let mtn = climb.mountainName, !mtn.isEmpty {
                Text("|").foregroundStyle(t.line)
                Text(mtn).font(.system(size: 16, weight: .medium)).foregroundStyle(t.muted)
            }
            Spacer()
        }
    }

    // MARK: 등반 카드
    @ViewBuilder
    private func card(_ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            if let c = climb.course {
                Text(c.title).font(.system(size: 18, weight: .bold)).foregroundStyle(t.text)

                statRow(t, [
                    (c.distance_km.map { String(format: "%.1f", $0) } ?? "–", "거리(km)"),
                    (c.time_hr.map { String(format: "%.1f", $0) } ?? "–", "예상(시간)"),
                ]) { difMeter(c.difficulty, t) }

                statRow(t, [
                    (c.max_elev.map { "\($0)" } ?? "–", "최고(m)"),
                    (c.ascent.map { "+\($0)" } ?? "–", "누적상승(m)"),
                    (c.min_elev.map { "\($0)" } ?? "–", "최저(m)"),
                ])

                if let p = c.profile, p.count > 1 {
                    Sparkline(points: p)
                        .stroke(t.text, style: StrokeStyle(lineWidth: 1.4, lineJoin: .round))
                        .frame(height: 64)
                        .padding(.vertical, 2)
                }

                Button { showTrackingNote = true } label: {
                    Text("등반 시작").font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(t.onAccent).frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(t.accent, in: RoundedRectangle(cornerRadius: 12))
                }
                if showTrackingNote {
                    Text("실시간 GPS 트래킹은 다음 단계(백그라운드 위치)에서 지원됩니다.")
                        .font(.footnote).foregroundStyle(t.muted)
                }
            } else {
                Text("선택된 코스가 없습니다").font(.system(size: 16, weight: .semibold)).foregroundStyle(t.text)
                Text("탐험 탭에서 등산로를 선택하면 여기에 표시됩니다.")
                    .font(.system(size: 13)).foregroundStyle(t.muted)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 16))
    }

    // 통계 행 — [(값, 라벨)] + 선택적 커스텀 셀(난이도 미터).
    private func statRow(_ t: Theme, _ items: [(String, String)],
                         @ViewBuilder trailing: () -> some View = { EmptyView() }) -> some View {
        HStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                statCell(it.0, it.1, t)
            }
            trailing()
                .frame(maxWidth: .infinity)
        }
    }

    private func statCell(_ v: String, _ label: String, _ t: Theme) -> some View {
        VStack(spacing: 4) {
            Text(v).font(.system(size: 19, weight: .bold)).foregroundStyle(t.text)
            Text(label).font(.system(size: 11)).foregroundStyle(t.muted)
        }
        .frame(maxWidth: .infinity)
    }

    // 난이도 3점 미터 (초급 1 · 중급 2 · 고급 3) — 웹 difMeter 대응.
    private func difMeter(_ diff: String?, _ t: Theme) -> some View {
        let level = ["초급": 1, "중급": 2, "고급": 3][diff ?? ""] ?? 0
        return VStack(spacing: 4) {
            HStack(spacing: 3) {
                ForEach(0..<3, id: \.self) { i in
                    Circle().fill(i < level ? t.text : t.line).frame(width: 7, height: 7)
                }
            }
            .frame(height: 23, alignment: .center)
            Text(diff ?? "난이도").font(.system(size: 11)).foregroundStyle(t.muted)
        }
    }
}
