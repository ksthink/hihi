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

// ── 겹침 계산 — 걸었던 루트 중 정규 코스 선과 가까운(≤threshold m) 연속 구간. ──
// MapLibre 는 선끼리의 픽셀 교차 블렌딩이 없어, 겹침 구간을 직접 계산해
// 반전 점선 레이어(rec-track-inv)로 정규 코스 위에 얹는다(코스와 걸은 길 비교용).
enum RouteOverlap {
    // track: 걸은 지점들 [lng,lat,...], lines: 코스 선들의 좌표. 반환: 겹침 구간(MultiLineString parts).
    static func compute(track: [[Double]], lines: [[[Double]]], thresholdM: Double = 25) -> [[[Double]]] {
        guard track.count >= 2, !lines.isEmpty else { return [] }
        // 소지역 평면 근사(등장방형) — 산 하나 범위에선 충분히 정확.
        let lat0 = track[track.count / 2][1] * .pi / 180
        let mLon = 111_320 * cos(lat0), mLat = 110_540.0
        func xy(_ p: [Double]) -> (x: Double, y: Double) { (p[0] * mLon, p[1] * mLat) }
        // 코스 세그먼트를 threshold 격자에 색인 — 트랙 지점마다 근처 세그먼트만 검사(O(N)).
        struct Seg { let ax, ay, bx, by: Double }
        let cell = thresholdM
        var grid: [Int64: [Seg]] = [:]
        func key(_ cx: Int, _ cy: Int) -> Int64 { (Int64(cx) << 32) | Int64(UInt32(bitPattern: Int32(cy))) }
        for line in lines {
            guard line.count >= 2 else { continue }
            for i in 1..<line.count {
                guard line[i - 1].count >= 2, line[i].count >= 2 else { continue }
                let a = xy(line[i - 1]), b = xy(line[i])
                let seg = Seg(ax: a.x, ay: a.y, bx: b.x, by: b.y)
                let x0 = Int(floor((min(a.x, b.x) - cell) / cell)), x1 = Int(floor((max(a.x, b.x) + cell) / cell))
                let y0 = Int(floor((min(a.y, b.y) - cell) / cell)), y1 = Int(floor((max(a.y, b.y) + cell) / cell))
                for cx in x0...x1 { for cy in y0...y1 { grid[key(cx, cy), default: []].append(seg) } }
            }
        }
        // 지점→가장 가까운 세그먼트 거리 ≤ threshold 판정.
        func near(_ p: [Double]) -> Bool {
            let q = xy(p)
            guard let segs = grid[key(Int(floor(q.x / cell)), Int(floor(q.y / cell)))] else { return false }
            for s in segs {
                let dx = s.bx - s.ax, dy = s.by - s.ay
                let l2 = dx * dx + dy * dy
                var t = l2 > 0 ? ((q.x - s.ax) * dx + (q.y - s.ay) * dy) / l2 : 0
                t = min(1, max(0, t))
                let ex = q.x - (s.ax + t * dx), ey = q.y - (s.ay + t * dy)
                if ex * ex + ey * ey <= thresholdM * thresholdM { return true }
            }
            return false
        }
        let hits = track.map(near)
        // 연속 근접 지점을 구간으로 — 1지점 끊김은 GPS 요동으로 보고 이어붙인다.
        var parts: [[[Double]]] = []
        var cur: [[Double]] = []
        for (i, p) in track.enumerated() {
            let hit = hits[i] || (i > 0 && i + 1 < track.count && hits[i - 1] && hits[i + 1])
            if hit {
                cur.append([p[0], p[1]])
            } else {
                if cur.count >= 2 { parts.append(cur) }
                cur = []
            }
        }
        if cur.count >= 2 { parts.append(cur) }
        return parts
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

    // "ksthink_900000001_20260726.gpx" — 사용자아이디_산코드_걸은날짜. 파일 시스템에 안전한 이름.
    static func fileName(_ record: ClimbRecord, userID: String?) -> String {
        var parts: [String] = []
        if let u = userID, !u.isEmpty { parts.append(u) }
        if let c = record.mountain_id, !c.isEmpty { parts.append(c) }
        if let d = record.startedDate {
            let f = DateFormatter(); f.dateFormat = "yyyyMMdd"; parts.append(f.string(from: d))
        }
        let base = parts.isEmpty ? "route" : parts.joined(separator: "_")
        let cleaned = base.components(separatedBy: CharacterSet(charactersIn: "/\\:*?\"<>| ")).joined()
        return "\(cleaned).gpx"
    }

    // 임시 파일로 써서 URL 반환 — 공유 시트가 파일명을 보존하도록.
    static func writeTemp(_ record: ClimbRecord, mountainName: String?, courseName: String?, userID: String?) -> URL? {
        let text = build(record, mountainName: mountainName, courseName: courseName)
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(fileName(record, userID: userID))
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

// 공유할 GPX 파일 — .sheet(item:) 트리거용.
// ⚠️ isPresented+별도 URL 상태 조합은 시트 내용이 이전 상태(nil)로 평가돼 빈 시트가 뜰 수 있다
//    (build 230에서 "다운로드가 안 됨"으로 재현). item 기반이면 값이 준비된 뒤에만 시트가 뜬다.
struct GPXFile: Identifiable {
    let url: URL
    var id: String { url.path }
}

// iOS 공유 시트 — 파일(GPX) 저장·에어드롭·메신저 공유. UIActivityViewController 브리지.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
