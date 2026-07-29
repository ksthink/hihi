import SwiftUI
import UIKit   // UIPasteboard (탭 복사)

// 개발자 모드 HUD — 모든 탭 위에 뜨는 드래그 가능한 플로팅 패널. (DevMode/ — 삭제 대상)
// 접으면 작은 알약(⚙), 펼치면 배터리·계측·GPS·통신 4구획. 각 값을 탭하면 복사된다.
// 개발자 모드가 켜져 있으면 HUD 는 항상 표시(닫기 없음) — 끄기는 프로필 토글에서.
//
// 2026-07-29 재구성 — 배터리 계측기. 지도·콘솔·빌드 구획을 빼고 소모 측정에 필요한 값만 남겼다.
// 사용법: [리셋] 을 누르고 등반 → 10분 뒤부터 %/h 가 나온다. GPS 모드를 탭하면 정확도 등급이
//        바뀌고 계측이 자동 리셋되므로, 같은 코스에서 등급별 소모를 비교할 수 있다.
struct DevHUD: View {
    @ObservedObject var dev = DevStore.shared
    @Environment(\.colorScheme) private var scheme
    @State private var expanded = true
    @State private var offset = CGSize.zero
    @State private var drag = CGSize.zero
    @State private var copied: String?     // 방금 복사한 행 id (짧게 "복사됨 ✓" 표시)

    var body: some View {
        // 표시 여부를 여기서 판단 — ContentView 삽입점을 `.overlay { DevHUD() }` 한 줄로 유지.
        if dev.enabled && dev.hudVisible { panel }
    }

