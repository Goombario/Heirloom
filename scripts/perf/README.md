# Performance harness

A repeatable, pinned performance baseline for the app. Measures what actually
matters here — **server API latency on a large tree, pure d3 tree-layout compute
cost, and browser Core Web Vitals** — against a realistic dataset, from a
**production build** (dev-server timings are meaningless).

> **Scope note:** GEDCOM import/export benchmarking is intentionally **out of
> scope** — that path is being revamped to cut SQL calls, so any number would be
> stale by design. The import is used only to *seed* the perf DB (see below).

## What it measures

| Bench | File | What it isolates |
|-------|------|------------------|
| API latency | `bench-api.mjs` | Round-trip per hot endpoint (cold vs warm p50/p95/p99) + payload size. Localhost round-trip ≈ server + DB + serialization, so it surfaces N+1 relationship-resolution cost. |
| Local photo upload | `bench-local-upload.mjs` | Adds N photos through Library → Upload in the static build (Chromium; WebKit where Playwright's WebKit runs) and times each photo. Later photos taking longer than early ones means a per-photo IndexedDB flush (#1259). Needs a current `out/`; not part of `run-all`. |
| Tree layout | `bench-tree-layout.ts` | The **pure d3 position math** (`getLayoutMode().compute()`) with no browser — separates layout CPU from React Flow render. |
| Core Web Vitals | Chrome DevTools (manual/MCP procedure below) | LCP / CLS / INP / TTFB per heavy route, tree render, pan/zoom FPS, memory. |

Thresholds and the endpoint/route lists live in `config.mjs`. Baseline results
are committed under `baseline/` — diff them across runs to catch regressions.

## Prerequisites

- Node 24+, a running Postgres. This repo's disposable Docker Postgres works:
  `docker ps` should show a container on port **5433**.
- A **dedicated perf database** so real dev data is never touched:
  ```bash
  docker exec heirloom-test-db psql -U postgres -c "CREATE DATABASE genealogy_perf"
  ```
- A large GEDCOM to seed from (2k+ people recommended).

Two env vars drive every step:

```bash
export PERF_DB_URL="postgresql://postgres:testpassword@localhost:5433/genealogy_perf"
export PERF_BASE_URL="http://localhost:3000"
```

## Run it (full audit)

```bash
# 1. Build a production bundle against the perf DB
DATABASE_URL="$PERF_DB_URL" DESKTOP_MODE=true npm run build

# 2. Start the production server (DESKTOP_MODE bypasses OAuth so the harness can
#    hit APIs; perf DB keeps real data safe)
DATABASE_URL="$PERF_DB_URL" DESKTOP_MODE=true PORT=3000 npm start &

# 3. Seed the large tree (import path used only to load data — not timed)
node scripts/perf/seed.mjs /path/to/large.ged

# 4. Run the scriptable benches → writes baseline/*.json + summary.json
node scripts/perf/run-all.mjs

# 5. Core Web Vitals (browser) — see procedure below, writes baseline/cwv.json
```

Individual benches:

```bash
node scripts/perf/bench-api.mjs           # API latency only
npx tsx scripts/perf/bench-tree-layout.ts # tree layout compute only
PHOTOS=100 BROWSERS=chromium node scripts/perf/bench-local-upload.mjs # local photo upload
```

Tuning knobs (env): `PERF_SAMPLES` (default 30), `PERF_WARMUP` (3),
`PERF_LAYOUT_ITER` (50).

## Core Web Vitals procedure (browser)

CWV, render timing, FPS, and memory need a real browser. Drive Chrome against
the **already-running production build** (do not boot a second `next dev`):

1. For each route in `config.mjs → BROWSER_ROUTES`, run a Lighthouse audit (or a
   performance trace) navigating to `PERF_BASE_URL + path`.
2. Record LCP, CLS, INP/TBT, TTFB per route.
3. On `/tree` with the large tree: fit-view + zoom out so all nodes mount (React
   Flow culls offscreen nodes), then drive a continuous pan+zoom with a `rAF`
   frame sampler (see `baseline/tree-fps.json` for the captured method + result).
   Sample at 1x and at 4x CPU throttle (mid-tier mobile). Report avg FPS, p95/max
   frame time, and jank-frame count (>16.7ms / >33ms).
4. Save the numbers into `baseline/cwv.json` (shape mirrors the other envelopes:
   `{ kind, meta, timestamp, results: [{ key, path, lcp_ms, cls, inp_ms, ttfb_ms }] }`).
   `run-all.mjs` folds that file into `summary.json` automatically.

This can be done with the Chrome DevTools MCP (`lighthouse_audit`,
`performance_start_trace`) or DevTools by hand — the numbers are what matter, not
the tool.

## Files

```
scripts/perf/
  config.mjs             routes, endpoints, iteration counts, thresholds
  lib/stats.mjs          percentiles, summaries, result envelope writer
  seed.mjs               load a GEDCOM into the perf DB (seed only, not timed)
  bench-api.mjs          API latency bench
  bench-tree-layout.ts   pure d3 layout-compute bench
  bench-local-upload.mjs local-build photo upload bench (#1259)
  run-all.mjs            orchestrator → baseline/summary.json
  baseline/              committed baseline results (the pin)
```
