// Classifies a pull request's changed files so CI can skip the test jobs for
// PRs that cannot change the app (#75):
//
// - version_only: the PR is release bookkeeping. It changes a version bump
//   (exactly `package.json` and `package-lock.json`, and only their version
//   fields), the What's new changelog (`lib/whats-new/changelog.json`), or
//   both. The package JSON is compared parsed, with those fields removed, so a
//   dependency change hidden in the same PR still runs everything. The
//   changelog must pass the checks its unit test makes, since that test is
//   skipped with the rest.
// - docs_only: every changed file is Markdown or under `docs/`.
//
// The workflow has no `paths` filter, because a filtered-out run never reports
// its required checks; a skipped job does report, as passing.

const DOC_FILE = /(^docs\/)|(\.md$)/;
const CHANGELOG = 'lib/whats-new/changelog.json';
const RELEASE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

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

function isVersionBump(read) {
  const pairs = [
    ['package.json', stripPackageVersion],
    ['package-lock.json', stripLockVersion],
  ];
  return pairs.every(([path, strip]) => {
    const base = parseOrNull(read(path, 'base'));
    const head = parseOrNull(read(path, 'head'));
    return Boolean(base && head && sameJson(strip(base), strip(head)));
  });
}

function compareReleases(a, b) {
  const pa = RELEASE_VERSION.exec(a).slice(1).map(Number);
  const pb = RELEASE_VERSION.exec(b).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

const optionalString = value => value === undefined || typeof value === 'string';

function isValidItem(item) {
  return Boolean(item) && typeof item.en === 'string' && item.en.trim() !== ''
    && optionalString(item.fr) && optionalString(item.ru);
}

/**
 * Mirrors what the skipped jobs check: the `changelog.json` test in
 * __tests__/unit/whats-new.test.ts, and the `ChangelogEntry` type tsc holds it to.
 */
function isValidChangelog(text) {
  const entries = parseOrNull(text);
  if (!Array.isArray(entries)) return false;
  return entries.every((e, i) => Boolean(e)
    && typeof e.version === 'string' && RELEASE_VERSION.test(e.version)
    && Array.isArray(e.items) && e.items.every(isValidItem)
    && (i === 0 || compareReleases(entries[i - 1].version, e.version) > 0));
}

/**
 * @param {string[]} files changed paths
 * @param {(path: string, side: 'base' | 'head') => string | null} read file text on each side
 * @returns {{ versionOnly: boolean, docsOnly: boolean }}
 */
export function classifyPrChanges(files, read) {
  const docsOnly = files.length > 0 && files.every(f => DOC_FILE.test(f));

  const changesChangelog = files.includes(CHANGELOG);
  const others = files.filter(f => f !== CHANGELOG).sort();
  const bumpsVersion = others.length === 2
    && others[0] === 'package-lock.json'
    && others[1] === 'package.json';

  const versionOnly = (bumpsVersion || (changesChangelog && others.length === 0))
    && (!bumpsVersion || isVersionBump(read))
    && (!changesChangelog || isValidChangelog(read(CHANGELOG, 'head')));

  return { versionOnly, docsOnly };
}
