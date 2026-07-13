import SwiftUI

// 기록 탭 — 계정 + climb_records 합계·목록. 트랙 있는 기록은 탭하면 지도에 루트 표시,
// 왼쪽 스와이프로 삭제(List.swipeActions — 웹의 수동 포인터 스와이프를 네이티브로 대체).
struct RecordsView: View {
    @ObservedObject var auth: AuthStore
    @ObservedObject var catalog: CatalogStore
    var onShowRoute: (ClimbRecord) -> Void = { _ in }
    @Environment(\.colorScheme) private var scheme
    @State private var email = ""
    @State private var pass = ""
    @State private var pendingDelete: ClimbRecord?

    var body: some View {
        let t = Theme(scheme: scheme)
        VStack(spacing: 0) {
            ScreenHeader(title: "기록", subtitle: "나의 산행 이력")   // 상단 고정
            if auth.email == nil {
                ScrollView { authForm(t).padding(20) }
            } else {
                authedList(t)
            }
        }
        .background(t.bg)
        .task { await auth.refresh() }
        .confirmationDialog("이 기록을 삭제할까요? 되돌릴 수 없습니다.",
                            isPresented: Binding(get: { pendingDelete != nil },
                                                 set: { if !$0 { pendingDelete = nil } }),
                            titleVisibility: .visible) {
            Button("삭제", role: .destructive) {
                if let r = pendingDelete { Task { await auth.deleteRecord(r.id) } }
                pendingDelete = nil
            }
            Button("취소", role: .cancel) { pendingDelete = nil }
        }
    }

