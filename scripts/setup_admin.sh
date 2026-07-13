#!/usr/bin/env bash
# 관리자 콘솔 환경 셋업: .venv + 파이프라인 의존성 + go-pmtiles CLI
# 사용: bash scripts/setup_admin.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install -q -r scripts/requirements.txt
echo "✓ .venv 준비 완료"

mkdir -p tools cache/dem
if [ ! -x tools/pmtiles ]; then
  # go-pmtiles 릴리스. 자산명은 v1.29+ 에서 `go-pmtiles-<VER>_...`(하이픈)으로 바뀜.
  # 다른 플랫폼/최신 버전: https://github.com/protomaps/go-pmtiles/releases
  VER=1.31.0
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)  PKG="go-pmtiles-${VER}_Linux_x86_64.tar.gz" ;;
    Darwin-arm64)  PKG="go-pmtiles-${VER}_Darwin_arm64.zip" ;;
    Darwin-x86_64) PKG="go-pmtiles-${VER}_Darwin_x86_64.zip" ;;
    *) echo "지원하지 않는 플랫폼 — tools/pmtiles 를 수동 설치하세요"; exit 1 ;;
  esac
  URL="https://github.com/protomaps/go-pmtiles/releases/download/v${VER}/${PKG}"
  echo "go-pmtiles 다운로드: $URL"
  TMP=$(mktemp -d)
  curl -sL "$URL" -o "$TMP/$PKG"
  case "$PKG" in
    *.tar.gz) tar -xzf "$TMP/$PKG" -C "$TMP" pmtiles ;;
    *.zip)    unzip -q "$TMP/$PKG" pmtiles -d "$TMP" ;;
  esac
  mv "$TMP/pmtiles" tools/pmtiles && chmod +x tools/pmtiles
  rm -rf "$TMP"
fi
echo "✓ tools/pmtiles 준비 완료"
echo
echo "관리자 서버 실행:  .venv/bin/python scripts/admin_server.py   → http://127.0.0.1:8891/admin/"
