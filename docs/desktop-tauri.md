# Heirloom Desktop (Tauri)

The desktop app is a **Tauri 2** native Windows and Linux wrapper around the
**static (local-first) build** — the same `out/` Cloudflare serves. There is no
embedded PostgreSQL and no Node server: data lives in **PGlite/IndexedDB** inside
the system webview's app-private profile. Backup/restore + GEDCOM import are the
data bridge.

The two platforms use **different webview engines**, so a pass on one says nothing
about the other:

| Platform | Engine | Bundles | App data |
|---|---|---|---|
| Windows | WebView2 (Chromium) | NSIS `_x64-setup.exe` | `%LOCALAPPDATA%\com.heirloom.desktop\` |
| Linux | WebKitGTK 4.1 (GNOME runtime) | Flatpak `.flatpak` | `~/.var/app/com.heirloom.desktop/data/com.heirloom.desktop/` |

Bundle targets: `tauri.conf.json` sets `["nsis"]`; `tauri.linux.conf.json`, which
Tauri merges only when building on Linux, overrides it to `["deb"]`: the .deb is not
shipped, it is the input the Flatpak repackages (see "Linux ships as a Flatpak only").

## Build locally
- `npm run desktop:dev` — live dev (runs `dev:static` on :3010 in a native webview window)
- `npm run desktop:build` — release build into `src-tauri/target/release/bundle/`:
  `nsis/Heirloom_<version>_x64-setup.exe` on Windows; `deb/` on Linux. To turn the .deb
  into the Flatpak, copy it to `flatpak/heirloom.deb` and run
  `flatpak-builder --user --install --install-deps-from=flathub build-dir flatpak/com.heirloom.desktop.yml`.

Both need the Rust toolchain (`rustup`). Windows also needs system WebView2
(present on Win10/11). Linux needs the WebKitGTK development packages:

```bash
# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel libxdo-devel
sudo dnf group install c-development
# Debian/Ubuntu (what CI installs)
sudo apt install build-essential libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev libxdo-dev xdg-utils
```

To build without installing those on the host, run the build in an `ubuntu:24.04`
container (the CI runner image): install the apt packages above, Node 24 and
rustup, then `AUTH_SECRET=x npm run desktop:build`. The host's glibc only has to be
no newer than the GNOME runtime's, since the Flatpak runs on the runtime's libraries.

## Release (CI)
Pushing a `v<version>` tag runs `.github/workflows/desktop-build.yml`. The tag must
match `package.json`, or the run fails before building.

1. `create-release` creates the `v<version>` GitHub Release as a **draft** if it
   does not exist.
2. `build-windows` (`windows-latest`) builds and uploads via `tauri-apps/tauri-action`;
   `build-linux` calls `linux-flatpak.yml`, which builds the .deb on `ubuntu-24.04` and
   repackages it with `flatpak-builder` in the `flathub-infra` GNOME 50 container;
   `upload-linux` attaches `Heirloom_<version>_x86_64.flatpak` with `gh release upload`.
3. `publish-release` publishes the draft only when both builds succeeded, so a
   failed platform never ships a release missing its assets. A failed run leaves
   the draft on the Releases page; re-running the workflow reuses it.

A version is released once. If `v<version>` is already published, `create-release`
skips both builds with a notice, so re-pushing a tag never overwrites a live
release's assets. Bump the version in a PR into `main`, then tag its merge commit
(the `release-deploy` skill has the steps).

`linux-flatpak.yml` also runs on its own for a PR that touches `flatpak/`, `src-tauri/`
or the workflow, and by hand (workflow_dispatch). The bundle is the run's
`heirloom-flatpak` artifact, so it can be installed and tested before a release.

### Linux ships as a Flatpak only
The Linux app used to ship as a `.deb`, `.rpm` and AppImage. They were dropped on
2026-10-30 after the v0.22.0 Linux review:

- **The AppImage brought its own, older WebKitGTK** (Ubuntu 22.04's), and all three
  bundles shared `~/.local/share/com.heirloom.desktop/`. WebKit's IndexedDB is not
  readable by an older WebKit: after the .deb or .rpm (system WebKit 2.52) had run,
  the AppImage listed the database's name as garbled UTF-16 and the app stayed on its
  loading placeholders forever. The same bundled libraries had already caused an
  empty window on Fedora 44 KDE Wayland (`EGL_BAD_PARAMETER`, from its bundled
  libwayland), which needed the AppImage repacked.
- **A .deb or .rpm can't be sandboxed.** Software centres warn "full system access"
  for every package that is not a Flatpak, and the app has no need for it.

The Flatpak runs on the GNOME runtime, which ships webkit2gtk-4.1 and gets WebKit
security fixes through `flatpak update`, between Heirloom releases. It keeps its data
under `~/.var/app/com.heirloom.desktop/`, apart from any data an old .deb/.rpm/AppImage
install left behind; move a tree across with a backup and restore. Its file access is
limited to the Downloads folder (`--filesystem=xdg-download`), where WebKit saves
backups and exports; opening a GEDCOM, photo or backup goes through the file chooser
portal, which grants only the file picked. Network access stays for map tiles, place
search and the optional Google Drive backup.

If the Flatpak can't be made to work, the fallback is to drop the Linux desktop app
and point Linux users at the PWA (see "Linux on high-refresh displays" below).

## Devtools build (Linux)

For debugging and profiling on Linux: a release build with the WebKit inspector,
installed as its own Flatpak so it never touches the real app's tree.

```bash
scripts/desktop-devtools-linux.sh --run      # static export, binary, install, launch
scripts/desktop-devtools-linux.sh --skip-static  # reuse out/ after a Rust-only change
```

- **What it is:** the production static export served by a release binary built with
  `--features tauri/custom-protocol,tauri/devtools`. It is not a dev build: no dev
  server, no StrictMode double render. Speed matches the shipped Flatpak. Right-click →
  **Inspect Element** opens the inspector.
- **Where it builds:** inside the `org.gnome.Sdk//50` Flatpak with the rust-stable
  extension, so the host needs no Rust or WebKitGTK packages. The script names the
  runtimes to install if any are missing
  (`flatpak install --user flathub org.gnome.Sdk//50 org.gnome.Platform//50 org.freedesktop.Sdk.Extension.rust-stable//25.08`).
