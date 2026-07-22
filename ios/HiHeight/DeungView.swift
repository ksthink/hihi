import SwiftUI

// 등반 탭 — 웹 #view-deung(climb-card) 재현.
// 코스 미선택 상태도 카드(제목 "선택된 코스가 없습니다" + stat "–" + 날씨 + 비활성 버튼)를 표시하고,
// 코스 선택 시 stat·프로파일·활성 버튼으로 채운다. 날씨는 선택된 산 기준(weather.js).
// 실시간 GPS 트래킹·HUD·기록 저장은 M5(CoreLocation/백그라운드 위치) 단계에서 구현한다.
struct DeungView: View {
    @ObservedObject var climb: ClimbStore
    @ObservedObject var auth: AuthStore
    @ObservedObject var catalog: CatalogStore
    var onStart: () -> Void = {}            // 등반 시작 → 지도(탐험) 탭으로 전환
    var onOpenMap: (Mountain) -> Void = { _ in }   // 저장된 지도 탭 → 해당 산 선택 후 탐험 탭
    @Environment(\.colorScheme) private var scheme
    @State private var loginHint = false
    @State private var weather: [WeatherHour] = []   // 선택된 산 시간대별 예보
    @StateObject private var packs = PackStore.shared    // 저장된 오프라인 지도 목록
    @State private var deletePackTarget: Mountain?       // 삭제 확인 대상
    @State private var showPackPrompt = false            // 팩 없이 등반 시작 시 저장 권유

    var body: some View {
        let t = Theme(scheme: scheme)
        VStack(spacing: 0) {
            header(t)                       // 상단 고정
            ScrollView {
                card(t).padding(20)
                savedMaps(t)
            }
        }
        .background(t.bg)
        // 팩 없이 등반 시작 → 저장 권유(앱 UI 팝업). 무시하면 온라인 모드로 진행한다.
        .overlay {
            if showPackPrompt, let m = catalog.selected {
                PackPromptView(
                    mountainName: m.name,
                    downloading: packs.downloadingCode == m.id,
                    progress: packs.progress,
                    status: packs.status,
                    onSave: {
                        Task {
                            if await packs.download(m.id) { await auth.saveDownloadedPack(m.id) }
                            showPackPrompt = false
                            beginClimb()               // 실패해도 진행 — 온라인 모드로 등반
                        }
                    },
                    onIgnore: { showPackPrompt = false; beginClimb() },
                    onCancel: { showPackPrompt = false })
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.18), value: showPackPrompt)
        .task(id: catalog.selected?.id) {   // 산 전환 시 예보 갱신
            weather = []
            guard let m = catalog.selected, m.center.count == 2 else { return }
            weather = await WeatherService.fetch(lat: m.center[1], lon: m.center[0])
        }
    }

