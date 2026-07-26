import SwiftUI
import CoreLocation
import UIKit

// 기록 루트 보기 전용 UI — 인터랙티브 고도 프로필 + GPX 내보내기.
// 구조·폰트는 앱 전반과 통일(.kakao / Theme / 카드 스타일). ExploreView 의 루트 모드에서 사용.

// 프로필 지점 — 좌표 + 고도 + 출발부터의 누적 거리(m). 그래프의 x=거리, y=고도.
struct RouteProfilePoint {
    let coord: [Double]   // [lng, lat]
    let ele: Double       // m
    let dist: Double      // 출발부터 누적 거리(m)
}

enum RouteProfile {
    // 고도값이 있는 지점만 골라 누적 거리와 함께 정렬(x=실제 거리라 등간격 index 보다 정확).
    static func build(_ record: ClimbRecord) -> [RouteProfilePoint] {
        let src = record.trackFull.compactMap { p -> (Double, Double, Double)? in
            guard let e = p.ele else { return nil }
            return (p.lng, p.lat, e)
        }
        guard src.count >= 2 else { return [] }
        var out: [RouteProfilePoint] = []
        var cum = 0.0
        var prev: CLLocation?
        for (lng, lat, e) in src {
            let loc = CLLocation(latitude: lat, longitude: lng)
            if let prev { cum += loc.distance(from: prev) }
            prev = loc
            out.append(RouteProfilePoint(coord: [lng, lat], ele: e, dist: cum))
        }
        return out
    }
}

// 고도 프로필 선/채움 — Sparkline 과 같은 결(채움 0.1 + 선)이되 x 를 누적 거리로 매핑.
private struct EleProfileShape: Shape {
    let profile: [RouteProfilePoint]
    var closed = false
    var pad: CGFloat = 4

    func path(in rect: CGRect) -> Path {
        var p = Path()
        guard profile.count > 1 else { return p }
        let total = max(profile.last!.dist, 1)
        let mn = profile.map(\.ele).min() ?? 0
        let mx = profile.map(\.ele).max() ?? 1
        let range = max(mx - mn, 1)
        let w = rect.width - 2 * pad, h = rect.height - 2 * pad
        func pt(_ i: Int) -> CGPoint {
            CGPoint(x: pad + w * CGFloat(profile[i].dist / total),
                    y: pad + h * (1 - CGFloat((profile[i].ele - mn) / range)))
        }
        p.move(to: pt(0))
        for i in 1..<profile.count { p.addLine(to: pt(i)) }
        if closed {
            p.addLine(to: CGPoint(x: rect.width - pad, y: rect.height - pad))
            p.addLine(to: CGPoint(x: pad, y: rect.height - pad))
            p.closeSubpath()
        }
        return p
    }
}

// 인터랙티브 고도 프로필 — 그래프를 누르거나 끌면 그 지점을 지도 루트 위에 마커로 표시.
// onSelect 에 선택 지점(없으면 nil)을 통지. 구조는 카드 안 요소로, 폰트는 .kakao 통일.
struct RouteElevationProfile: View {
    let profile: [RouteProfilePoint]
    let theme: Theme
    var onSelect: (RouteProfilePoint?) -> Void
    @State private var cursor: Int?          // 선택 지점 index (nil=없음)

    private let barH: CGFloat = 88
    private let pad: CGFloat = 4

    var body: some View {
        let t = theme
        VStack(alignment: .leading, spacing: 4) {
            // 상단 라벨 — 선택 시 "거리 · 고도", 아니면 최고/최저 고도 안내.
            HStack {
                if let i = cursor, profile.indices.contains(i) {
                    Text("\(distLabel(profile[i].dist)) · \(Int(profile[i].ele.rounded()))m")
                        .font(.kakao(size: 12, weight: .bold)).foregroundStyle(t.text)
                } else if let mx = profile.map(\.ele).max(), let mn = profile.map(\.ele).min() {
                    Text("고도 \(Int(mn.rounded()))–\(Int(mx.rounded()))m")
                        .font(.kakao(size: 12)).foregroundStyle(t.muted)
                }
                Spacer()
                Text("그래프를 눌러 지점 확인").font(.kakao(size: 10)).foregroundStyle(t.muted)
            }
            GeometryReader { geo in
                let W = geo.size.width
                ZStack(alignment: .topLeading) {
                    EleProfileShape(profile: profile, closed: true, pad: pad)
                        .fill(t.text.opacity(0.08))
                    EleProfileShape(profile: profile, pad: pad)
                        .stroke(t.text, style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
                    if let i = cursor, profile.indices.contains(i) {
                        let x = xFor(profile[i], width: W)
                        Rectangle().fill(t.accent.opacity(0.55)).frame(width: 1)
                            .frame(maxHeight: .infinity).position(x: x, y: barH / 2)
                        Circle().fill(t.accent).frame(width: 8, height: 8)
                            .overlay(Circle().strokeBorder(t.onAccent, lineWidth: 1.5))
                            .position(x: x, y: yFor(profile[i], height: barH))
                    }
                }
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { g in select(at: g.location.x, width: W) }
                )
            }
            .frame(height: barH)
        }
    }

