import SwiftUI
import CoreLocation

// 등반 내비 — 지도 없이 방향·거리·고도만 보는 전체화면(찾기 앱 정밀 탐색 UI 를 등산용으로).
// 지도 렌더(MapLibre GPU·타일 디코딩)를 끄는 것이 목적이라, 이 화면은 지도를 띄우지 않는다.
//
// ⚠️ 지도를 안 보게 만드는 순간 이탈 감지 책임이 앱으로 넘어온다. 그래서
//    ① 코스 이탈을 눈에 띄게 경고하고 ② 지도로 한 번에 돌아가는 버튼을 항상 둔다
//    ③ 나침반이 못 미더우면(자력계 간섭) 화살표를 흐리게 하고 그 사실을 적는다.
//    — 틀린 방향을 자신 있게 가리키는 것은 방향을 안 보여주는 것보다 위험하다.
struct NavView: View {
    @ObservedObject var climb: ClimbStore
    var mountainCode: String?
    var onMap: () -> Void            // 지도로 전환
    var onClose: () -> Void

    @Environment(\.colorScheme) private var scheme
    @StateObject private var packs = PackStore.shared

    @State private var line: [[Double]] = []      // 선택 코스 좌표(진행 순서)
    // 진행 방향 — 위치가 아니라 **움직임**으로 판정하고 지속·히스테리시스로 뒤집는다.
    // 예전엔 진입 시 1회 근접 판정이라 코스 중간점 이후 진입하면 하산으로 오판했다(ISSUE #4).
    @State private var director = NavDirector()
    @State private var fix: NavFix?
    private var forward: Bool { director.forward }
    @State private var angle: Double = 0          // 화살표 누적 각도 — 최단 경로로만 돌린다
    @State private var north: Double = 0          // 방위 고리 누적 각도 — 같은 이유로 누적
    @State private var loading = true

    // 나침반이 못 미더운 상태(무효거나 오차 30° 초과). 화살표를 흐리게 하고 안내를 띄운다.
    private var headingBad: Bool {
        climb.headingAccuracy < 0 || climb.headingAccuracy > 30
    }
    private var offRoute: Bool { (fix?.offRouteM ?? 0) > 30 }

    var body: some View {
        let t = Theme(scheme: scheme)
        VStack(spacing: 0) {
            header(t)
            Spacer(minLength: 0)
            arrow(t)
            Spacer(minLength: 0)
            readout(t)
            controls(t)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(t.bg.ignoresSafeArea())
        .task {
            // 코스 좌표는 저장된 팩 우선 — 오프라인에서도 내비가 되어야 한다.
            guard let code = mountainCode ?? climb.mountainCode, let name = climb.course?.name else {
                loading = false; return
            }
            let l = await PackLoader.courseLine(code, name: name,
                                                localURL: packs.localFile(code, "routes.geojson"))
            line = l
            // 진행 중 트랙을 함께 넘긴다 — 중간 진입이어도 걸어온 궤적으로 방향이 즉시 잡힌다.
            if let c = climb.currentCoord {
                director = NavDirector(line: l, at: c, track: climb.track)
            }
            loading = false
            recompute()
            climb.startHeading()
        }
        .onDisappear { climb.stopHeading() }
        .onChange(of: climb.currentCoord?.latitude) { _, _ in
            if let c = climb.currentCoord, !line.isEmpty {
                _ = director.update(line: line, at: c)   // 방향 전환은 내부 히스테리시스가 판단
            }
            recompute()
        }
        .onChange(of: fix?.bearing) { _, _ in turnArrow() }
        .onChange(of: climb.heading) { _, _ in turnArrow(); turnRing() }
    }

    // MARK: 계산
    private func recompute() {
        guard !line.isEmpty, let c = climb.currentCoord else { return }
        fix = CourseNav.fix(line: line, at: c, reverse: !forward)
    }

    // 화살표는 "목표 방위 − 기기 방향". 헤딩이 없으면 화면 위쪽을 진북으로 삼는다.
    private var relative: Double {
        guard let f = fix else { return 0 }
        let h = climb.heading >= 0 ? climb.heading : 0
        return (f.bearing - h + 360).truncatingRemainder(dividingBy: 360)
    }

    /// 화면 위 = 기기가 보는 쪽이므로, 진북은 화면에서 헤딩만큼 **반대로** 돈 자리에 있다.
    /// 헤딩이 없으면 0 을 쓴다 — relative 와 같은 가정이라 화살표와 고리가 어긋나지 않는다.
    private var northTarget: Double {
        let h = climb.heading >= 0 ? climb.heading : 0
        return (-h).truncatingRemainder(dividingBy: 360)
    }

    private func turnRing() {
        var d = (northTarget - north).truncatingRemainder(dividingBy: 360)
        if d > 180 { d -= 360 } else if d < -180 { d += 360 }
        withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) { north += d }
    }