    // 고정 헤더 — 웹 view-head "등반 | [산 배지]" + 부제
    private func header(_ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text("등반").font(.kakao(size: 26, weight: .bold)).foregroundStyle(t.text)   // 산이름 배지 제거(코스 카드로 이동)
                Spacer(minLength: 0)
            }
            Text("코스를 골라 산행을 시작하세요").font(.kakao(size: 13)).foregroundStyle(t.muted)
        }
        .padding(.horizontal, 20).padding(.top, 6).padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.bg)
        .overlay(alignment: .bottom) { Rectangle().fill(t.line).frame(height: 0.5) }
    }

    // MARK: 등반 카드 (웹 climb-card — text-align center)
    private func card(_ t: Theme) -> some View {
        let c = climb.course
        return VStack(spacing: 14) {
            // 제목 — 산이름(볼드) | 코스명. 코스 없으면 안내.
            Group {
                if let c {
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        if let mtn = climb.mountainName, !mtn.isEmpty {
                            Text(mtn).font(.kakao(size: 15, weight: .bold)).foregroundStyle(t.text)
                            Text("|").font(.kakao(size: 15)).foregroundStyle(t.muted)
                        }
                        Text(c.name).font(.kakao(size: 15, weight: .semibold)).foregroundStyle(t.text)
                    }
                    .lineLimit(1)
                } else {
                    Text("선택된 코스가 없습니다").font(.kakao(size: 15, weight: .bold)).foregroundStyle(t.text)
                }
            }
            .frame(maxWidth: .infinity)

            // 통계 2행 (거리/예상/난이도 · 최고/누적상승/최저) — 미선택 시 "–"
            VStack(spacing: 8) {
                HStack(spacing: 0) {
                    statCell("거리(km)", t) { statValue(c?.distance_km.map(fmtNum), t) }
                    statCell("예상(시간)", t) { statValue(c?.time_hr.map(fmtNum), t) }
                    statCell("난이도", t) {
                        if let c { difMeter(c.difLevel, t) } else { statValue(nil, t) }
                    }
                }
                HStack(spacing: 0) {
                    statCell("최고(m)", t) { statValue(c?.max_elev.map { "\($0)" }, t) }
                    statCell("누적상승(m)", t) { statValue(c?.ascent.map { "+\($0)" }, t) }
                    statCell("최저(m)", t) { statValue(c?.min_elev.map { "\($0)" }, t) }
                }
            }

            if let p = c?.profile, p.count > 1 {
                ProfileView(points: p, color: t.text).frame(height: 46).padding(.vertical, 2)
            }

            if !weather.isEmpty {
                WeatherStrip(hours: weather)
            }

            Button {
                guard climb.course != nil else { return }
                if auth.email == nil { loginHint = true; return }   // 저장하려면 로그인 필요(웹 동일)
                loginHint = false
                // 등반 중에는 저장된 지도만 쓴다(신호 끊김·배터리). 팩이 없으면 저장을 권하고,
                // 무시하면 온라인 모드로 진행한다.
                if let m = catalog.selected, !packs.downloaded.contains(m.id) {
                    showPackPrompt = true; return
                }
                beginClimb()
            } label: {
                Text("등반 시작").font(.kakao(size: 15, weight: .bold))
                    .foregroundStyle(c == nil ? t.muted : t.onAccent)
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background(c == nil ? t.line : t.accent, in: RoundedRectangle(cornerRadius: 12))
            }
            .disabled(c == nil)

            if let hint = hintText(c) {
                Text(hint).font(.kakao(size: 11)).foregroundStyle(t.muted)
                    .lineLimit(1).frame(maxWidth: .infinity)
            }
            if loginHint {
                Text("등반 기록을 저장하려면 기록 탭에서 로그인하세요.")
                    .font(.kakao(size: 11)).foregroundStyle(t.muted).frame(maxWidth: .infinity)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(t.elevated, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(t.line))
    }

    // 저장된 지도 — 다운로드된 오프라인 팩 목록(웹 renderSavedMaps). 탭=탐험에서 열기, 휴지통=삭제.
    @ViewBuilder private func savedMaps(_ t: Theme) -> some View {
        let saved = catalog.mountains.filter { packs.downloaded.contains($0.id) }
        if !saved.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("저장된 지도").font(.kakao(size: 17, weight: .semibold)).foregroundStyle(t.text)
                // 기록 탭과 동일한 커스텀 스와이프 삭제(카드가 삭제 버튼 위로 미끄러짐).
                ForEach(saved) { m in
                    SwipeToDeleteRow(corner: 12, onDelete: { deletePackTarget = m }) {
                        HStack(spacing: 12) {
                            Image(systemName: "map").font(.system(size: 15)).foregroundStyle(t.muted)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(m.name).font(.kakao(size: 14, weight: .semibold)).foregroundStyle(t.text)
                                Text("오프라인 사용 가능").font(.kakao(size: 11)).foregroundStyle(t.muted)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(t.elevated, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(t.line))
                        .contentShape(Rectangle())
                        .onTapGesture { onOpenMap(m) }
                    }
                }
            }
            .padding(.horizontal, 20).padding(.bottom, 20)
            .confirmationDialog("오프라인 지도 삭제", isPresented: Binding(
                get: { deletePackTarget != nil }, set: { if !$0 { deletePackTarget = nil } }),
                titleVisibility: .visible, presenting: deletePackTarget) { m in
                Button("삭제", role: .destructive) { packs.delete(m.id); Task { await auth.removeSavedPack(m.id) } }
            } message: { m in Text("\(m.name)의 저장된 지도를 삭제합니다.") }
        }
    }

    // 등반 시작 — 세션 시작 + 탐험 탭으로 전환. 팩 저장 여부와 무관하게 여기 한 곳으로 모은다.
    private func beginClimb() {
        climb.start()
        onStart()
    }

    // 통계 셀 — 값(15 bold 또는 난이도 미터) + 라벨(10 muted). 웹 climb-stats > div.
    private func statCell<V: View>(_ label: String, _ t: Theme, @ViewBuilder value: () -> V) -> some View {
        VStack(spacing: 2) {
            value().frame(height: 20)
            Text(label).font(.kakao(size: 10)).foregroundStyle(t.muted)
        }
        .frame(maxWidth: .infinity)
    }

    private func statValue(_ s: String?, _ t: Theme) -> some View {
        Text(s ?? "–").font(.kakao(size: 15, weight: .bold)).foregroundStyle(t.text)
    }

    // 난이도 3막대 미터 — 웹 .dmeter (5×11, 채움=text·비움=line).
    private func difMeter(_ level: Int, _ t: Theme) -> some View {
        HStack(spacing: 2) {
            ForEach(1...3, id: \.self) { i in
                RoundedRectangle(cornerRadius: 1).fill(i <= level ? t.text : t.line)
                    .frame(width: 5, height: 11)
            }
        }
    }

    // 카드 하단 힌트 — 코스 없으면 안내, 있으면 봉우리·노면(없으면 nil→숨김). 웹 climb-hint.
    private func hintText(_ c: Course?) -> String? {
        guard let c else { return "탐험 탭에서 등산로를 선택하면 여기에 표시됩니다." }
        let bits = [c.peak, c.surface.map { "노면 \($0)" }].compactMap { $0 }.filter { !$0.isEmpty }
        let s = bits.joined(separator: " · ")
        if !s.isEmpty { return s }
        let d = (c.desc ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return d.isEmpty ? nil : d
    }

    // JS number 표기 재현 — 후행 0 제거("17.65", "4.9", "3").
    private func fmtNum(_ d: Double) -> String { String(format: "%g", d) }
}
