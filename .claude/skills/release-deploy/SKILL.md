---
name: release-deploy
description: Deployment targets and release mechanics for this project — the hosted server (Railway backups and MCP), the Cloudflare static build, and the Tauri Windows and Linux desktop bundle CI. Use when deploying, checking a deployment, cutting a release, or debugging environment/volume/installer differences between build flavors.
---

# Release & deployment

The branch model and its prohibitions live in the root `CLAUDE.md` and are always loaded —
this skill covers the deployment targets behind them.

## Two build flavors

Both share the same codebase:

| Flavor | Stack | Where it runs |
|--------|-------|---------------|
| **Hosted server** | Next.js + PostgreSQL, OAuth | Railway (+ Docker) |
| **Static / local-first** | `out/` + PGlite/IndexedDB | Cloudflare web + Tauri desktop (Windows, Linux) |

See [`architecture.md`](../../../architecture.md) §Deployment and
[`docs/desktop-tauri.md`](../../../docs/desktop-tauri.md) for full details.

## Release workflow

1. Work on feature branches off `main` and open PRs into `main`. CI runs on every PR. Merging deploys nothing.
2. Before a release, when `main` has a schema change since the last release, run the upgrade gate (#811): `scripts/upgrade-check/run.sh v<last release>` on `main` (about 2 minutes, plus a one-off `npm ci` for the release when its lockfile differs from `main`'s, cached under `~/.cache/heirloom/release-deps/`; needs podman or docker and the Playwright Chromium). It upgrades the last release's data with `main` in a throwaway Postgres and in Chromium's IndexedDB and compares every table. It fails on a lost row or table. A "Changed" line is a value a migration rewrote: check it against that migration. Upgrade the desktop installers by hand on each platform (`docs/desktop-tauri.md`).
3. Release: merge a PR into `main` that bumps the version (`npm version <x.y.z> --no-git-tag-version`, `package.json` and the lockfile only) and writes the release's What's new entry (below), then tag its merge commit: `git fetch origin && git tag v<version> origin/main && git push origin v<version>`. The tag runs `desktop-build.yml`, which checks the tag matches `package.json` and is on `main`, builds the Windows and Linux bundles and publishes the `v<version>` GitHub release. Nothing in this repository deploys a site: the maintainer's hosted and static sites deploy a released tag from outside it. Issues closed when their PRs merged; the tag records what shipped.
   - **What's new (#35, ADR 0051):** the release PR adds `{ "version": "<x.y.z>", "items": [...] }` at the top of `lib/whats-new/changelog.json`. Each item is one short sentence a user would care about, not a PR title, with `en` required and `fr`/`ru` where you can. Users see it once, on their first load of the release. An entry with an empty `items` list shows nothing. An rc uses the entry of the release it leads to, so write that entry before the first rc.
   - **Test build (pre-release):** to try the next release before cutting it, bump to `<x.y.z>-rc.<n>` the same way and tag `v<x.y.z>-rc.<n>`. `desktop-build.yml` publishes it as a GitHub pre-release that never becomes the latest release. The bundles use the release app id, so installing one upgrades that machine's real local data to the candidate's schema, which the last release then refuses to open: back up first. Bump again to `<x.y.z>` (or the next `-rc.<n>`) for the real release. Don't make an rc tag a schema fixture (step 4).
4. After the release, if its `SCHEMA_VERSION` has no `test-fixtures/schema-v<N>.hlbak` yet, run `scripts/fixture-previous-release.sh v<version>` and commit the file in a PR into `main`. `__tests__/unit/schema-upgrade.pglite.test.ts` upgrades every such fixture to the current schema (#811), so the next release is checked against the data this one wrote. Keep `schema-v39.hlbak`, the oldest; an in-between fixture can go once a newer one covers its migrations.

## Hosted server

The maintainer's hosted and static sites are deployed from outside this repository: nothing here holds their configuration, credentials or addresses, and no workflow here deploys them. Self-hosters deploy their own (`SELF_HOSTING.md`). Never write a hosted or static site's address into this repository, a commit, a PR or a workflow log.

- **MCP:** a Railway MCP server may be configured; use it to check deployment status, logs and service health.

### Backing up Railway data

`npm run backup:railway` (`scripts/backup-railway.sh`) copies an environment's Postgres
database and `/data` media volume to local disk over `railway ssh`. It is a dry run by
default; add `-- --apply` to write `~/genealogy-backups/<env>-<timestamp>/` (`db.dump`,
`media.tar.gz`, `SHA256SUMS`), `--env <environment>` for another environment, and `--out <dir>` to change the folder.
It verifies the dump with `pg_restore --list` (via podman) and checks the tarball's file
count against the volume. It also refuses to write inside the repository. Restore steps are
in the script header. The output is real family data, so never commit it. Railway's own
Postgres snapshots (`railway postgres pitr backup …`) are separate, and production has no
schedule for them.

## Tauri desktop (Windows installer, Linux bundles)

- CI workflow: `.github/workflows/desktop-build.yml` — runs on a `v<version>` tag; creates the
  `v<version>` release as a draft, the Windows job and the Linux Flatpak build
  (`linux-flatpak.yml`) attach their bundles, and it is published only when both succeed
- Windows: `Heirloom_<version>_x64-setup.exe` (NSIS, ~7.7 MB, WebView2)
- Linux: `Heirloom_<version>_x86_64.flatpak` only (WebKitGTK from the GNOME runtime;
  manifest in `flatpak/`). No .deb, .rpm or AppImage: see `docs/desktop-tauri.md`. Linux users who
  can't use Flatpak install the web app (PWA) from Chrome or Edge
- The engines differ, so each platform needs its own smoke and upgrade check
- Version tracks `package.json`
- See [`docs/desktop-tauri.md`](../../../docs/desktop-tauri.md) for local build steps and smoke-check procedure
- To debug or profile on Linux (an inspector, a local build of the current branch), run
  `scripts/desktop-devtools-linux.sh --run`: a release build with devtools, installed as its
  own Flatpak `com.heirloom.devtools` with separate data. It is not the release Flatpak;
  see "Devtools build (Linux)" in `docs/desktop-tauri.md`
