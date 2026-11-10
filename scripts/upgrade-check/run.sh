#!/usr/bin/env bash
# The #811 release gate's manual half: upgrade data written by a previous release
# with this checkout's code, in the hosted and static builds, and compare.
# (The PGlite migration test runs in CI; desktop installers are checked by hand.)
#
# Usage: scripts/upgrade-check/run.sh <release tag> [hosted|static|all]   default: all
#
#   hosted  A throwaway Postgres 16 in podman (or docker). The release's code
#           seeds the synthetic tree and imports the large generated GEDCOM; this
#           checkout boots on it, which upgrades it. Compares every table and
#           each tree's export zip, then imports the release's zips here.
#   static  Builds both static apps (this checkout's into out/), then drives
#           Chromium: the release restores test-fixtures/synthetic.hlbak, and the
#           candidate opens the same IndexedDB on the same origin. Compares backups.
#
# Exits 1 if a row or table was lost, or the static run failed. "Changed" lines
# are values a migration rewrote: read them against that release's migrations.
# Reports and files go to $UPGRADE_CHECK_DIR (default: a new temp directory).
# The release worktree gets its own lockfile's node_modules: borrowed from this
# checkout when the lockfiles match, else installed once and cached (#1297).
set -euo pipefail

tag="${1:-}"; what="${2:-all}"
case "$tag" in -h|--help|"") sed -n '2,20p' "$0"; [ -n "$tag" ]; exit $? ;; esac
case "$what" in hosted|static|all) ;; *) echo "Unknown check: $what" >&2; exit 2 ;; esac

cd "$(dirname "$0")/../.."
repo="$PWD"
# shellcheck source=../lib/release-deps.sh
. scripts/lib/release-deps.sh
git rev-parse --verify --quiet "$tag^{commit}" >/dev/null || { echo "Unknown tag: $tag" >&2; exit 2; }

work="${UPGRADE_CHECK_DIR:-$(mktemp -d -t heirloom-upgrade-XXXX)}"
mkdir -p "$work"
release="$work/release"
container=""
cleanup() {
  [ -n "$container" ] && "$engine" rm -f "$container" >/dev/null 2>&1 || true
  git -C "$repo" worktree remove --force "$release" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git worktree add --detach --quiet "$release" "$tag"
release_node_modules "$repo" "$release" "$tag"
echo "Release $tag (schema $(sed -n 's/^export const SCHEMA_VERSION = \([0-9]*\);.*/\1/p' "$release/lib/db/init-schema.ts"))" \
  "→ candidate $(git rev-parse --short HEAD) (schema $(sed -n 's/^export const SCHEMA_VERSION = \([0-9]*\);.*/\1/p' lib/db/init-schema.ts)); files in $work"

status=0
tsx="$repo/node_modules/.bin/tsx"

if [ "$what" = hosted ] || [ "$what" = all ]; then
  engine="$(command -v podman || command -v docker || true)"
  [ -n "$engine" ] || { echo "hosted needs podman or docker" >&2; exit 2; }
  port="${UPGRADE_CHECK_PG_PORT:-5439}"
  container="heirloom-upgrade-check-$$"
  # A non-UTC server zone, so a zone-less timestamp converted the wrong way shows.
  "$engine" run -d --rm --name "$container" -e POSTGRES_PASSWORD=upgrade -e POSTGRES_DB=upgrade \
    -e TZ=America/Toronto -p "127.0.0.1:$port:5432" docker.io/library/postgres:16-alpine >/dev/null
  for _ in $(seq 1 60); do "$engine" exec "$container" pg_isready -q -U postgres 2>/dev/null && break; sleep 1; done
  sleep 2 # the image restarts once after initdb

  export DATABASE_URL="postgres://postgres:upgrade@127.0.0.1:$port/upgrade" DATA_DIR="$work/hosted-data" TZ=America/Toronto
  email=upgrade-check@example.test
  node scripts/ux-audit/gen-large-gedcom.mjs --out "$work/large-tree.ged" >/dev/null
  echo "== Hosted: seeding with $tag"
  (cd "$release" && "$tsx" scripts/init-db.ts >/dev/null \
    && "$tsx" scripts/seed-synthetic-data.ts hosted --email "$email" >/dev/null \
    && "$tsx" --tsconfig tsconfig.json "$repo/scripts/upgrade-check/hosted.ts" seed-large "$work/large-tree.ged" "$email" \
    && "$tsx" --tsconfig tsconfig.json "$repo/scripts/upgrade-check/hosted.ts" snapshot "$work/hosted-before")
  echo "== Hosted: upgrading with the candidate"
  "$tsx" scripts/upgrade-check/hosted.ts snapshot "$work/hosted-after"
  "$tsx" scripts/upgrade-check/hosted.ts compare "$work/hosted-before" "$work/hosted-after" || status=1
  echo "Release export zips imported into the candidate:"
  for zip in "$work"/hosted-before/tree-*.zip; do
    "$tsx" scripts/upgrade-check/hosted.ts import-zip "$zip" "$work/reimport-$(basename "$zip" .zip)" || status=1
  done
  unset DATABASE_URL DATA_DIR TZ
  "$engine" rm -f "$container" >/dev/null; container=""
fi

if [ "$what" = static ] || [ "$what" = all ]; then
  echo "== Static: building $tag and the candidate"
  (cd "$release" && npm run build:static >"$work/build-release.log" 2>&1) & old_build=$!
  npm run build:static >"$work/build-candidate.log" 2>&1 & new_build=$!
  wait "$old_build" || { echo "release build failed: $work/build-release.log" >&2; exit 1; }
  wait "$new_build" || { echo "candidate build failed: $work/build-candidate.log" >&2; exit 1; }
  echo "== Static: driving Chromium"
  "$tsx" scripts/upgrade-check/static.ts "$release/out" "$repo/out" "$repo/test-fixtures/synthetic.hlbak" "$work/static" || status=1
fi

echo; [ "$status" = 0 ] && echo "Upgrade check passed. Files: $work" || echo "Upgrade check FAILED. Files: $work"
exit "$status"
