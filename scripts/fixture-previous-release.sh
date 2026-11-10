#!/usr/bin/env bash
# Cut a previous-release database fixture for the upgrade test (#811):
# test-fixtures/schema-v<N>.hlbak, where N is that release's SCHEMA_VERSION.
# It runs the release's own synthetic-fixture generator from a temporary git
# worktree at <tag>, so the file holds exactly the schema and rows that release
# wrote. __tests__/unit/schema-upgrade.pglite.test.ts upgrades every such file.
#
# Usage: scripts/fixture-previous-release.sh <tag>      e.g. v0.23.0
#
# The worktree gets its own lockfile's node_modules: borrowed from this checkout
# when the lockfiles match, else installed once and cached (#1297).
set -euo pipefail

tag="${1:-}"
case "$tag" in
  -h|--help|"") sed -n '2,11p' "$0"; [ -n "$tag" ]; exit $? ;;
esac

cd "$(dirname "$0")/.."
repo="$PWD"
# shellcheck source=lib/release-deps.sh
. scripts/lib/release-deps.sh
git rev-parse --verify --quiet "$tag^{commit}" >/dev/null || { echo "Unknown tag: $tag" >&2; exit 2; }

work="$(mktemp -d)"
cleanup() { git -C "$repo" worktree remove --force "$work/tree" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

git worktree add --detach --quiet "$work/tree" "$tag"
release_node_modules "$repo" "$work/tree" "$tag"

version="$(sed -n 's/^export const SCHEMA_VERSION = \([0-9]*\);.*/\1/p' "$work/tree/lib/db/init-schema.ts")"
[ -n "$version" ] || { echo "No SCHEMA_VERSION in $tag's lib/db/init-schema.ts" >&2; exit 1; }
out="$repo/test-fixtures/schema-v$version.hlbak"

(cd "$work/tree" && npx tsx scripts/seed-synthetic-data.ts static --output "$work/fixture.hlbak")
mv "$work/fixture.hlbak" "$out"
echo "Wrote ${out#"$repo"/} ($tag, schema $version)"
