#!/usr/bin/env bash
# TestFlight 업로드 — 아카이브 후 App Store Connect 로 전송.
# VSCode/터미널만으로 완결된다(Xcode.app 은 설치돼 있어야 함).
#
#   사용:  bash ios/testflight.sh
#
# 사전 준비 (최초 1회):
#   1) App Store Connect 에서 앱 레코드 생성 — 번들 ID dev.metaphr.hiheight
#   2) App Store Connect > 사용자 및 액세스 > 통합 > App Store Connect API 에서
#      키 발급 → AuthKey_XXXXXXXXXX.p8 를 ~/.appstoreconnect/private_keys/ 에 저장
#   3) 아래 3개를 환경변수로 (~/.zshrc 에 넣어두면 편함)
#        export ASC_KEY_ID=XXXXXXXXXX
#        export ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#        export ASC_KEY_PATH=~/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8
set -euo pipefail

cd "$(dirname "$0")/.."          # 리포 루트

: "${ASC_KEY_ID:?ASC_KEY_ID 가 없습니다 — 스크립트 상단 '사전 준비' 참고}"
: "${ASC_ISSUER_ID:?ASC_ISSUER_ID 가 없습니다 — 스크립트 상단 '사전 준비' 참고}"
: "${ASC_KEY_PATH:?ASC_KEY_PATH 가 없습니다 — 스크립트 상단 '사전 준비' 참고}"
KEY_PATH="${ASC_KEY_PATH/#\~/$HOME}"
[ -f "$KEY_PATH" ] || { echo "❌ API 키 파일 없음: $KEY_PATH"; exit 1; }

# 빌드번호 = git 커밋 수. 단조 증가하며 재현 가능(같은 번호 재업로드는 거부되므로 매번 달라야 함).
BUILD="$(git rev-list --count HEAD)"
COMMIT="$(git rev-parse --short HEAD)$([ -n "$(git status --porcelain)" ] && echo -n '+')"   # DEVMODE — HUD 커밋 표시용
ARCHIVE="ios/build/HiHeight.xcarchive"

echo "▶ 스타일 생성 + 프로젝트 재생성"
( cd ios && node gen-style.mjs && xcodegen generate )

echo "▶ 아카이브 (build ${BUILD})"
rm -rf "$ARCHIVE"
xcodebuild archive \
  -project ios/HiHeight.xcodeproj \
  -scheme HiHeight \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  CURRENT_PROJECT_VERSION="$BUILD" \
  GIT_COMMIT="$COMMIT"   # DEVMODE — HUD 커밋 표시용(개발자 모드 제거 시 이 인자와 위 COMMIT 줄 삭제 가능)

echo "▶ App Store Connect 업로드"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist ios/ExportOptions.plist \
  -exportPath ios/build/export \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

echo
echo "✅ 업로드 완료 — build ${BUILD}"
echo "   App Store Connect 에서 처리(보통 5~15분) 후 TestFlight > 내부 테스터 에게 배포하세요."