    // 350° → 10° 를 340° 역회전으로 돌지 않게 누적 각도에 최단 델타만 더한다.
    private func turnArrow() {
        var d = (relative - angle).truncatingRemainder(dividingBy: 360)
        if d > 180 { d -= 360 } else if d < -180 { d += 360 }
        withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) { angle += d }
    }

    // MARK: 조각
    // 등반/하산 라벨은 **탭하면 뒤집힌다** — 자동 판정이 틀려도 사용자가 즉시 교정할 수 있는
    // 안전판(ISSUE #4 수정 3안). 한 번 지정하면 자동 전환은 멈춘다(자물쇠 표시).
    private func header(_ t: Theme) -> some View {
        VStack(spacing: 2) {
            HStack(spacing: 4) {
                Text(forward ? "등반" : "하산").font(.kakao(size: 11)).foregroundStyle(t.muted)
                Image(systemName: director.locked ? "lock.fill" : "arrow.triangle.2.circlepath")
                    .font(.system(size: 9)).foregroundStyle(t.muted).opacity(0.7)
            }
            .padding(.horizontal, 10).padding(.vertical, 3)
            .contentShape(Capsule())
            .overlay(Capsule().strokeBorder(t.line))
            .onTapGesture {
                director.setManual(!forward)
                recompute()
            }
            .accessibilityLabel(forward ? "등반 방향 — 탭하면 하산으로" : "하산 방향 — 탭하면 등반으로")

            Text(climb.course?.name ?? "코스 없음")
                .font(.kakao(size: 17, weight: .bold)).foregroundStyle(t.text)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }

    @ViewBuilder private func arrow(_ t: Theme) -> some View {
        VStack(spacing: 18) {
            ZStack {
                // 방위 고리 — 화살표는 "목표 방위 − 기기 방향"이라 **화면 위가 내가 보는 쪽**이다.
                // 그래서 북쪽이 어디인지 알 수 없어진다. 고리가 그걸 되돌려 준다(늘 진북).
                CompassRose(text: t.text, line: t.line, muted: t.muted, spin: north)
                    .frame(width: 268, height: 268)
                    .rotationEffect(.degrees(north))
                    .opacity(headingBad ? 0.28 : 1)
                    .accessibilityHidden(true)

                Image(systemName: "arrow.up")
                    .font(.system(size: 132, weight: .heavy))
                    .foregroundStyle(t.text)
                    .opacity(headingBad ? 0.28 : 1)
                    .rotationEffect(.degrees(angle))
                    .accessibilityLabel("진행 방향")
            }

            // 신뢰도·이탈은 화살표 바로 아래에서 말한다 — 화면 구석에 두면 못 본다.
            if loading {
                Text("코스 불러오는 중…").font(.kakao(size: 12)).foregroundStyle(t.muted)
            } else if line.isEmpty {
                Text("코스 좌표가 없어 방향을 안내할 수 없습니다")
                    .font(.kakao(size: 12)).foregroundStyle(t.muted)
            } else if climb.currentCoord == nil {
                Text("위치 수신 대기 중").font(.kakao(size: 12)).foregroundStyle(t.muted)
            } else if headingBad {
                Text("나침반 부정확 — 기기를 8자로 흔들어 보정하세요")
                    .font(.kakao(size: 12)).foregroundStyle(t.muted)
                    .multilineTextAlignment(.center)
            } else if offRoute, let f = fix {
                Text("코스에서 \(Int(f.offRouteM))m 벗어남")
                    .font(.kakao(size: 13, weight: .bold)).foregroundStyle(t.text)
                    .padding(.horizontal, 12).padding(.vertical, 5)
                    .background(t.elevated, in: Capsule())
                    .overlay(Capsule().strokeBorder(t.text))
            } else if let f = fix, f.nearEnd {
                Text("도착 지점 부근").font(.kakao(size: 13, weight: .semibold)).foregroundStyle(t.text)
            }
        }
    }

    // 남은 거리·고도는 크게, 좌표·국가지점번호는 작게.
    private func readout(_ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(remainText).font(.kakao(size: 46, weight: .bold).monospacedDigit())
                    .foregroundStyle(t.text)
                Text("남음").font(.kakao(size: 15)).foregroundStyle(t.muted)
            }
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(altText).font(.kakao(size: 30, weight: .bold).monospacedDigit())
                    .foregroundStyle(t.text)
                Text("고도").font(.kakao(size: 13)).foregroundStyle(t.muted)
            }
            .padding(.top, 2)

            Text(coordText).font(.system(size: 11, design: .monospaced)).foregroundStyle(t.muted)
                .padding(.top, 10)
            Text(npnText).font(.system(size: 11, design: .monospaced)).foregroundStyle(t.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 28)
    }

    private func controls(_ t: Theme) -> some View {
        HStack {
            circleButton("xmark", t, action: onClose)
            Spacer()
            // 이탈 중에는 지도 버튼을 채워 강조한다 — 복귀 판단은 지도가 정확하다.
            circleButton("map", t, filled: offRoute, action: onMap)
        }
        .padding(.horizontal, 28).padding(.top, 18).padding(.bottom, 8)
        .safeAreaPadding(.bottom)
    }

    private func circleButton(_ icon: String, _ t: Theme, filled: Bool = false,
                              action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(filled ? t.bg : t.text)
                .frame(width: 52, height: 52)
                .background(filled ? t.text : t.elevated, in: Circle())
                .overlay(Circle().strokeBorder(t.line))
        }
        .buttonStyle(.plain)
    }

    // MARK: 표기
    private var remainText: String {
        guard let f = fix else { return "–" }
        return f.remainM >= 1000 ? String(format: "%.2f km", f.remainM / 1000)
                                 : "\(Int(f.remainM.rounded())) m"
    }
    private var altText: String {
        climb.currentAltitude >= 0 ? "\(Int(climb.currentAltitude.rounded())) m" : "–"
    }
    private var coordText: String {
        guard let c = climb.currentCoord else { return "위치 없음" }
        return String(format: "%.6f, %.6f", c.latitude, c.longitude)
    }
    private var npnText: String {
        guard let c = climb.currentCoord,
              let code = NPN.code(lat: c.latitude, lon: c.longitude) else { return "국가지점번호 –" }
        return code
    }
}

