import SwiftUI
import UIKit   // UIPasteboard (탭 복사)

// 개발자 모드 HUD — 모든 탭 위에 뜨는 드래그 가능한 플로팅 패널. (DevMode/ — 삭제 대상)
// 접으면 작은 알약(⚙), 펼치면 지도·GPS·콘솔·빌드 4구획. 각 값을 탭하면 복사된다.
// 개발자 모드가 켜져 있으면 HUD 는 항상 표시(닫기 없음) — 끄기는 프로필 토글에서.
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
                        mapSection(t)
                        gpsSection(t)
                        logSection(t)
                        buildSection(t)
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
    private func mapSection(_ t: Theme) -> some View {
        section(t, "지도") {
            row(t, "중심", String(format: "%.5f, %.5f", dev.map.lat, dev.map.lng))
            row(t, "줌", String(format: "%.2f", dev.map.zoom))
            row(t, "방위", String(format: "%.0f°", dev.map.bearing))
            row(t, "기울기", String(format: "%.0f°", dev.map.pitch))
            row(t, "스타일", dev.map.style)
        }
    }

    private func gpsSection(_ t: Theme) -> some View {
        section(t, "GPS · \(dev.authText)") {
            if let c = dev.coord {
                row(t, "위치", String(format: "%.6f, %.6f", c.latitude, c.longitude))
                row(t, "정확도", dev.accuracy < 0 ? "—" : String(format: "±%.0fm", dev.accuracy))
                row(t, "고도", String(format: "%.0fm", dev.altitude))
            } else {
                Text("위치 없음 (시뮬: Features › Location)")
                    .font(.kakao(size: 11)).foregroundStyle(t.muted)
            }
        }
    }

    private func logSection(_ t: Theme) -> some View {
        section(t, "콘솔 · \(dev.logs.count)") {
            HStack {
                Spacer()
                Button("지우기") { dev.clearLogs() }
                    .font(.kakao(size: 10)).foregroundStyle(t.muted)
            }
            if dev.logs.isEmpty {
                Text("출력 없음").font(.kakao(size: 11)).foregroundStyle(t.muted)
            } else {
                // 최근 아래로 — 최신 40줄만(HUD 가벼움 유지). 줄을 탭하면 그 줄 복사.
                ForEach(Array(dev.logs.suffix(40).enumerated()), id: \.offset) { i, line in
                    let id = "log-\(i)"
                    Text(copied == id ? "복사됨 ✓" : line)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(copied == id ? t.accent : t.text)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        .onTapGesture { copy(id, line) }
                }
            }
        }
    }

    private func buildSection(_ t: Theme) -> some View {
        section(t, "빌드") {
            row(t, "버전", dev.appVersion)
            row(t, "커밋", dev.gitCommit)
            row(t, "네트워크", NetworkMonitor.shared.isOnline ? "온라인" : "오프라인")
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
}