    // 탭/드래그 x → 그 거리에 가장 가까운 지점 선택.
    private func select(at x: CGFloat, width: CGFloat) {
        guard profile.count > 1, width > 2 * pad else { return }
        let total = max(profile.last!.dist, 1)
        let frac = min(1, max(0, Double((x - pad) / (width - 2 * pad))))
        let target = frac * total
        var best = 0, bestD = Double.greatestFiniteMagnitude
        for (i, p) in profile.enumerated() {
            let d = abs(p.dist - target)
            if d < bestD { bestD = d; best = i }
        }
        if best != cursor {
            cursor = best
            onSelect(profile[best])
        }
    }

    private func xFor(_ p: RouteProfilePoint, width: CGFloat) -> CGFloat {
        let total = max(profile.last!.dist, 1)
        return pad + (width - 2 * pad) * CGFloat(p.dist / total)
    }
    private func yFor(_ p: RouteProfilePoint, height: CGFloat) -> CGFloat {
        let mn = profile.map(\.ele).min() ?? 0, mx = profile.map(\.ele).max() ?? 1
        let range = max(mx - mn, 1)
        return pad + (height - 2 * pad) * CGFloat(1 - (p.ele - mn) / range)
    }
    private func distLabel(_ m: Double) -> String {
        m >= 1000 ? String(format: "%.2fkm", m / 1000) : "\(Int(m.rounded()))m"
    }
}

// ── GPX 내보내기 ──────────────────────────────────────────────
// 저장된 트랙(고도·시각 포함)을 표준 GPX 1.1 로. 네이버/카카오 등 다른 앱에서 다시 열 수 있다.
enum RouteGPX {
    static func build(_ record: ClimbRecord, mountainName: String?, courseName: String?) -> String {
        let name = [mountainName, courseName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " | ")
        var s = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="HiHeight" xmlns="http://www.topografix.com/GPX/1/1">
         <trk>
          <name>\(xmlEscape(name.isEmpty ? "산행 기록" : name))</name>
          <trkseg>

        """
        for p in record.trackFull {
            s += "   <trkpt lat=\"\(fmt(p.lat))\" lon=\"\(fmt(p.lng))\">"
            if let e = p.ele { s += "<ele>\(fmt(e))</ele>" }
            if let ti = p.time { s += "<time>\(iso.string(from: Date(timeIntervalSince1970: ti)))</time>" }
            s += "</trkpt>\n"
        }
        s += "  </trkseg>\n </trk>\n</gpx>\n"
        return s
    }

    // "관악산_사당능선_20260720.gpx" — 파일 시스템에 안전한 이름.
    static func fileName(_ record: ClimbRecord, mountainName: String?, courseName: String?) -> String {
        var parts = [mountainName, courseName].compactMap { $0 }.filter { !$0.isEmpty }
        if let d = record.startedDate {
            let f = DateFormatter(); f.dateFormat = "yyyyMMdd"; parts.append(f.string(from: d))
        }
        let base = parts.joined(separator: "_")
        let safe = base.isEmpty ? "route" : base
        let cleaned = safe.components(separatedBy: CharacterSet(charactersIn: "/\\:*?\"<>|")).joined()
        return "\(cleaned).gpx"
    }

    // 임시 파일로 써서 URL 반환 — 공유 시트가 파일명을 보존하도록.
    static func writeTemp(_ record: ClimbRecord, mountainName: String?, courseName: String?) -> URL? {
        let text = build(record, mountainName: mountainName, courseName: courseName)
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(fileName(record, mountainName: mountainName, courseName: courseName))
        do { try text.data(using: .utf8)?.write(to: url); return url }
        catch { return nil }
    }

    private static func fmt(_ v: Double) -> String { String(format: "%.6f", v) }
    private static func xmlEscape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
         .replacingOccurrences(of: "<", with: "&lt;")
         .replacingOccurrences(of: ">", with: "&gt;")
    }
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f
    }()
}

// iOS 공유 시트 — 파일(GPX) 저장·에어드롭·메신저 공유. UIActivityViewController 브리지.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