- **Separate app and data:** it installs `com.heirloom.devtools` from a local repo
  (`~/.cache/heirloom-devtools-repo`, remote `heirloom-devtools-local`), with the same
  sandbox as `flatpak/com.heirloom.desktop.yml`. Its tree lives in
  `~/.var/app/com.heirloom.devtools/`, so import a test tree or a backup into it.
  The real app's data in `~/.var/app/com.heirloom.desktop/` is untouched.
- **Why a Flatpak and not the bare binary:** GNOME 50's image loader (glycin) sandboxes
  itself with `flatpak-spawn`, which only works for an installed app. Run straight
  from the SDK, the window crashes on its first icon (exit 134).
- **Cargo.lock:** the devtools feature adds crates and rewrites `src-tauri/Cargo.lock`.
  The script puts it back afterwards. Never commit that change.
- **Remove it:** `flatpak uninstall --user com.heirloom.devtools`,
  `flatpak --user remote-delete heirloom-devtools-local`, then delete
  `~/.cache/heirloom-devtools-*` (the cargo target dir is the large one).

This is a local tool only. CI and releases build the shipped Flatpak (see "Release (CI)").

## Smoke check (after a build)
Run it on each platform you release for.

1. Install the bundle and launch Heirloom from the app menu:
   - Windows: the NSIS installer (Start Menu).
   - Linux: `flatpak install --user ./Heirloom_<version>_x86_64.flatpak` (the GNOME
     runtime comes from Flathub, so the Flathub remote must be set up; Fedora has it).
2. Create a person; confirm it lists.
3. **Fully quit and relaunch** — the person must still be there (IndexedDB persistence).
4. **CSP check** (a CSP is now set in `tauri.conf.json` → `app.security.csp`; it has
   NOT yet been exercised in a real WebView2 window): open the WebView devtools and
   watch the console for `Refused to …` CSP errors while you create a person, open
   the tree, and open a place map. A release build has no devtools (there is no `--devtools` flag), so
   on Linux use the devtools build above; on Windows, build with
   `npx tauri build --features tauri/devtools` and don't ship that installer.
   PGlite needs `'wasm-unsafe-eval'` and Tauri IPC needs
   `ipc:`/`http://ipc.localhost` in `connect-src` — both are in the policy; if the
   webview still blocks something, fix the specific directive rather than removing
   the CSP.
5. **Minimum size check:** drag the window to its smallest size; it must keep the
   desktop layout (top nav, not the menu button). On Linux, repeat with a larger
   text scale, e.g. `GDK_DPI_SCALE=1.25` on the command line.
