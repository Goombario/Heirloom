/**
 * Central configuration for the performance harness.
 *
 * Everything the benches need — target URL, iteration counts, the list of hot
 * endpoints, the browser routes to audit, and the pass/fail thresholds — lives
 * here so a run is fully described by one file. Change the dataset or the app
 * and you re-run against the same definitions.
 */

export const BASE_URL = process.env.PERF_BASE_URL ?? 'http://localhost:3000';

/** Warm iterations discarded before measuring, then measured samples per endpoint. */
export const WARMUP = Number(process.env.PERF_WARMUP ?? 3);
export const SAMPLES = Number(process.env.PERF_SAMPLES ?? 30);

/**
 * Hot server endpoints. `dynamicId: 'person'` means the runner substitutes a
 * real person id discovered from the people list at run time (detail routes).
 * `warmOnly` endpoints are excluded from the cold-vs-warm delta table.
 */
export const API_ENDPOINTS = [
  { key: 'tree:descendants', path: '/api/tree?mode=descendants' },
  { key: 'tree:ancestors', path: '/api/tree?mode=ancestors' },
  { key: 'tree:focus', path: '/api/tree?mode=focus' },
  { key: 'people:list', path: '/api/people' },
  { key: 'families:list', path: '/api/families' },
  { key: 'places:list', path: '/api/places' },
  { key: 'people:search', path: '/api/people/search?q=john' },
  { key: 'families:search', path: '/api/families/search?q=smith' },
  { key: 'person:detail', path: '/api/people/{person}', dynamicId: 'person' },
];

/** Browser routes audited for Core Web Vitals (driven via Chrome DevTools). */
export const BROWSER_ROUTES = [
  { key: 'tree', path: '/tree' },
  { key: 'people', path: '/people' },
  { key: 'families', path: '/families' },
  { key: 'places', path: '/places' },
  { key: 'cases', path: '/cases' },
  { key: 'person-detail', path: '/people/view?id={person}', dynamicId: 'person' },
];

/** Layout modes exercised by the pure d3-compute bench (render excluded). */
export const TREE_MODES = ['descendants', 'ancestors', 'focus'];

/**
 * Pass/fail thresholds (ms unless noted). A metric over its threshold is a
 * finding. Deliberately conservative for a self-hosted app on a large tree.
 */
export const THRESHOLDS = {
  api_p95_ms: 400, // any hot endpoint warm p95 over this is flagged
  api_cold_ms: 1500, // cold first-hit over this is flagged
  tree_layout_ms: 250, // pure d3 layout compute per mode
  lcp_ms: 2500,
  cls: 0.1,
  inp_ms: 200,
  ttfb_ms: 800,
};

export const OUT_DIR = 'scripts/perf/baseline';
