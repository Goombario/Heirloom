# 0008 — The overwrite-import gate counts every table the wipe clears

**Date:** 2026-07-10 (recorded 2026-08-01)
**Status:** Accepted
**Area:** gedcom

## Context

The overwrite-import confirm dialog claimed to report what was *"currently in your tree"*, but
the numbers came from parsing the **selected GEDCOM file**, not from querying the database.
Two bugs in one: the figures shown were the file's counts mislabelled, and the warning fired
whenever `mode === 'overwrite'` even on a completely empty tree.

The first fix read live counts and skipped the confirm when the tree was empty — but counted
only people/families/events/sources/media/cases. Overwrite **also** deletes `Places`, `Note`,
`Repository` and `Citation`. So a tree holding only standalone repositories (creatable from
the Library with no people at all), or only a geocoded gazetteer, counted as "empty" and was
wiped **with no confirmation at all**.

## Decision

`getTreeCountsService` counts **all ten tables that the overwrite `DELETE` block clears**, and
a lockstep test (`__tests__/unit/tree-counts-lockstep.test.ts`) parses both source files and
fails if the two lists ever drift.

The pure `gateOverwriteImport()` (`lib/gedcom/overwrite-gate.ts`) treats any non-zero value —
**negative, `NaN`, or an unrecognised field** — as "not empty". Unknown state confirms rather
than wipes.

## Rejected alternatives

- **Count only the headline entities.** This is the bug. "Empty" must mean *nothing the delete
  will touch*, not *nothing the user probably cares about*.
- **Always confirm, never gate.** Safe but noisy, and trains users to click through the
  confirm — which is worse than no confirm on the day it matters.
- **Trust the parsed file counts.** Cheaper (no DB round trip), but it answers a different
  question entirely.

## Consequences

- **Adding a table to the overwrite `DELETE` block requires adding it to the counts service.**
  The lockstep test enforces this; do not silence it by editing the expectation.
- Fails safe by construction: when counts cannot be read, it confirms anyway with count-less
  copy (`overwrite_confirm_body_no_counts`, en/fr/ru).
- Covered on both engines (`tree-counts-pglite.test.ts` + `__tests__/integration/tree-counts.test.ts`)
  because the static/Tauri build runs the service in-browser.
