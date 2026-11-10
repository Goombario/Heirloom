/**
 * Small, dependency-free statistics + result-writing helpers shared by the
 * benches. Percentiles use the nearest-rank method (standard and stable for the
 * modest sample counts this harness collects).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';

/** Nearest-rank percentile. `p` in [0,100]. Returns null for an empty sample. */
export function percentile(samples, p) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

export function summarize(samples) {
  if (!samples.length) return { n: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: round(sorted[0]),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1]),
    mean: round(sum / sorted.length),
  };
}

export const round = (n) => (n == null ? null : Math.round(n * 100) / 100);

/** Time a single async call, returning { ms, value }. */
export async function timed(fn) {
  const t0 = performance.now();
  const value = await fn();
  return { ms: performance.now() - t0, value };
}

/** Git commit + node version stamp for the result envelope. */
export function runMeta(extra = {}) {
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    /* not in a git repo — leave 'unknown' */
  }
  return {
    commit,
    node: process.version,
    // NOTE: timestamp is intentionally injected by the caller (not stamped
    // here) so runs are reproducible and diffable.
    ...extra,
  };
}

export function writeResult(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** Fixed-width console table row for terminal reports. */
export function padCols(cols, widths) {
  return cols.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
}