    private var panel: some View {
        let t = Theme(scheme: scheme)
        let pos = CGSize(width: offset.width + drag.width, height: offset.height + drag.height)
        return VStack(alignment: .leading, spacing: 0) {
            handle(t)
            if expanded {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        batterySection(t)
                        meterSection(t)
                        gpsSection(t)
                        netSection(t)
                    }
                    .padding(10)
                }
                .frame(maxHeight: 340)
            }
        }
        .frame(width: expanded ? 260 : 64)
        .background(t.elevated.opacity(0.96), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(t.line))
        .shadow(color: .black.opacity(0.25), radius: 10, y: 3)
        .offset(pos)
        .gesture(DragGesture().onChanged { drag = $0.translation }
            .onEnded { _ in offset = pos; drag = .zero })
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
        .transition(.opacity)
    }

    // 상단 손잡이 — 아이콘(드래그) + 접기/펴기. (닫기 없음: 개발자 모드가 켜지면 항상 표시)
    private func handle(_ t: Theme) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "gearshape.fill").font(.system(size: 11)).foregroundStyle(t.muted)
            Spacer()
            Button { expanded.toggle() } label: {
                Image(systemName: expanded ? "chevron.up" : "chevron.down")
                    .font(.system(size: 11, weight: .bold)).foregroundStyle(t.muted)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .contentShape(Rectangle())
    }

    // MARK: 구획

    private func batterySection(_ t: Theme) -> some View {
        section(t, "배터리") {
            if dev.batteryLevel < 0 {
                Text("미지원 — 실기기에서만 측정됨")
                    .font(.kakao(size: 11)).foregroundStyle(t.muted)
            } else {
                row(t, "잔량", String(format: "%.0f%% · %@", dev.batteryLevel * 100,
                                     dev.charging ? "충전 중" : "방전 중"))
            }
            row(t, "저전력", dev.lowPower ? "ON" : "OFF")
        }
    }

    // 계측 — 이 HUD 의 핵심. %/h 를 얻으려고 나머지 구획이 존재한다.
    private func meterSection(_ t: Theme) -> some View {
        section(t, "계측") {
            HStack {
                Spacer()
                Button("리셋") { dev.resetSession() }
                    .font(.kakao(size: 10)).foregroundStyle(t.muted)
            }
            row(t, "경과", fmtElapsed(dev.elapsed))
            row(t, "소모", dev.drainPercent.map { String(format: "%.0f%%", $0) }
                ?? (dev.charging ? "충전 중 — 측정 불가" : "—"))
            row(t, "시간당", dev.drainPerHour.map { String(format: "%.1f %%/h", $0) }
                ?? "10분 이상 필요")
        }
    }

    // GPS — 배터리 소모의 주범. 좌표보다 설정값·갱신 빈도가 중요하다.
    private func gpsSection(_ t: Theme) -> some View {
        section(t, "GPS · \(dev.authText)") {
            row(t, "신호", dev.accuracy < 0 ? "\(dev.signalMeter) 없음"
                : String(format: "%@ %@ · ±%.0fm", dev.signalMeter, dev.signalLabel, dev.accuracy))
            row(t, "고도", dev.vAccuracy < 0 ? "—"
                : String(format: "%.0fm · ±%.0fm", dev.altitude, dev.vAccuracy))
            // 탭하면 정확도 등급 순환(Best → 10m → 100m) + 계측 리셋 — 등급별 %/h 비교용.
            HStack(alignment: .top, spacing: 8) {
                Text("모드").font(.kakao(size: 11)).foregroundStyle(t.muted)
                    .frame(width: 48, alignment: .leading)
                Text("\(dev.accuracyMode)  ⟳ 탭=변경")
                    .font(.system(size: 11, design: .monospaced)).foregroundStyle(t.accent)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .contentShape(Rectangle())
            .onTapGesture { dev.cycleAccuracy() }
            row(t, "빈도", dev.fixPerMinute.map { String(format: "%d회 · %.1f/분", dev.fixCount, $0) }
                ?? "\(dev.fixCount)회")
            row(t, "최근", dev.sinceLastFix.map { fmtAgo($0) } ?? "수신 없음")
            if let c = dev.coord {
                row(t, "위치", String(format: "%.6f, %.6f", c.latitude, c.longitude))
            } else {
                Text("위치 없음 (시뮬: Features › Location)")
                    .font(.kakao(size: 11)).foregroundStyle(t.muted)
            }
        }
    }

    private func netSection(_ t: Theme) -> some View {
        section(t, "통신") {
            row(t, "상태", NetworkMonitor.shared.isOnline ? "온라인" : "오프라인")
            row(t, "설치 팩", "\(PackStore.shared.downloaded.count)개")
        }
    }

    // MARK: 조각
    private func section<C: View>(_ t: Theme, _ title: String, @ViewBuilder _ body: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.kakao(size: 10, weight: .bold))
                .foregroundStyle(t.muted).textCase(.uppercase)
            body()
        }
    }

    // 값 행 — 탭하면 값 복사(라벨은 행마다 유일해 복사 id 로 쓴다).
    private func row(_ t: Theme, _ k: String, _ v: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(k).font(.kakao(size: 11)).foregroundStyle(t.muted).frame(width: 48, alignment: .leading)
            Text(copied == k ? "복사됨 ✓" : v)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(copied == k ? t.accent : t.text)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .contentShape(Rectangle())
        .onTapGesture { copy(k, v) }
    }

    // 클립보드 복사 + 짧은 피드백(0.8s). reduced-motion 과 무관(텍스트 교체뿐).
    private func copy(_ id: String, _ value: String) {
        UIPasteboard.general.string = value
        copied = id
        Task {
            try? await Task.sleep(nanoseconds: 800_000_000)
            if copied == id { copied = nil }
        }
    }

    private func fmtElapsed(_ s: TimeInterval) -> String {
        let m = Int(s) / 60
        if m < 60 { return "\(m)분" }
        return "\(m / 60)시간 \(m % 60)분"
    }

    private func fmtAgo(_ s: TimeInterval) -> String {
        if s < 15 { return "방금" }
        if s < 60 { return "\(Int(s))초 전" }
        return "\(Int(s) / 60)분 전"
    }
}
