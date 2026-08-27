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
    @State private var selectedDay: String?        // 캘린더에서 고른 날짜 "y-m-d" (nil=전체)
    @State private var sort: RecSort = .date       // 목록 정렬 기준
    @State private var sortAsc = false             // false=내림차순(최신·큰 값 먼저)
    @State private var shownCount = Self.page      // 지금까지 그린 개수
    // 꼬리표(...)를 지나쳐 스크롤했을 때만 다음 장을 연다.
    // ⚠️ **false 로 시작해야 한다.** true 로 두면 목록이 화면을 못 채울 때 꼬리표가 처음부터
    //    기준선 위에 있어 스스로 열린다 — 3개가 순식간에 6개가 됐다(2026-08-27 실측).
    //    꼬리표가 기준선 **아래(=바닥 근처)** 에 온 적이 있어야 장전되고, 거기서 위로
    //    끌어올려질 때 열린다. 그래서 스크롤할 게 없으면 영영 열리지 않는다.
    @State private var armed = false
    @State private var listH: CGFloat = 0          // List 뷰포트 높이 — 지나쳤는지 판단하는 기준
    private static let page = 10
    private static let passBy: CGFloat = 56        // 이만큼 위로 끌어올려야 "지나쳤다"

    // 목록 정렬 — 날짜/거리/등반시간(모두 큰 값 우선).
    enum RecSort: CaseIterable {
        case date, distance, duration
        var label: String {
            switch self {
            case .date: return "날짜순"
            case .distance: return "거리순"
            case .duration: return "시간순"
            }
        }
    }

    // 화면에 보일 기록 — 날짜 필터 적용 후 정렬.
    private var shownRecords: [ClimbRecord] {
        let cal = Calendar.current
        var list = auth.records
        if let day = selectedDay {
            list = list.filter { r in
                guard let d = r.startedDate else { return false }
                let c = cal.dateComponents([.year, .month, .day], from: d)
                return "\(c.year!)-\(c.month!)-\(c.day!)" == day
            }
        }
        // 오름/내림 공통 비교기 — sortAsc 에 따라 방향만 뒤집는다.
        func by<T: Comparable>(_ key: @escaping (ClimbRecord) -> T) -> (ClimbRecord, ClimbRecord) -> Bool {
            { a, b in sortAsc ? key(a) < key(b) : key(a) > key(b) }
        }
        switch sort {
        case .date:     list.sort(by: by { $0.startedDate ?? .distantPast })
        case .distance: list.sort(by: by { $0.distance_km ?? 0 })
        case .duration: list.sort(by: by { $0.duration_s ?? 0 })
        }
        return list
    }

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
        // 정렬은 비싸므로 body 당 한 번만 — ForEach·onAppear 에서 매번 다시 부르지 않는다.
        let all = shownRecords
        let page = Array(all.prefix(shownCount))
        return List {
            Group {
                authBar(t)                            // 웹 .auth-in — elevated 카드(이메일 + 로그아웃 알약)
                if let msg = auth.message {           // 삭제 실패 등 안내
                    Text(msg).font(.kakao(size: 13)).foregroundStyle(t.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                summary(t)
                // 산행 달력 — 기록 있는 날 점 표시, 그 날을 탭하면 해당 일만 보기(다시 탭 해제)
                RecCalendar(dayKeys: recordDayKeys, selected: $selectedDay)
                sortBar(t)                            // 정렬 + 선택 날짜 해제
            }
            .listRowInsets(EdgeInsets())   // 좌우 여백은 List 자체에 줌(행 안쪽에 주면 스와이프 버튼과 틈이 생김)
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)

            if all.isEmpty {
                Text(auth.records.isEmpty ? "아직 등반 기록이 없습니다." : "선택한 날짜에 기록이 없습니다.")
                    .font(.kakao(size: 13)).foregroundStyle(t.muted)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                    .listRowSeparator(.hidden).listRowBackground(Color.clear)
            } else {
                ForEach(page) { r in                   // 웹 rec-item — elevated 카드(gap 10)
                    // 커스텀 스와이프 — 카드가 삭제 버튼 위로 미끄러진다(모서리·틈·겹침 모두 해결).
                    SwipeToDeleteRow(onDelete: { pendingDelete = r },
                                     onTap: { if r.hasTrack { onShowRoute(r) } }) {
                        recordRow(r, t)
                            .padding(.horizontal, 16).padding(.vertical, 14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(t.elevated, in: RoundedRectangle(cornerRadius: 14))
                            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(t.line))
                            .contentShape(Rectangle())
                    }
                    .listRowInsets(EdgeInsets())   // 좌우 여백은 List 자체에 줌
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                }
                tail(all.count, t)
            }
        }
        // 뷰포트 높이 — 꼬리표가 바닥에서 얼마나 올라왔는지 재는 기준선.
        .background(GeometryReader { g in
            Color.clear.preference(key: ListHeightKey.self, value: g.size.height)
        })
        .onPreferenceChange(ListHeightKey.self) { listH = $0 }
        .coordinateSpace(name: "recList")
        // 필터·정렬이 바뀌면 처음 10개부터 다시 — 안 그러면 새 목록이 통째로 그려진다.
        .onChange(of: selectedDay) { _, _ in resetPaging() }
        .onChange(of: sort) { _, _ in resetPaging() }
        .onChange(of: sortAsc) { _, _ in resetPaging() }
        .listStyle(.plain)
        .listRowSpacing(10)          // 카드 간 여백 — 행 밖이라 삭제 버튼 높이가 카드와 정확히 일치
        .padding(.horizontal, 20)    // 좌우 여백을 List 에 줘서 행 폭 = 카드 폭
        .scrollIndicators(.hidden)   // List 에 가로 패딩을 줘 인디케이터가 카드 위로 겹침 → 숨김
        .scrollContentBackground(.hidden)
        .background(t.bg)
    }

    // 목록 꼬리표 — 더 있으면 `...`, 다 봤으면 `-`.
    //
    // ⚠️ **화면에 들어왔다고 더 불러오지 않는다.** 예전엔 마지막 카드의 onAppear 로 늘렸는데,
    //    첫 10개가 화면을 다 못 채우면 연쇄로 터져 한 번에 전부 로드됐다(사용자 지적 2026-08-27).
    //    지금은 꼬리표가 바닥에서 passBy 만큼 **끌어올려졌을 때** = 사용자가 지나쳐 스크롤했을
    //    때만 다음 장을 연다. 한 번 열면 다시 아래로 내려가야 재장전된다(armed).
    @ViewBuilder
    private func tail(_ total: Int, _ t: Theme) -> some View {
        let more = shownCount < total
        Text(more ? "..." : "-")
            .font(.system(size: 12, design: .monospaced))
            .foregroundStyle(t.muted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(GeometryReader { g in
                Color.clear.preference(key: TailOffsetKey.self,
                                       value: g.frame(in: .named("recList")).minY)
            })
            .onPreferenceChange(TailOffsetKey.self) { y in
                guard more, listH > 0 else { return }
                if y >= listH - Self.passBy { armed = true }          // 아직 바닥 근처 — 장전
                else if armed { armed = false; shownCount = min(shownCount + Self.page, total) }
            }
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }

    private func resetPaging() {
        shownCount = Self.page
        armed = false
    }

    // MARK: 비로그인 — 이메일 인증
    private func authForm(_ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("로그인하고 등반 기록을 저장하세요.").font(.kakao(size: 14)).foregroundStyle(t.muted)
            // ⚠️ .font 를 주지 않으면 입력 글자와 플레이스홀더가 시스템 폰트로 나온다
            //    (SwiftUI 는 필드의 font 를 플레이스홀더에도 적용한다). ProfileEditView 의
            //    닉네임 필드와 같은 구성으로 맞춘다 — 테두리까지 포함.
            TextField("이메일", text: $email)
                .font(.kakao(size: 15)).foregroundStyle(t.text)
                .textContentType(.emailAddress).keyboardType(.emailAddress)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .padding(12).background(t.surface, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(t.line))
            SecureField("비밀번호", text: $pass)
                .font(.kakao(size: 15)).foregroundStyle(t.text)
                .textContentType(.password)
                .padding(12).background(t.surface, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(t.line))
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

    // 목록 위 정렬 바 — 작은 알약 버튼 3개(날짜/거리/시간). 날짜 필터 중이면 해제 칩을 우측에.
    private func sortBar(_ t: Theme) -> some View {
        HStack(spacing: 6) {
            ForEach(RecSort.allCases, id: \.self) { s in
                let on = sort == s
                Button {
                    if on { sortAsc.toggle() }        // 선택된 걸 다시 누르면 오름↔내림
                    else { sort = s; sortAsc = false } // 새로 고르면 내림차순부터
                } label: {
                    HStack(spacing: 3) {
                        Text(s.label).font(.kakao(size: 11, weight: on ? .bold : .regular))
                        if on {
                            Image(systemName: sortAsc ? "arrow.up" : "arrow.down")
                                .font(.system(size: 9, weight: .bold))
                        }
                    }
                    .foregroundStyle(on ? t.onAccent : t.muted)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(on ? t.accent : t.surface, in: Capsule())
                    .overlay(Capsule().strokeBorder(on ? .clear : t.line))
                }
                .buttonStyle(.plain)
            }
            Spacer(minLength: 4)
            if let day = selectedDay {
                Button { selectedDay = nil } label: {
                    HStack(spacing: 4) {
                        Text(dayLabel(day)).font(.kakao(size: 11, weight: .semibold))
                        Image(systemName: "xmark.circle.fill").font(.system(size: 11))
                    }
                    .foregroundStyle(t.text)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(t.surface, in: Capsule())
                    .overlay(Capsule().strokeBorder(t.line))
                }
                .buttonStyle(.plain)
            }
        }
    }

    // "y-m-d" → "M월 d일"
    private func dayLabel(_ key: String) -> String {
        let p = key.split(separator: "-").compactMap { Int($0) }
        return p.count == 3 ? "\(p[1])월 \(p[2])일" : key
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
    @Binding var selected: String?    // 선택된 날짜("y-m-d") — 기록 있는 날만 선택 가능
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
            let key = "\(y)-\(m)-\(d)"
            let isToday = tc.year == y && tc.month == m && tc.day == d
            let hasRec = dayKeys.contains(key)
            let isSel = selected == key
            VStack(spacing: 2) {
                Text("\(d)")
                    .font(.kakao(size: 12, weight: isToday || isSel ? .heavy : .regular))
                    .foregroundStyle(isSel ? t.onAccent : t.text)
                    .frame(width: 24, height: 24)
                    .background { if isSel { Circle().fill(t.accent) } }                       // 선택일 강조
                    .overlay { if isToday && !isSel { Circle().strokeBorder(t.line, lineWidth: 1) } }  // 웹 .rc-d.today::before
                Circle().fill(hasRec && !isSel ? t.text : .clear).frame(width: 4, height: 4)
            }
            .frame(maxWidth: .infinity).frame(height: 30)
            .contentShape(Rectangle())
            .onTapGesture { if hasRec { selected = isSel ? nil : key } }   // 기록 있는 날만, 다시 탭하면 해제
        } else {
            Color.clear.frame(maxWidth: .infinity).frame(height: 30)
        }
    }

    private func startOfMonth(_ date: Date) -> Date {
        cal.date(from: cal.dateComponents([.year, .month], from: date)) ?? date
    }
    // ⚠️ `.buttonStyle(.plain)` 이 **필수**다. List 행 안에 기본 스타일 Button 이 여럿 있으면
    //    SwiftUI 가 행 전체를 한 덩어리로 잡아 개별 탭이 먹지 않는다 — 전달·다음달이 눌리지
    //    않던 원인이 이것이었다(2026-08-27). 같은 이유로 sortBar 버튼에도 붙어 있다.
    //    `contentShape` 는 아이콘 여백까지 손가락이 닿게 한다.
    private func navButton(_ icon: String, _ t: Theme, _ act: @escaping () -> Void) -> some View {
        Button(action: act) {
            Image(systemName: icon).font(.kakao(size: 13, weight: .semibold))
                .foregroundStyle(t.muted).frame(width: 40, height: 32)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}


// 목록 꼬리표 위치·뷰포트 높이를 위로 올리는 통로.
private struct TailOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = .greatestFiniteMagnitude
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
private struct ListHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}
