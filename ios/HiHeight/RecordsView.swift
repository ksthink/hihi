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
        ZStack {
            t.bg.ignoresSafeArea()
            if auth.email == nil {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text("기록").font(.kakao(size: 30, weight: .bold)).foregroundStyle(t.text)
                        authForm(t)
                    }
                    .padding(20)
                }
            } else {
                authedList(t)
            }
        }
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

    // MARK: 로그인됨 — 합계 + 목록(List)
    private func authedList(_ t: Theme) -> some View {
        List {
            Group {
                HStack(alignment: .firstTextBaseline) {
                    Text("기록").font(.kakao(size: 30, weight: .bold)).foregroundStyle(t.text)
                    Spacer()
                    Button { Task { await auth.signOut() } } label: {
                        Text("로그아웃").font(.kakao(size: 13)).foregroundStyle(t.muted)
                    }
                }
                Text(auth.email ?? "").font(.kakao(size: 13)).foregroundStyle(t.muted)
                summary(t)
                RecCalendar(dayKeys: recordDayKeys)   // 산행 달력 — 기록 있는 날 점 표시
            }
            .listRowInsets(EdgeInsets(top: 4, leading: 20, bottom: 4, trailing: 20))
            .listRowSeparator(.hidden)
            .listRowBackground(t.bg)

            if auth.records.isEmpty {
                Text("아직 등반 기록이 없습니다.").font(.kakao(size: 13)).foregroundStyle(t.muted)
                    .listRowInsets(EdgeInsets(top: 10, leading: 20, bottom: 4, trailing: 20))
                    .listRowSeparator(.hidden).listRowBackground(t.bg)
            } else {
                ForEach(auth.records) { r in
                    recordRow(r, t)
                        .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
                        .listRowSeparator(.hidden)
                        .listRowBackground(t.bg)
                        .contentShape(Rectangle())
                        .onTapGesture { if r.hasTrack { onShowRoute(r) } }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) { pendingDelete = r } label: {
                                Label("삭제", systemImage: "trash")
                            }
                        }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
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

    private func summary(_ t: Theme) -> some View {
        HStack(spacing: 0) {
            stat("\(auth.totalCount)", "총 산행", t)
            stat(String(format: "%.1f", auth.totalKm), "총 거리(km)", t)
            stat("\(auth.totalAscent)", "누적 고도(m)", t)
        }
        .padding(.vertical, 14)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 14))
        .padding(.top, 6)
    }

    private func stat(_ v: String, _ label: String, _ t: Theme) -> some View {
        VStack(spacing: 3) {
            Text(v).font(.kakao(size: 20, weight: .bold)).foregroundStyle(t.text)
            Text(label).font(.kakao(size: 11)).foregroundStyle(t.muted)
        }
        .frame(maxWidth: .infinity)
    }

    private func recordRow(_ r: ClimbRecord, _ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title(r)).font(.kakao(size: 15, weight: .semibold)).foregroundStyle(t.text)
            HStack(spacing: 10) {
                if let km = r.distance_km { Text(String(format: "%.1fkm", km)) }
                if let d = r.duration_s { Text(durationLabel(d)) }
                if let a = r.ascent_m { Text("↑\(a)m") }
                if r.hasTrack {
                    Text("루트 ›").foregroundStyle(t.text)
                }
                Spacer()
                if let dt = r.startedDate { Text(dateLabel(dt)) }
            }
            .font(.kakao(size: 12)).foregroundStyle(t.muted)
        }
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) { Rectangle().fill(t.line).frame(height: 0.5) }
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
        return [mtn, course].filter { !$0.isEmpty }.joined(separator: " · ")
    }
    private func durationLabel(_ s: Int) -> String {
        let h = s / 3600, m = (s % 3600) / 60
        return h > 0 ? "\(h)시간 \(m)분" : "\(m)분"
    }
    private func dateLabel(_ d: Date) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "ko_KR"); f.dateFormat = "yy.MM.dd"; return f.string(from: d)
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
                                .font(.kakao(size: 12, weight: isToday ? .bold : .regular))
                                .foregroundStyle(isToday ? t.onAccent : t.text)
                                .frame(width: 24, height: 24)
                                .background(isToday ? t.accent : .clear, in: Circle())
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
        .background(t.surface, in: RoundedRectangle(cornerRadius: 14))
        .padding(.top, 6)
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
