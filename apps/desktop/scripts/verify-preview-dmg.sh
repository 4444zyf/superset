#!/usr/bin/env bash
set -euo pipefail

preview_dmg=${1:?DMG path required}
preview_arch=${2:?Architecture required}
preview_version=${3:?Version required}
test "$(uname -s)" = Darwin
test -f "$preview_dmg"
case "$preview_arch" in
  arm64) preview_macho_arch=arm64 ;;
  x64) preview_macho_arch=x86_64 ;;
  *) exit 1 ;;
esac
[[ "$preview_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
hdiutil verify "$preview_dmg"

preview_mount_dir=$(mktemp -d "${TMPDIR:-/tmp}/superset-preview-dmg.XXXXXX")
preview_mounted=0
cleanup() {
  preview_status=$?
  trap - EXIT
  if [ "$preview_mounted" = 1 ]; then
    hdiutil detach "$preview_mount_dir" || preview_status=1
  fi
  rmdir "$preview_mount_dir" || preview_status=1
  exit "$preview_status"
}
trap cleanup EXIT
hdiutil attach -readonly -nobrowse -mountpoint "$preview_mount_dir" "$preview_dmg"
preview_mounted=1
preview_app="$preview_mount_dir/Superset SSH Preview.app"
preview_executable="$preview_app/Contents/MacOS/Superset SSH Preview"
test -x "$preview_executable"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$preview_app/Contents/Info.plist")" = com.superset.desktop.ssh-preview
test "$(lipo -archs "$preview_executable")" = "$preview_macho_arch"
codesign --verify --deep --strict "$preview_app"
bun "$(dirname "$0")/../../../packages/cli/scripts/stage-direct-resources.ts" \
  --verify --resources-dir="$preview_app/Contents/Resources/resources"
preview_backend="$preview_app/Contents/Resources/resources/direct-backend/darwin-${preview_arch}/lib"
"$preview_backend/node" "$preview_backend/direct-installer.js" --smoke-user e30=
"$preview_backend/node" --input-type=module -e \
  'await import(process.argv[2])' direct-import-smoke "$preview_backend/host-service-direct.js"
ELECTRON_RUN_AS_NODE=1 "$preview_executable" \
  "$(dirname "$0")/verify-preview-package.cjs" "$preview_app" "$preview_arch" "$preview_version"
ELECTRON_RUN_AS_NODE=1 "$preview_executable" \
  --import "$(dirname "$0")/../../../packages/direct-connection/node_modules/tsx/dist/loader.mjs" \
  "$(dirname "$0")/verify-direct-ssh-install.ts" "$preview_app/Contents/Resources/resources"
"$preview_app/Contents/Resources/resources/bin/superset" --version
