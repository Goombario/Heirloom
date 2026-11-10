// Pure helpers for the migration-artifact census. No filesystem/IO here so
// they stay unit-testable; the .mjs scripts that walk files import these.

/** Unique class names appearing as `.name` selectors in a CSS string. */
export function extractCssClassSelectors(css) {
  const names = new Set();
  const re = /\.(-?[a-zA-Z_][a-zA-Z0-9_-]*)/g;
  let m;
  while ((m = re.exec(css))) names.add(m[1]);
  return [...names];
}

/** True if `className` appears as a whole token (not a substring) in `corpus`. */
export function isClassReferenced(className, corpus) {
  const escaped = className.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  // Token boundary: not preceded/followed by a word char or hyphen, so
  // `card` does not match `card-interactive` or `my-card`.
  const re = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`);
  return re.test(corpus);
}

/** Files at/over `threshold` lines, sorted by line count descending. */
export function rankOversized(files, threshold) {
  return files
    .filter((f) => f.lines >= threshold)
    .sort((a, b) => b.lines - a.lines);
}

/** knip issue keys present now but not in the committed baseline. */
export function diffKnip(baselineKeys, currentKeys) {
  const base = new Set(baselineKeys);
  return currentKeys.filter((k) => !base.has(k));
}

/** Normalize knip's JSON report (v6: everything under `issues[]`) into a stable, sorted set of issue keys. */
export function knipIssueKeys(report) {
  const keys = [];
  for (const entry of report.issues ?? []) {
    const file = entry.file ?? '';
    // Unused files: knip v6 lists them under entry.files (no top-level files array).
    for (const item of entry.files ?? []) {
      keys.push(`file:${typeof item === 'string' ? item : item.name}`);
    }
    for (const type of ['dependencies', 'devDependencies', 'exports', 'types', 'unlisted', 'binaries']) {
      for (const item of entry[type] ?? []) {
        keys.push(`${type}:${file}:${typeof item === 'string' ? item : item.name}`);
      }
    }
  }
  return keys.sort();
}
