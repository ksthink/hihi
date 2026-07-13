import SwiftUI

// 기록 탭 — 계정(이메일 인증) + climb_records 합계·목록 (웹 기록 뷰 대응).
// 달력·루트 보기·스와이프 삭제는 후속 슬라이스.
struct RecordsView: View {
    @ObservedObject var auth: AuthStore
    @ObservedObject var catalog: CatalogStore
    @Environment(\.colorScheme) private var scheme
    @State private var email = ""
    @State private var pass = ""

    var body: some View {
        let t = Theme(scheme: scheme)
        ZStack {
            t.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("기록").font(.system(size: 30, weight: .bold)).foregroundStyle(t.text)
                    if auth.email == nil {
                        authForm(t)
                    } else {
                        authedHeader(t)
                        summary(t)
                        recordList(t)
                    }
                }
                .padding(20)
            }
        }
        .task { await auth.refresh() }
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

    private func authedHeader(_ t: Theme) -> some View {
        HStack {
            Text(auth.email ?? "").font(.system(size: 14, weight: .medium)).foregroundStyle(t.text)
            Spacer()
            Button { Task { await auth.signOut() } } label: {
                Text("로그아웃").font(.system(size: 13)).foregroundStyle(t.muted)
            }
        }
        .padding(.bottom, 2)
    }

    private func summary(_ t: Theme) -> some View {
        HStack(spacing: 0) {
            stat("\(auth.totalCount)", "총 산행", t)
            stat(String(format: "%.1f", auth.totalKm), "총 거리(km)", t)
            stat("\(auth.totalAscent)", "누적 고도(m)", t)
        }
        .padding(.vertical, 14)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 14))
    }

    private func stat(_ v: String, _ label: String, _ t: Theme) -> some View {
        VStack(spacing: 3) {
            Text(v).font(.system(size: 20, weight: .bold)).foregroundStyle(t.text)
            Text(label).font(.system(size: 11)).foregroundStyle(t.muted)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func recordList(_ t: Theme) -> some View {
        if auth.records.isEmpty {
            Text("아직 등반 기록이 없습니다.").font(.system(size: 13)).foregroundStyle(t.muted)
                .padding(.top, 8)
        } else {
            VStack(spacing: 0) {
                ForEach(auth.records) { r in recordRow(r, t) }
            }
        }
    }

    private func recordRow(_ r: ClimbRecord, _ t: Theme) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title(r)).font(.system(size: 15, weight: .semibold)).foregroundStyle(t.text)
            HStack(spacing: 10) {
                if let km = r.distance_km { Text(String(format: "%.1fkm", km)) }
                if let d = r.duration_s { Text(durationLabel(d)) }
                if let a = r.ascent_m { Text("↑\(a)m") }
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