// 내비 화면 방위 고리 — 화살표를 감싸는 원과 눈금·방위 글자.
//
// 고리는 통째로 `-헤딩` 만큼 돌아(NavView.north) 「북」이 늘 진북에 놓인다.
// ⚠️ 다만 **글자는 같이 돌리지 않는다.** 한글은 눕히면 읽히지 않는다 —
//    처음엔 눈금판째 돌렸더니 아래쪽 「남」이 뒤집혀 알아볼 수 없었다(2026-08-27 실기).
//    그래서 각 글자를 `spin` 만큼 되돌려 화면에서 똑바로 세운다. 자리만 돌고 글자는 서 있다.
private struct CompassRose: View {
    let text: Color
    let line: Color
    let muted: Color
    let spin: Double                       // 고리 전체 회전각 — 글자를 되돌리는 데 쓴다

    private static let cardinals = [(0.0, "북"), (90.0, "동"), (180.0, "남"), (270.0, "서")]

    var body: some View {
        GeometryReader { g in
            let r = min(g.size.width, g.size.height) / 2
            ZStack {
                Circle().strokeBorder(line, lineWidth: 1.2)

                // 눈금 30° 간격 — 네 방위는 길고 굵게, 나머지는 짧게.
                ForEach(0..<12, id: \.self) { i in
                    let major = i % 3 == 0
                    Capsule()
                        .fill(major ? text.opacity(0.5) : line)
                        .frame(width: major ? 2 : 1, height: major ? 11 : 6)
                        .offset(y: -(r - (major ? 7.5 : 5)))
                        .rotationEffect(.degrees(Double(i) * 30))
                }

                // 북 표식 — 글자만으로는 한눈에 안 잡혀 고리에 뾰족한 표를 하나 더 둔다.
                NorthPip()
                    .fill(text)
                    .frame(width: 11, height: 8)
                    .offset(y: -(r + 5))

                // 방위 글자 — 「북」만 진하게. 안쪽 회전이 바깥 회전을 상쇄해 늘 똑바로 선다.
                ForEach(Self.cardinals, id: \.1) { deg, name in
                    let isNorth = deg == 0
                    Text(name)
                        .font(.kakao(size: isNorth ? 15 : 12, weight: isNorth ? .bold : .regular))
                        .foregroundStyle(isNorth ? text : muted)
                        .rotationEffect(.degrees(-(deg + spin)))
                        .frame(width: 26, height: 26)
                        .offset(y: -(r - 31))
                        .rotationEffect(.degrees(deg))
                }
            }
            .position(x: g.size.width / 2, y: g.size.height / 2)
        }
    }

    // 고리 밖으로 나온 북쪽 삼각 표식.
    private struct NorthPip: Shape {
        func path(in r: CGRect) -> Path {
            var p = Path()
            p.move(to: CGPoint(x: r.midX, y: r.minY))
            p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
            p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
            p.closeSubpath()
            return p
        }
    }
}
