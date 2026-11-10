# 0040 — Linux ships as a Flatpak only

**Date:** 2026-10-30 · **Context:** #1218, #1013 · **Status:** Accepted · **Area:** desktop / packaging

Up to v0.22.0 the Linux desktop app shipped as a `.deb`, an `.rpm` and an AppImage. Reviewing
v0.22.0 on Fedora KDE, the maintainer found the AppImage stuck on its loading placeholders and
the RPM asking for full system access.

## Decision

1. **One Linux bundle: a Flatpak** on the GNOME runtime (`flatpak/com.heirloom.desktop.yml`),
   repackaged from the Tauri `.deb`. The `.deb` is still built, but only as the Flatpak's input.
   No `.deb`, `.rpm` or AppImage is uploaded to a release.
2. **File access is Downloads only** (`--filesystem=xdg-download`), where WebKit saves backups
   and exports. Files the user opens come through the file chooser portal. Network access stays
   for map tiles, place search and the Drive backup.
3. **If the Flatpak stops working, the fallback is the PWA**, not a return to the old bundles.
   The maintainer set this before the first Flatpak build, which then worked on Fedora the
   same day.

## Why

- **Two WebKits must not share one profile.** All three bundles used
  `~/.local/share/com.heirloom.desktop/`. The AppImage carried Ubuntu 22.04's WebKitGTK; the
  `.deb`/`.rpm` used the system's (2.52). WebKit's IndexedDB is not readable by an older WebKit:
  after the `.deb` had run, the AppImage listed the database's name as garbled UTF-16 and never
  opened it. Reproduced under Xvfb; the reverse order worked. Any future second Linux bundle
  with its own WebKit reintroduces this silently.
- **A `.deb` or `.rpm` can't be sandboxed.** Software centres warn "full system access" for every
  non-Flatpak package, and no RPM setting changes that.
- **The bundled-WebKit AppImage had already broken once** (an empty window on Fedora 44 KDE
  Wayland from its bundled libwayland, which needed the image repacked). Tauri's maintainers
  describe AppImages as having recurring problems.
- **The runtime keeps WebKit current.** GNOME 50 ships webkit2gtk-4.1 and receives security
  fixes through `flatpak update`, between Heirloom releases.

## Rejected

- **AppImage only.** Removes the clash but keeps an old bundled WebKit, forces XWayland, and is
  no more restricted than the RPM; it only hides the warning.
- **Keep `.deb`/`.rpm` beside the Flatpak.** The Flatpak's data is separate, so it would not
  clash, but it keeps the unsandboxed bundles and two Linux paths to test.
- **Give the AppImage its own data folder.** Fixes the hang, but not the old WebKit or the access.
- **Drop the Linux desktop app for the PWA now.** Kept as the fallback; the Flatpak worked first.