6. **Upgrade check:** install the next release over the previous one with the same
   bundle type and confirm the data from step 2 is still there.

### Linux-only checks (WebKitGTK)
- **Backup save:** WebKit has no `showSaveFilePicker`, so
  `app/components/backup/useFileBackup.ts` always takes its download fallback.
  Confirm a backup file is actually written.
- **Persistent storage:** check what the backup panel reports for
  `navigator.storage.persisted()` after first run.
- **File access:** import a GEDCOM and add a photo from outside Downloads (the file
  chooser portal must hand them over), and save a backup (it must land in Downloads).
- **Blank window:** on some GPU drivers WebKitGTK renders blank for dmabuf reasons;
  `flatpak run --env=WEBKIT_DISABLE_DMABUF_RENDERER=1 com.heirloom.desktop` is the
  workaround for that case.

### Linux on high-refresh displays: recommend the PWA
WebKitGTK renders at 60 fps on displays faster than 60 Hz, so on a 120/144 Hz
monitor the Linux desktop app scrolls and animates at less than half the display's
rate (#1160). This is upstream, not app code:

- WebKit matches the window's monitor to a DRM connector by **exact** physical
  size (`DisplayVBlankMonitorDRM.cpp`). Monitors whose EDID gives slightly
  different sizes to GDK and to DRM (e.g. 797×334 vs 800×330 mm) never match, so
  WebKit falls back to a fixed 60 Hz timer.
- Forcing the sizes to match moved WebKit onto real DRM vblank, yet rendering
  stayed at 60 fps, so a second limit exists. No setting or environment variable
  lifts it (`WEBKIT_DISPLAY_REFRESH_THROTTLE_FPS` only lowers the rate).

At 60 Hz, list and grid scrolling in the desktop app matched the PWA in the
maintainer's test. Swiping between full-size photos in the lightbox still felt
heavier (not yet profiled). For Linux users on a high-refresh monitor,
recommend installing the static build as a PWA from Chrome or Edge instead: same
app and data model, rendered at the display's rate. Its data lives in that browser
profile, separate from the desktop app's, so move it with a backup and restore.
Windows is unaffected (WebView2 is Chromium).

## Minimum window size
`tauri.conf.json` sets `minWidth: 800` / `minHeight: 600` in logical px. With no
page zoom that is 800 CSS px, above the 767px phone breakpoint, on both platforms:
display scaling (125%, 200%) changes logical and CSS px together.

A desktop **text** scale is different on Linux (GNOME Large Text, KDE font DPI on
X11, `Xft.dpi`, `GDK_DPI_SCALE`). WebKitGTK zooms the page by it without changing
the window's scale factor, and scales media-query `rem` by the same zoom. At 1.25
the 800px minimum gave 640 CSS px against a 960px `md` breakpoint (Tailwind's
`48rem`), so the window showed the phone layout. That was the flip seen during the
Phase 0 gate.

`app/components/DesktopWindowFit.tsx` handles it at runtime: in the desktop app
it measures the page zoom (`devicePixelRatio` over the window's scale factor) and
the media-query rem, raises the window minimum by both (1250 x 938 at a 1.25 text
scale), grows the window if it is smaller, and refits when the zoom changes. The
minimum is capped at the monitor's work area: a screen too small for the desktop
layout gets the phone layout, not a window larger than the screen. It
needs the `core:window:allow-set-min-size` and `allow-set-size` permissions in
`capabilities/default.json`. `@tauri-apps/api` stays on the `tauri` crate's
minor version (`~2.11`): `tauri build` refuses a mismatched direct dependency.

Measured under Xvfb + openbox with WebKitGTK 2.52 (#85): with no scale and with
`GDK_SCALE=2` the window keeps the desktop layout at its configured minimum; with
`GDK_DPI_SCALE=1.25` it showed the phone layout until the fit, and the desktop
layout at the fitted 1250 x 938. Not yet checked on a real Wayland session
or in WebView2.

## Icon
Placeholder generated from `app/favicon.ico` via `npx @tauri-apps/cli icon`.
Replace with a real 1024×1024 source PNG later (`tauri icon <source.png>`).

## Known desktop follow-ups (pinned, not yet done)
- Hide/replace the static first-run "welcome / local-only storage" notice for the packaged app.

## Out of scope (future)
Auto-update (Tauri updater + GitHub Releases), macOS target.
