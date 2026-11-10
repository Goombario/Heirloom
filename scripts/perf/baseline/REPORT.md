# Performance audit — baseline report

**Date:** 2026-07-17 · **Commit:** `0b0d7da` (branch `perf/audit-harness` off `dev`)
**Dataset:** a private family GEDCOM — **2,294 people / 867 families** in a dedicated
`genealogy_perf` Postgres (Docker, :5433).
**Build:** production (`next build` + `next start`), `DESKTOP_MODE=true`.
**Browser metrics:** Chrome DevTools performance traces, 1× CPU, no network
throttle, cold reload (lab/observed).

> GEDCOM import/export benchmarking is **deferred** (import revamp in progress).
> The GEDCOM was used only to seed the dataset.

## Baseline

### API latency — round-trip, warm (ms) unless noted

| Endpoint | payload | cold | p50 | p95 | p99 |
|----------|--------:|-----:|----:|----:|----:|
| `GET /api/people` | **1.8 MB** | 488 | **502** | **552** | 559 |
| `GET /api/families` | 679 KB | 66 | 62 | 74 | 75 |
| `GET /api/places` | 411 KB | 32 | 22 | 28 | 29 |
| `GET /api/tree` (descendants) | 387 KB | 57 | 36 | 56 | 357 |
| `GET /api/tree` (ancestors) | 356 KB | 35 | 34 | 42 | 44 |
| `GET /api/tree` (focus) | 420 KB | 33 | 35 | 40 | 42 |
| `GET /api/people/search?q=` | 2 KB | 13 | 8 | 10 | 10 |
| `GET /api/families/search?q=` | 6 KB | 13 | 10 | 13 | 13 |
| `GET /api/people/{id}` | 3 KB | 17 | 7 | 8 | 8 |

### Core Web Vitals — page load (lab, cold reload)

| Route | LCP | CLS | TTFB | render delay | note |
|-------|----:|----:|-----:|-------------:|------|
| `/families` | **1352 ms** | 0.00 | 206 | 1146 | DOMSize insight fired — 867 cards |
| `/people` | **912 ms** | 0.00 | 234 | 678 | 1.8 MB payload + 2,294 rows |
| `/people/view?id=` | 298 ms | 0.00 | 7 | 292 | healthy |
| `/tree` (252-node root) | 288 ms | 0.00 | 8 | 281 | healthy |
| `/places` | 118 ms | 0.00 | 6 | 112 | healthy |
| `/cases` | — | — | — | — | empty-state only (0 cases) |

### Tree layout compute (pure d3, no render) & media upload

| Tree mode | nodes | p50 | p95 | | Upload | source | p50 | p95 |
|-----------|------:|----:|----:|-|--------|-------:|----:|----:|
| descendants | 252 | 0.29 ms | 1.7 ms | | ~2 MP photo | 2.9 MB | 60 ms | 99 ms |
| focus | 252 | 0.36 ms | 0.75 ms | | near-10 MB | 8.5 MB | 142 ms | 170 ms |

## Findings (ranked by user impact)

### 1. List pages render the entire result set client-side — no pagination or virtualization
`/families` (LCP **1352 ms**, DOMSize insight) and `/people` (LCP **912 ms**)
are the two slowest routes, and both are dominated by **render delay** (1146 ms
/ 678 ms), not network. They fetch every row and build every DOM node up front.
This scales **linearly with tree size** — at 2,294 people it's ~0.9–1.4 s; at
5–10k it will breach the 2.5 s LCP threshold and INP will suffer on filter/scroll.
**Fix:** server-side pagination or list virtualization (e.g. windowing). Highest
leverage — addresses the worst two routes at once.

### 2. `GET /api/people` over-fetches — 1.8 MB / ~500 ms p50
The single slow endpoint (p95 552 ms, ~800 bytes/person × 2,294). It returns the
full record set for a list view. This is both the network half of finding #1 and
a standalone cost (the list page, global search seed, pickers all pay it).
**Fix:** paginate + trim the payload to list-needed columns; push search/filter
server-side so the client never loads all 2,294 at once.

### 3. Everything else is healthy at this scale
Tree API 33–57 ms; **tree layout compute is sub-millisecond** (so any tree
slowness is React Flow *rendering*, never the d3 math); person detail 298 ms;
places 118 ms; search <15 ms; media upload+compression 60–142 ms. No CLS anywhere
(0.00 across the board). No action needed.

## Gaps this run did NOT cover (honest scope)

- **INP / interaction latency & tree pan-zoom FPS** — only load-time CWV was
  driven; no interactions were scripted. Procedure documented in `README.md`.
- **Tree at the largest subtree** — measured the default root (252-node subtree).
  Render is healthy there; re-check against the deepest/widest root before
  declaring the tree safe at scale.
- **`/cases`** — dataset has 0 cases; only the empty state was observable.
- **Static / PGlite build** (Cloudflare/Tauri) — not measured; hosted Postgres
  path only. Different perf profile (single-connection IndexedDB); see README.
- **Concurrency / load** — single-client latency only; no parallel-user or
  pool-saturation test.
- **GEDCOM import/export** — deliberately deferred (revamp in progress).

## Suggested thresholds to hold in CI (once addressed)

`api p95 < 400 ms`, `LCP < 2500 ms`, `CLS < 0.1`, `tree layout p95 < 250 ms`.
Current breaches: `/api/people` p95 (552 ms). `/families` & `/people` LCP are
under 2.5 s **today** but trend toward it as the tree grows — the finding is the
linear scaling, not today's absolute number.

---

## Fix results — findings #1 & #2 (pragmatic scope)

Applied on branch `perf/audit-harness`; server-side pagination deferred to
issue #289. Same dataset, production build, cold reload.

| Metric | Before | After | Δ |
|--------|-------:|------:|---|
| `/families` LCP | 1352 ms | **655 ms** | **−52 %** (DOMSize insight gone) |
| `/families` rows in DOM | 867 | **50** | pagination (50/page) |
| `GET /api/people` p50 | 502 ms | **152 ms** | **−70 %** |
| `GET /api/people` p95 | 552 ms (flagged) | **174 ms** | flag cleared |
| `GET /api/people` payload | 1805 KB | **1420 KB** | −21 % |
| `GET /api/families` p50 | 62 ms | **42 ms** | −32 % |
| `/people` LCP | 912 ms | 859 ms | −6 % |

**What moved:**
- **Finding #1 (render):** Families gained 50/page pagination (parity with People) → LCP −52 %, DOMSize insight eliminated, 50 DOM rows instead of 867.
- **Finding #2 (payload/SQL):** dropping the two parent-photo lateral joins from `getAllPeople` cut its p50 by **70 %** (far more than the 21 % payload trim alone — the joins were the real cost); dropping redundant `partner1Name/partner2Name` computations sped `getAllFamiliesWithSpouses` ~32 %.
- **`/people` LCP barely moved (−6 %)** — expected: its LCP is bound by client-side processing of all 2,294 rows (search/sort/surname facet), which the pragmatic scope intentionally kept. Flattening that needs the server-side work in #289. The people win here is the **API** (used by pickers, global search, SSR seed), not the page paint.

CLS stayed 0.00 everywhere; all list search/filter/sort/facet UX unchanged.
