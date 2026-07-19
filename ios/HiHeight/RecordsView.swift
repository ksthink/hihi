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
    @State private var showProfileEdit = false

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
        .sheet(isPresented: $showProfileEdit) { ProfileEditView(auth: auth) }
    }

    // MARK: 로그인됨 — 합계 + 목록
    // 스와이프 삭제는 네이티브 List.swipeActions (ScrollView + 커스텀 드래그는 세로 스크롤과 충돌해
    // 실기기에서 스와이프가 잘 안 열림). 달력은 비지연 Grid 로 바꿔 List self-sizing 루프를 피함.
    private func authedList(_ t: Theme) -> some View {
        List {
            Group {
                authBar(t)                            // 웹 .auth-in — elevated 카드(이메일 + 로그아웃 알약)
                if let msg = auth.message {           // 삭제 실패 등 안내
                    Text(msg).font(.kakao(size: 13)).foregroundStyle(t.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                summary(t)
                RecCalendar(dayKeys: recordDayKeys)   // 산행 달력 — 기록 있는 날 점 표시
            }
            .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 12, trailing: 20))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)

            if auth.records.isEmpty {
                Text("아직 등반 기록이 없습니다.").font(.kakao(size: 13)).foregroundStyle(t.muted)
                    .listRowInsets(EdgeInsets(top: 4, leading: 20, bottom: 4, trailing: 20))
                    .listRowSeparator(.hidden).listRowBackground(Color.clear)
            } else {
                ForEach(auth.records) { r in           // 웹 rec-item — elevated 카드(gap 10)
                    recordRow(r, t)
                        .padding(.horizontal, 16).padding(.vertical, 14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(t.elevated, in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(t.line))
                        .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 10, trailing: 20))
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                        .contentShape(Rectangle())
                        .onTapGesture { if r.hasTrack { onShowRoute(r) } }
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
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

    // 웹 .auth-in — elevated 카드: 이메일(14 bold) + 로그아웃 알약(테두리·surface)
    private func authBar(_ t: Theme) -> some View {
        // 아바타 + 닉네임(없으면 안내) + 이메일 + 수정. 탭하면 프로필 수정 시트(닉네임·이미지·로그아웃).
        Button { showProfileEdit = true } label: {
            HStack(spacing: 12) {
                avatarView(44, t)
                VStack(alignment: .leading, spacing: 2) {
                    Text(auth.nickname?.isEmpty == false ? auth.nickname! : "닉네임 설정")
                        .font(.kakao(size: 15, weight: .bold))
                        .foregroundStyle(auth.nickname?.isEmpty == false ? t.text : t.muted).lineLimit(1)
                    Text(auth.email ?? "").font(.kakao(size: 11)).foregroundStyle(t.muted)
                        .lineLimit(1).truncationMode(.tail)
                }
                Spacer(minLength: 8)
                Text("수정").font(.kakao(size: 13, weight: .semibold)).foregroundStyle(t.text)
                    .padding(.horizontal, 14).padding(.vertical, 7)
                    .background(t.surface, in: Capsule())
                    .overlay(Capsule().strokeBorder(t.line))
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(t.elevated, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(t.line))
        }
        .buttonStyle(.plain)
    }

    // 프로필 아바타 — 로컬 이미지 있으면 원형, 없으면 기본(person.circle).
    private func avatarView(_ size: CGFloat, _ t: Theme) -> some View {
        Group {
            if let img = auth.avatar {
                Image(uiImage: img).resizable().scaledToFill()
            } else {
                Image(systemName: "person.circle.fill").resizable().scaledToFit().foregroundStyle(t.line)
            }
        }
        .frame(width: size, height: size).clipShape(Circle())
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

// 산행 달력 — 웹 renderRecCalendar(app.js:1556) 이식. ‹ › 월 이동, 오늘 강조, 기록 있는 날 점.
struct RecCalendar: View {
    let dayKeys: Set<String>          // "y-m-d"(로컬)
    @Environment(\.colorScheme) private var scheme
    @State private var offset = 0     // 표시 월 = 이번 달 + offset
    private let cal = Calendar.current

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
            // 요일 헤더 + 주 단위 행 — LazyVGrid 대신 고정 VStack/HStack.
            // (List self-sizing 재귀 루프를 피하려 Lazy 대신 비지연 레이아웃 사용.)
            let cells: [Int?] = Array(repeating: nil, count: lead) + (1...days).map { $0 }
            let weeks = stride(from: 0, to: cells.count, by: 7).map { s in
                Array(cells[s..<min(s + 7, cells.count)])
            }
            VStack(spacing: 4) {
                HStack(spacing: 4) {
                    ForEach(["일","월","화","수","목","금","토"], id: \.self) { w in
                        Text(w).font(.kakao(size: 10)).foregroundStyle(t.muted).frame(maxWidth: .infinity)
                    }
                }
                ForEach(Array(weeks.enumerated()), id: \.offset) { _, week in
                    HStack(spacing: 4) {
                        ForEach(0..<7, id: \.self) { i in
                            dayCell(i < week.count ? week[i] : nil, y, m, tc, t)
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(t.elevated, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(t.line))
    }

    // 날짜 셀 — 오늘(테두리 링·굵게) + 기록일(점). 빈칸이면 투명.
    @ViewBuilder
    private func dayCell(_ day: Int?, _ y: Int, _ m: Int, _ tc: DateComponents, _ t: Theme) -> some View {
        if let d = day {
            let isToday = tc.year == y && tc.month == m && tc.day == d
            let hasRec = dayKeys.contains("\(y)-\(m)-\(d)")
            VStack(spacing: 2) {
                Text("\(d)")
                    .font(.kakao(size: 12, weight: isToday ? .heavy : .regular))
                    .foregroundStyle(t.text)
                    .frame(width: 24, height: 24)
                    .overlay { if isToday { Circle().strokeBorder(t.line, lineWidth: 1) } }   // 웹 .rc-d.today::before
                Circle().fill(hasRec ? t.text : .clear).frame(width: 4, height: 4)
            }
            .frame(maxWidth: .infinity).frame(height: 30)
        } else {
            Color.clear.frame(maxWidth: .infinity).frame(height: 30)
        }
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
