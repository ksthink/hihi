import SwiftUI
import PhotosUI

// 프로필 수정 — 닉네임(Supabase profiles) + 아바타 이미지(기기 로컬). 이미지 없으면 기본(person.circle).
struct ProfileEditView: View {
    @ObservedObject var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    @State private var nickname = ""
    @State private var pickerItem: PhotosPickerItem?
    @State private var pickedImage: UIImage?     // 새로 고른(크롭 완료) 이미지 — 미저장
    @State private var removeImage = false        // 기본 이미지로 되돌림
    @State private var saving = false
    @State private var cropping: UIImage?         // 크롭 화면에 올릴 원본(선택 직후)

    // 미리보기 이미지 — 새로 고른 것 > (되돌림 아니면)현재 아바타 > 기본
    private var preview: UIImage? { pickedImage ?? (removeImage ? nil : auth.avatar) }
    private var hasImage: Bool { preview != nil }

    var body: some View {
        let t = Theme(scheme: scheme)
        NavigationStack {
            VStack(spacing: 18) {
                // 아바타 미리보기
                Group {
                    if let img = preview {
                        Image(uiImage: img).resizable().scaledToFill()
                    } else {
                        Image(systemName: "person.circle.fill").resizable().scaledToFit().foregroundStyle(t.line)
                    }
                }
                .frame(width: 104, height: 104).clipShape(Circle())
                .overlay(Circle().strokeBorder(t.line))
                .padding(.top, 8)
                .onTapGesture { if let img = preview { cropping = img } }   // 기존 사진 다시 조정

                PhotosPicker(selection: $pickerItem, matching: .images) {
                    Text("사진 선택").font(.kakao(size: 14, weight: .semibold)).foregroundStyle(t.text)
                        .padding(.horizontal, 16).padding(.vertical, 8)
                        .background(t.surface, in: Capsule())
                        .overlay(Capsule().strokeBorder(t.line))
                }
                if hasImage {
                    Button("기본 이미지로") { pickedImage = nil; removeImage = true; pickerItem = nil }
                        .font(.kakao(size: 13)).foregroundStyle(t.muted)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("닉네임").font(.kakao(size: 12)).foregroundStyle(t.muted)
                    TextField("닉네임", text: $nickname)
                        .font(.kakao(size: 15)).foregroundStyle(t.text)
                        .padding(12)
                        .background(t.surface, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(t.line))
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                .padding(.top, 4)

                Button {
                    saving = true
                    Task {
                        let img: UIImage? = removeImage ? nil : (pickedImage ?? auth.avatar)
                        _ = await auth.saveProfile(nickname: nickname, image: img, clearImage: removeImage)
                        saving = false; dismiss()
                    }
                } label: {
                    Text(saving ? "저장 중…" : "저장").font(.kakao(size: 15, weight: .bold))
                        .foregroundStyle(t.onAccent).frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(t.accent, in: RoundedRectangle(cornerRadius: 12))
                }
                .disabled(saving).padding(.top, 4)

                Button { Task { await auth.signOut(); dismiss() } } label: {
                    Text("로그아웃").font(.kakao(size: 14, weight: .semibold)).foregroundStyle(t.text)
                }
                .padding(.top, 2)

                Spacer(minLength: 0)
            }
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(t.bg)
            .navigationTitle("프로필 수정").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
        }
        .onAppear { nickname = auth.nickname ?? "" }
        .onChange(of: pickerItem) { item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self),
                   let ui = UIImage(data: data) {
                    cropping = ui          // 바로 적용하지 않고 원형 크롭 화면으로
                }
            }
        }
        // 프로필 사진 조정 — 원형 가이드 안에서 위치·확대를 맞춘 뒤 적용.
        .fullScreenCover(isPresented: Binding(get: { cropping != nil },
                                              set: { if !$0 { cropping = nil } })) {
            if let src = cropping {
                AvatarCropView(image: src,
                               onCancel: { cropping = nil; pickerItem = nil },
                               onDone: { cropped in
                                   pickedImage = cropped; removeImage = false
                                   cropping = nil; pickerItem = nil
                               })
            }
        }
    }
}