    // MARK: 로그인됨 — 합계 + 목록
    // List(UICollectionView) self-sizing 재귀 레이아웃 루프 회피를 위해 ScrollView+LazyVStack 사용.
    // 스와이프 삭제는 웹 .ri-del 처럼 커스텀 드래그로 구현(RecordCardRow).
    private func authedList(_ t: Theme) -> some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                authBar(t)                            // 웹 .auth-in — elevated 카드(이메일 + 로그아웃 알약)
                summary(t)
                RecCalendar(dayKeys: recordDayKeys)   // 산행 달력 — 기록 있는 날 점 표시
                if auth.records.isEmpty {
                    Text("아직 등반 기록이 없습니다.").font(.kakao(size: 13)).foregroundStyle(t.muted)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 4)
                } else {
                    ForEach(auth.records) { r in       // rec-list gap 10
                        RecordCardRow(theme: t,
                                      onTap: { if r.hasTrack { onShowRoute(r) } },
                                      onDelete: { pendingDelete = r }) {
                            recordRow(r, t)
                        }
                    }
                }
            }
            .padding(.horizontal, 20).padding(.top, 6).padding(.bottom, 24)
        }
        .background(t.bg)
    }

    // MARK: 비로그인 — 이메일 인증
    private func authForm(_ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("로그인하고 등반 기록을 저장하세요.").font(.kakao(size: 14)).foregroundStyle(t.muted)
            TextField("이메일", text: $email)
                .textContentType(.emailAddress).keyboardType(.emailAddress)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .padding(12).background(t.surface, in: RoundedRectangle(cornerRadius: 10))
            SecureField("비밀번호", text: $pass)
                .padding(12).background(t.surface, in: RoundedRectangle(cornerRadius: 10))
            HStack(spacing: 10) {
                Button { Task { await auth.signIn(email, pass) } } label: {
                    Text("로그인").font(.kakao(size: 15, weight: .semibold))
                        .foregroundStyle(t.onAccent).frame(maxWidth: .infinity).padding(.vertical, 11)
                        .background(t.accent, in: RoundedRectangle(cornerRadius: 10))
                }
                Button { Task { await auth.signUp(email, pass) } } label: {
                    Text("가입").font(.kakao(size: 15, weight: .semibold))
                        .foregroundStyle(t.text).frame(maxWidth: .infinity).padding(.vertical, 11)
                        .background(t.surface, in: RoundedRectangle(cornerRadius: 10))
                }
            }
            .disabled(auth.busy)
            if let msg = auth.message {
                Text(msg).font(.kakao(size: 13)).foregroundStyle(t.muted)
            }
        }
    }

    // 웹 .auth-in — elevated 카드: 이메일(14 bold) + 로그아웃 알약(테두리·surface)
    private func authBar(_ t: Theme) -> some View {
        HStack(spacing: 12) {
            Text(auth.email ?? "").font(.kakao(size: 14, weight: .bold)).foregroundStyle(t.text)
                .lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 8)
            Button { Task { await auth.signOut() } } label: {
                Text("로그아웃").font(.kakao(size: 14, weight: .bold)).foregroundStyle(t.text)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(t.surface, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(t.line))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(t.elevated, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(t.line))
    }

    // 웹 .rec-summary — elevated 카드(border), 값 22 bold + 라벨 11 muted
    private func summary(_ t: Theme) -> some View {
        HStack(spacing: 0) {
            stat("\(auth.totalCount)", "총 산행", t)
            stat(String(format: "%.1f", auth.totalKm), "총 거리(km)", t)
            stat("\(auth.totalAscent)", "누적 고도(m)", t)
        }
        .padding(.vertical, 18)
        .background(t.elevated, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(t.line))
    }

    private func stat(_ v: String, _ label: String, _ t: Theme) -> some View {
        VStack(spacing: 3) {
            Text(v).font(.kakao(size: 22, weight: .bold)).foregroundStyle(t.text)
            Text(label).font(.kakao(size: 11)).foregroundStyle(t.muted)
        }
        .frame(maxWidth: .infinity)
    }

    // 웹 .rec-item ri-body 내용 — ri-top(이름 | 날짜) + ri-meta(거리·시간·↑고도·루트).
    // 카드 배경·테두리·스와이프는 RecordCardRow 가 담당.
    private func recordRow(_ r: ClimbRecord, _ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {          // ri-top
                Text(title(r)).font(.kakao(size: 15, weight: .bold)).foregroundStyle(t.text)
                    .lineLimit(1).truncationMode(.tail)
                Spacer(minLength: 8)
                if let dt = r.startedDate {
                    Text(dateLabel(dt)).font(.kakao(size: 12)).foregroundStyle(t.muted)
                }
            }
            HStack(spacing: 12) {                            // ri-meta
                Text("\(kmLabel(r.distance_km)) km")
                Text(durationLabel(r.duration_s))
                if r.hasTrack, let a = r.ascent_m { Text("↑\(a)m") }
                if r.hasTrack {
                    Spacer(minLength: 8)
                    Text("루트 ›").font(.kakao(size: 12, weight: .semibold)).foregroundStyle(t.text)
                }
            }
            .font(.kakao(size: 12)).foregroundStyle(t.muted)
        }
    }

    // 기록 있는 날짜 키 집합 "y-m-d"(로컬) — 달력 점 표시용.
    private var recordDayKeys: Set<String> {
        let cal = Calendar.current
        return Set(auth.records.compactMap { r -> String? in
            guard let d = r.startedDate else { return nil }
            let c = cal.dateComponents([.year, .month, .day], from: d)
            return "\(c.year!)-\(c.month!)-\(c.day!)"
        })
    }

    private func title(_ r: ClimbRecord) -> String {
        let mtn = r.mountain_id.flatMap { id in catalog.mountains.first { $0.id == id }?.name } ?? ""
        let course = r.course_name ?? ""
        return [mtn, course].filter { !$0.isEmpty }.joined(separator: " | ")   // 웹 join(" | ")
    }
    // 웹 actualKm — 트랙 있으면 실측(소수), 없으면 distance_km ?? 0. 후행 0 제거("0","1.3","1.23")
    private func kmLabel(_ km: Double?) -> String { String(format: "%g", km ?? 0) }
    // 웹 fmtDur — "H:MM" (nil → "–")
    private func durationLabel(_ s: Int?) -> String {
        guard let s else { return "–" }
        let h = s / 3600, m = (s % 3600) / 60
        return "\(h):" + String(format: "%02d", m)
    }
    private func dateLabel(_ d: Date) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "ko_KR"); f.dateFormat = "yyyy.MM.dd"; return f.string(from: d)
    }
}

// 기록 카드 + 스와이프 삭제 — 웹 .rec-item/.ri-body/.ri-del 이식.
// 왼쪽으로 밀면 뒤의 빨간 삭제 버튼(90pt) 노출, 놓으면 절반 기준 스냅. 탭 시 열려있으면 닫고 아니면 onTap.
struct RecordCardRow<Content: View>: View {
    let theme: Theme
    let onTap: () -> Void
    let onDelete: () -> Void
    @ViewBuilder let content: () -> Content
    @State private var offset: CGFloat = 0
    @State private var dragStart: CGFloat? = nil     // 드래그 시작 시점의 정지 오프셋
    private let delW: CGFloat = 90

