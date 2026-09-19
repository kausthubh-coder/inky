#!/usr/bin/env bash
# Inspect exactly the staged image, then exercise its native packaged startup.
# Authentication, full journeys and Gatekeeper/notarization need separate proof.
set -euo pipefail
image="${1:?Supply the staged DMG}"
built_app="${2:?Supply the app used to make the DMG}"
receipt_directory="${3:?Supply a native receipt directory}"
test -s "$image"
mount="$(mktemp -d "${TMPDIR:-/tmp}/studi-dmg.XXXXXX")"
mounted=false
cleanup() {
  if "$mounted"; then
    for attempt in 1 2 3 4 5; do
      if hdiutil detach "$mount"; then mounted=false; break; fi
      sleep 1
    done
    if "$mounted"; then return 1; fi
  fi
  rmdir "$mount"
}
trap cleanup EXIT
hdiutil verify "$image"
hdiutil attach "$image" -readonly -nobrowse -mountpoint "$mount"
mounted=true
app="$mount/Studi.app"
test -d "$app"
test -s "$app/Contents/Resources/app.asar"
lipo "$app/Contents/MacOS/Studi" -verify_arch x86_64 arm64
cmp "$app/Contents/MacOS/Studi" "$built_app/Contents/MacOS/Studi"
cmp "$app/Contents/Resources/app.asar" "$built_app/Contents/Resources/app.asar"
for arch in x64 arm64; do
  native="Contents/Resources/app.asar.unpacked/node_modules/@napi-rs/canvas-darwin-$arch/skia.darwin-$arch.node"
  cmp "$app/$native" "$built_app/$native"
done
node scripts/verify-macos-first-launch.mjs "$app" "$image" "$receipt_directory"
printf '%s\n' 'Staged DMG verified: read-only mount, universal executable, archive and canvas bytes match the packaged app.'
