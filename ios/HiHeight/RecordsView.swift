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
                        Text("기록").font(.system(size: 30, weight: .bold)).foregroundStyle(t.text)
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
                    Text("기록").font(.system(size: 30, weight: .bold)).foregroundStyle(t.text)
                    Spacer()
                    Button { Task { await auth.signOut() } } label: {
                        Text("로그아웃").font(.system(size: 13)).foregroundStyle(t.muted)
                    }
                }
                Text(auth.email ?? "").font(.system(size: 13)).foregroundStyle(t.muted)
                summary(t)
            }
            .listRowInsets(EdgeInsets(top: 4, leading: 20, bottom: 4, trailing: 20))
            .listRowSeparator(.hidden)
            .listRowBackground(t.bg)

            if auth.records.isEmpty {
                Text("아직 등반 기록이 없습니다.").font(.system(size: 13)).foregroundStyle(t.muted)
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
            Text("로그인하고 등반 기록을 저장하세요.").font(.system(size: 14)).foregroundStyle(t.muted)
            TextField("이메일", text: $email)
                .textContentType(.emailAddress).keyboardType(.emailAddress)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .padding(12).background(t.surface, in: RoundedRectangle(cornerRadius: 10))
            SecureField("비밀번호", text: $pass)
                .padding(12).background(t.surface, in: RoundedRectangle(cornerRadius: 10))
            HStack(spacing: 10) {
                Button { Task { await auth.signIn(email, pass) } } label: {
                    Text("로그인").font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(t.onAccent).frame(maxWidth: .infinity).padding(.vertical, 11)
                        .background(t.accent, in: RoundedRectangle(cornerRadius: 10))
                }
                Button { Task { await auth.signUp(email, pass) } } label: {
                    Text("가입").font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(t.text).frame(maxWidth: .infinity).padding(.vertical, 11)
                        .background(t.surface, in: RoundedRectangle(cornerRadius: 10))
                }
            }
            .disabled(auth.busy)
            if let msg = auth.message {
                Text(msg).font(.footnote).foregroundStyle(t.muted)
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
            Text(v).font(.system(size: 20, weight: .bold)).foregroundStyle(t.text)
            Text(label).font(.system(size: 11)).foregroundStyle(t.muted)
        }
        .frame(maxWidth: .infinity)
    }

    private func recordRow(_ r: ClimbRecord, _ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title(r)).font(.system(size: 15, weight: .semibold)).foregroundStyle(t.text)
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
            .font(.system(size: 12)).foregroundStyle(t.muted)
        }
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) { Rectangle().fill(t.line).frame(height: 0.5) }
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
