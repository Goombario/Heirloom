# Data checks — browser performance

> Status: **Measured** 2026-09-26 (#842, tracking #840)
>
> The budget and the "make it faster, don't store results" rule are in
> [ADR 0021](../decisions/0021-data-checks-are-computed-and-fixed-in-place.md). This page
> records what the engine costs in the static build, where it runs in the browser.

## Budget

The checks engine (`runDataChecks`) runs over the whole tree on every page that shows checks,
and must stay **under 300 ms in the browser** (median, unthrottled). A 4× CPU-throttled run is
information only, unless the engine passes 1 s there. If it misses, make `lib/data-checks/`
faster; don't store results. The Node benchmark in
`__tests__/unit/data-checks-large-tree.pglite.test.ts` guards the same budget in CI.

## Method

- Static build (`npm run build:static`, served from `out/`), Chromium 149 on Linux at default
  CPU, one browser context.
- The large fixture (`npm run fixture:large-gedcom`: 4,824 people, 964 families) imported
  through the Import page into a fresh tree. 1,205 entries, with the #841 engine. The
  generator now appends 10 people with one planted unlikely problem per rule, so a fresh
  tree has 4,834 people and 1,210 entries; the random records measured here are unchanged.
- Timed with `performance.now()` inside `listDataChecksService`, instrumented temporarily and
  not committed: **load** is `getDataCheckInput` (the PGlite reads), and **engine** is
  `runDataChecks` alone.
- Five full page loads per page, taking the median of the first service call on each load.
  Then one load per page with CDP `Emulation.setCPUThrottlingRate` at 4.

## Results

| Page | Engine, median (5 loads) | Load + engine, median | Engine, 4× CPU | Load + engine, 4× CPU |
|---|---|---|---|---|
| Home ("Dates to check" card) | 27.9 ms | 829 ms | 106 ms | 1,054 ms |
| `/data-checks` | 29.4 ms | 209 ms | 110 ms | 345 ms |
| Mary Ellen's person page (@I2245@) | 28.7 ms | 265 ms | 96 ms | 427 ms |

Unthrottled engine runs ranged from 22 to 35 ms. The engine is about a tenth of its budget,
and about a third of it at 4× CPU, so no change was needed.

Notes:

- **The data load, not the engine, is the cost.** On home it's about 800 ms, most likely because
  the card's reads queue in the one PGlite worker behind the other home-page queries. On `/data-checks`,
  where the checks are the page's only reads, it's about 180 ms.
- The person page calls the service twice per load. Both calls run the whole engine.
- Re-measure after a change to `lib/data-checks/engine.ts` or `getDataCheckInput` that adds a
  per-person or per-family scan, or when the large fixture grows.

## Home card (#852)

> Measured 2026-10-23, same fixture imported through the Import page, static build served
> with `vite preview`, the sandbox's Chromium, unthrottled. Every `query()` call was timed
> temporarily (when it was queued, when it got the worker, when it returned; not committed),
> and Home was loaded eight times per build, the first load dropped as cold.

**Cause, confirmed.** The PGlite client runs one query at a time (`acquire()` in
`lib/db/connection.pglite.ts`), so every read on a page shares one FIFO queue. Home starts the
dashboard, the suggestions and the checks at once. `getDataCheckInput` awaited its four reads
one after another, and `listDataChecksService` then awaited the confirmations, so each of the
card's five reads joined the back of the queue only after the previous one returned. By then the
dashboard had queued its next read, so the card's reads alternated with the dashboard's and the
card finished last. On `/data-checks` nothing else is queued, so the same five reads run back to
back.

**Fix.** The four reads, and the confirmations beside them, are issued together with
`Promise.all`. They join the queue in one block and run back to back. Hosted Postgres runs them
on separate pool connections, which also helps. No results are stored (ADR 0021).

| Home, median of 7 warm loads | Before | After |
|---|---|---|
| `listDataChecksService` data load | 1,308 ms | 1,078 ms |
| Card's data ready (from the page's first query) | 1,570 ms | 1,327 ms |
| Rest of the page's reads done | 1,484 ms | 1,583 ms |

Before, the card was always the last thing on Home to get its data, about 90 ms after the rest.
After, it is ready about 250 ms **before** the rest, which meets #852's acceptance. The
dashboard's last reads move back by about as much as the card gains, as expected from one
queue.

Also seen, not changed here:

- **Every query costs at least about 50–70 ms** in the static build, even
  `SELECT EXISTS (SELECT 1 FROM "People")`. Most of a page's load time is the number of
  round trips, not the SQL. On Home the start-up reads repeat: the `hasData` check runs four
  times and the default-tree lookup four times (one per service's `resolveTreeScope`), about
  0.5 s of the queue before any page data. Worth its own issue.
- The absolute numbers vary a lot between sessions (the place and duplicate reads took 400 ms
  in one session and 90 ms in another on the same data), so compare before and after in the
  same session and profile, as above.
- **The person page still loads its checks twice.** `useDataCheckMarks` refetches whenever its
  `reloadKey` (the person record) changes, and the record object changes once from the cached
  copy to the fresh one even when nothing in it did. Each call runs the whole engine
  (about 30 ms) plus the reads. A follow-up could key the refetch on the person's dates.