    var body: some View {
        ZStack(alignment: .trailing) {
            Button(action: onDelete) {                       // 웹 .ri-del (#b3261e)
                Text("삭제").font(.kakao(size: 13, weight: .bold)).foregroundStyle(.white)
                    .frame(width: delW).frame(maxHeight: .infinity)
                    .background(Color(hex: 0xb3261e))
            }
            .buttonStyle(.plain)
            .opacity(offset < -2 ? 1 : 0)

            content()
                .padding(.horizontal, 16).padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.elevated)
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(theme.line))
                .offset(x: offset)
                .contentShape(Rectangle())
                .onTapGesture {
                    if offset != 0 { withAnimation(.easeOut(duration: 0.18)) { offset = 0 } }
                    else { onTap() }
                }
                .gesture(
                    DragGesture(minimumDistance: 12)
                        .onChanged { v in
                            guard abs(v.translation.width) > abs(v.translation.height) else { return }
                            let start = dragStart ?? offset
                            if dragStart == nil { dragStart = offset }
                            offset = min(0, max(-delW, start + v.translation.width))
                        }
                        .onEnded { v in
                            let end = min(0, max(-delW, (dragStart ?? offset) + v.translation.width))
                            withAnimation(.easeOut(duration: 0.18)) { offset = end < -delW / 2 ? -delW : 0 }
                            dragStart = nil
                        }
                )
        }
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

// 산행 달력 — 웹 renderRecCalendar(app.js:1556) 이식. ‹ › 월 이동, 오늘 강조, 기록 있는 날 점.
struct RecCalendar: View {
    let dayKeys: Set<String>          // "y-m-d"(로컬)
    @Environment(\.colorScheme) private var scheme
    @State private var offset = 0     // 표시 월 = 이번 달 + offset
    private let cal = Calendar.current
    private let cols = Array(repeating: GridItem(.flexible(), spacing: 2), count: 7)

    var body: some View {
        let t = Theme(scheme: scheme)
        let base = cal.date(byAdding: .month, value: offset, to: startOfMonth(Date())) ?? Date()
        let y = cal.component(.year, from: base), m = cal.component(.month, from: base)
        let lead = cal.component(.weekday, from: base) - 1            // 첫날 앞 빈칸(일=0)
        let days = cal.range(of: .day, in: .month, for: base)?.count ?? 30
        let tc = cal.dateComponents([.year, .month, .day], from: Date())

        return VStack(spacing: 8) {
            HStack {
                navButton("chevron.left", t) { offset -= 1 }
                Spacer()
                Text("\(String(y)).\(String(format: "%02d", m))")
                    .font(.kakao(size: 14, weight: .semibold)).foregroundStyle(t.text)
                Spacer()
                navButton("chevron.right", t) { offset += 1 }
            }
            LazyVGrid(columns: cols, spacing: 4) {
                ForEach(["일","월","화","수","목","금","토"], id: \.self) { w in
                    Text(w).font(.kakao(size: 10)).foregroundStyle(t.muted)
                }
                // 앞 빈칸(nil) + 날짜 — 단일 배열/인덱스 id 로 ForEach id 충돌 방지.
                let cells: [Int?] = Array(repeating: nil, count: lead) + (1...days).map { $0 }
                ForEach(Array(cells.enumerated()), id: \.offset) { _, day in
                    if let d = day {
                        let isToday = tc.year == y && tc.month == m && tc.day == d
                        let hasRec = dayKeys.contains("\(y)-\(m)-\(d)")
                        VStack(spacing: 2) {
                            Text("\(d)")
                                .font(.kakao(size: 12, weight: isToday ? .heavy : .regular))
                                .foregroundStyle(t.text)
                                .frame(width: 24, height: 24)
                                // 웹 .rc-d.today::before — 채움 아닌 테두리 링
                                .overlay { if isToday { Circle().strokeBorder(t.line, lineWidth: 1) } }
                            Circle().fill(hasRec ? t.text : .clear).frame(width: 4, height: 4)
                        }
                        .frame(height: 30)
                    } else {
                        Color.clear.frame(height: 30)
                    }
                }
            }
        }
        .padding(14)
        .background(t.elevated, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(t.line))
    }

    private func startOfMonth(_ date: Date) -> Date {
        cal.date(from: cal.dateComponents([.year, .month], from: date)) ?? date
    }
    private func navButton(_ icon: String, _ t: Theme, _ act: @escaping () -> Void) -> some View {
        Button(action: act) {
            Image(systemName: icon).font(.kakao(size: 13, weight: .semibold))
                .foregroundStyle(t.muted).frame(width: 32, height: 28)
        }
    }
}
