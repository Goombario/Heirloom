// Classifies a pull request's changed files so CI can skip the test jobs for
// PRs that cannot change the app (#75):
//
// - version_only: the PR changes exactly `package.json` and `package-lock.json`,
//   and only their version fields (a release bump). The JSON is compared parsed,
//   with those fields removed, so a dependency change hidden in the same PR
//   still runs everything.
// - docs_only: every changed file is Markdown or under `docs/`.
//
// The workflow has no `paths` filter, because a filtered-out run never reports
// its required checks; a skipped job does report, as passing.

const DOC_FILE = /(^docs\/)|(\.md$)/;

/** Drops the fields a version bump may change, so the rest can be compared. */
function stripPackageVersion(pkg) {
  const { version: _version, ...rest } = pkg;
  return rest;
}

function stripLockVersion(lock) {
  const { version: _version, packages, ...rest } = lock;
  if (!packages || typeof packages !== 'object') return rest;
  const { '': root, ...others } = packages;
  if (!root || typeof root !== 'object') return { ...rest, packages: others };
  const { version: _rootVersion, ...rootRest } = root;
  return { ...rest, packages: { ...others, '': rootRest } };
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function parseOrNull(text) {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * @param {string[]} files changed paths
 * @param {(path: string, side: 'base' | 'head') => string | null} read file text on each side
 * @returns {{ versionOnly: boolean, docsOnly: boolean }}
 */
export function classifyPrChanges(files, read) {
  const docsOnly = files.length > 0 && files.every(f => DOC_FILE.test(f));

  const sorted = [...files].sort();
  let versionOnly = sorted.length === 2
    && sorted[0] === 'package-lock.json'
    && sorted[1] === 'package.json';

  if (versionOnly) {
    const pairs = [
      ['package.json', stripPackageVersion],
      ['package-lock.json', stripLockVersion],
    ];
    for (const [path, strip] of pairs) {
      const base = parseOrNull(read(path, 'base'));
      const head = parseOrNull(read(path, 'head'));
      if (!base || !head || !sameJson(strip(base), strip(head))) {
        versionOnly = false;
        break;
      }
    }
  }

  return { versionOnly, docsOnly };
}
