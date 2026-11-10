# Sourced by scripts that run an older release's code from a git worktree
# (scripts/upgrade-check/run.sh, scripts/fixture-previous-release.sh).
#
# release_node_modules <repo> <worktree> <tag>
#   Gives <worktree> the node_modules its own package-lock.json installs (#1297).
#   When the tag's lockfile matches this checkout's, it borrows <repo>/node_modules.
#   Otherwise it runs `npm ci --ignore-scripts` once per lockfile and keeps the result
#   in $HEIRLOOM_RELEASE_DEPS_CACHE (default ~/.cache/heirloom/release-deps/<hash>),
#   so the next run against the same release links it instead of reinstalling.
#   --ignore-scripts: the project's postinstall runs db:init against whatever
#   DATABASE_URL is set, and the native packages ship prebuilt optional binaries.
#   Delete the cache folder to reclaim the space.
release_node_modules() {
  local repo="$1" tree="$2" tag="$3"
  if git -C "$repo" show "$tag:package-lock.json" | cmp -s - "$repo/package-lock.json"; then
    ln -s "$repo/node_modules" "$tree/node_modules"
    echo "$tag: same package-lock.json as this checkout; borrowing its node_modules"
    return
  fi
  local root="${HEIRLOOM_RELEASE_DEPS_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/heirloom/release-deps}"
  local key cache
  key="$(git -C "$repo" show "$tag:package-lock.json" | sha256sum | cut -c1-16)"
  # The folder must be named node_modules: Node finds a package's hoisted
  # dependencies by walking up from its real path to a node_modules folder.
  cache="$root/$key/node_modules"
  if [ ! -d "$cache" ]; then
    echo "$tag: installing its own dependencies (npm ci, cached in $cache)"
    mkdir -p "$root/$key"
    # The log goes beside the cache: callers delete the worktree on exit.
    (cd "$tree" && npm ci --ignore-scripts --no-audit --no-fund >"$root/$key/npm-ci.log" 2>&1) \
      || { echo "npm ci failed for $tag; see $root/$key/npm-ci.log" >&2; return 1; }
    # Move into place in one step, so an interrupted install never looks cached.
    mv "$tree/node_modules" "$cache.partial.$$" && mv "$cache.partial.$$" "$cache"
  else
    echo "$tag: using cached dependencies in $cache"
  fi
  ln -s "$cache" "$tree/node_modules"
}
