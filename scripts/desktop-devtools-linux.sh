#!/usr/bin/env bash
# Build and install a Linux desktop build with the WebKit inspector enabled, as
# its own Flatpak (com.heirloom.devtools) with its own data, so it never touches
# the real app's tree in ~/.var/app/com.heirloom.desktop/. See
# docs/desktop-tauri.md → "Devtools build (Linux)".
#
# Usage: scripts/desktop-devtools-linux.sh [--skip-static] [--run]
#   --skip-static  reuse the existing out/ instead of running npm run build:static
#   --run          launch it when done (stops a running copy first)
set -euo pipefail

APP_ID=com.heirloom.devtools
REMOTE=heirloom-devtools-local
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}"
TARGET="$CACHE/heirloom-devtools-target"   # cargo's target dir, kept between runs
APP_DIR="$CACHE/heirloom-devtools-app"     # the Flatpak build directory
REPO_DIR="$CACHE/heirloom-devtools-repo"   # the local Flatpak repo it installs from

skip_static=0; run=0
for arg in "$@"; do
  case "$arg" in
    --skip-static) skip_static=1 ;;
    --run) run=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

# The build runs inside the GNOME 50 SDK, so the host needs no Rust or WebKitGTK
# packages. Runtime 50 matches flatpak/com.heirloom.desktop.yml.
missing=()
flatpak info org.gnome.Sdk//50 >/dev/null 2>&1 || missing+=(org.gnome.Sdk//50)
flatpak info org.gnome.Platform//50 >/dev/null 2>&1 || missing+=(org.gnome.Platform//50)
flatpak info org.freedesktop.Sdk.Extension.rust-stable//25.08 >/dev/null 2>&1 || missing+=(org.freedesktop.Sdk.Extension.rust-stable//25.08)
if ((${#missing[@]})); then
  echo "Missing Flatpak runtimes. Install them once with:" >&2
  echo "  flatpak install --user flathub ${missing[*]}" >&2
  exit 1
fi

if ((skip_static)); then
  [[ -f out/index.html ]] || { echo "No out/ to reuse: run without --skip-static." >&2; exit 1; }
else
  echo "==> Static export (npm run build:static)"
  npm run build:static
fi

# The devtools feature pulls in extra crates and rewrites Cargo.lock. Put the
# lock file back exactly as it was, so the change is never committed.
lock_backup=$(mktemp)
cp src-tauri/Cargo.lock "$lock_backup"
trap 'cp "$lock_backup" src-tauri/Cargo.lock; rm -f "$lock_backup"' EXIT

echo "==> Release binary with devtools (in org.gnome.Sdk//50)"
flatpak run --share=network --filesystem=home --command=sh org.gnome.Sdk//50 -c "
  set -e
  export PATH=/usr/lib/sdk/rust-stable/bin:\$PATH CARGO_TARGET_DIR='$TARGET'
  cd src-tauri
  cargo build --release --features tauri/custom-protocol,tauri/devtools
"

# Packaged as an installed Flatpak, not run straight from the SDK: GNOME 50's
# image loader (glycin) sandboxes itself with flatpak-spawn, which only works for
# an installed app, and the window crashes on its first icon otherwise.
echo "==> Flatpak $APP_ID"
rm -rf "$APP_DIR"
flatpak build-init "$APP_DIR" "$APP_ID" org.gnome.Sdk//50 org.gnome.Platform//50 >/dev/null
install -Dm755 "$TARGET/release/heirloom" "$APP_DIR/files/bin/heirloom"
# The same sandbox as the shipped app (flatpak/com.heirloom.desktop.yml).
flatpak build-finish "$APP_DIR" --command=heirloom \
  --socket=wayland --socket=fallback-x11 --share=ipc --device=dri \
  --share=network --filesystem=xdg-download >/dev/null
flatpak build-export "$REPO_DIR" "$APP_DIR" >/dev/null
flatpak --user remote-add --if-not-exists --no-gpg-verify "$REMOTE" "$REPO_DIR"
flatpak --user install -y --noninteractive --reinstall "$REMOTE" "$APP_ID" >/dev/null
echo "Installed $APP_ID from $(git rev-parse --short HEAD)$(git diff --quiet HEAD || echo ' plus uncommitted changes')."

if ((run)); then
  flatpak kill "$APP_ID" 2>/dev/null || true
  echo "==> Launching (right-click → Inspect Element for the devtools)"
  setsid flatpak run "$APP_ID" >/dev/null 2>&1 < /dev/null &
else
  echo "Run it with: flatpak run $APP_ID"
fi
