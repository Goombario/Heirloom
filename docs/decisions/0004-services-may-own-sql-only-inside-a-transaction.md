# 0004 — Services may own SQL, but only inside a transaction

**Date:** 2026-07-20 (cleanup-audit item 14; recorded 2026-08-01)
**Status:** Accepted
**Area:** architecture

## Context

The stated rule was that all SQL lives in `lib/db/queries/`. In practice several services ran
SQL directly, and the rule was being cited to justify extracting statements that genuinely
could not be extracted — multi-statement bulk inserts and wipes that only make sense as one
atomic unit (`importGedcomService`, tree wipe).

A rule that is routinely broken for good reasons is not a rule; it just stops being read.

## Decision

Draw the line at **transactionality**, not at file location:

- **Route handlers never run SQL.** No exceptions.
- **Query functions** (`lib/db/queries/`) own all *reusable* SQL — one function per statement.
- **Services** compose query functions and hold business logic. A service **may** run SQL
  directly, but **only inside a `getClient()` transaction**.
- Any non-transactional one-off `query()` in a service or route is drift — extract it.

## Rejected alternatives

- **Absolute "all SQL in queries/".** Would force multi-statement transactions to be split
  across functions that each acquire their own client, which either breaks atomicity or
  requires threading a client through the query layer's whole signature set. The cure is worse.
- **No rule; SQL wherever convenient.** This is what produced the drift the cleanup audit found.

## Consequences

- The reviewable question becomes mechanical: *is this SQL inside a `getClient()` transaction?*
  If no, it belongs in `queries/`.
- ⚠️ **PGlite interaction:** PGlite is single-connection, so calling the global `query()` from
  inside a `getClient()` transaction **deadlocks** the static/Tauri build. This rule keeps
  transactional SQL and the client together, which makes that mistake harder — but it does not
  prevent it. Never reach for the global `query()` inside a transaction.
- Documented in `architecture.md` §"Where SQL lives" and summarised in `CLAUDE.md`.
