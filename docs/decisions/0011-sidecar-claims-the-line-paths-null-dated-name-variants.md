# 0011 — The sidecar claims the line path's null-dated `NameVariant` rows

**Date:** 2026-08-02
**Status:** Accepted
**Area:** gedcom

> Refines [0009](0009-sidecars-are-additive-only-and-namevariants-are-identified-by-value.md);
> does **not** supersede it. That record's identity rule stands unchanged — this one records
> the reconciliation step implementing it turned out to require, which 0009 does not describe.
> (0009 is deliberately left untouched: the only edit permitted to a landed record is a
> supersede line.)

## Context

[0009](0009-sidecars-are-additive-only-and-namevariants-are-identified-by-value.md) says a
`NameVariant` is identified by its value — `(PersonId, Type, Name, FromDate, ToDate)` — and that
the `sources.json` import loop must reuse a row matching that tuple instead of inserting a
second one (#398).

Implementing it surfaced a gap in that rule. Two write paths run, in order:

1. The **line path**, from `1 NICK` / `1 _AKA`, during person insert. GEDCOM 5.5.1 has no tag
   for a date range on a name variant and none for a "preferred name" marker, so this path
   *cannot* carry `FromDate`, `ToDate`, or `IsPrimary`. It inserts them NULL / 0.
2. The **sidecar loop**, from `sources.json`, which carries all of them (`isPrimary`,
   `fromDate`, `toDate` were added additively for #399).

So for any variant with a date range, the row the line path just created does **not** match the
sidecar entry's full tuple — the dates differ. A literal reading of 0009 therefore inserts a
second row: exactly the #398 duplication the rule exists to prevent, reintroduced for precisely
the variants that carry dates.

This is currently invisible. `FromDate`/`ToDate` have no UI write path yet
(`app/components/person-form/NamesPanel.tsx`, `TODO(names-date-range)`), so every variant in
practice has null dates and the exact match happens to succeed. The defect would appear the
first time that write path lands — long after anyone remembers why the matching looked the way
it did.

## Decision

A sidecar entry resolves to a row in this order:

1. A row already resolved in this import for the **same full value tuple** → reuse it, and merge
   this entry's citations onto it. (0009's collapse rule.)
2. Otherwise an **unclaimed** row for `(PersonId, Type, Name)` whose dates match **exactly**.
3. Otherwise an **unclaimed** row for `(PersonId, Type, Name)` with **both dates NULL** — the
   incomplete line-path version of this same variant. Claim it and **complete** it by writing
   the sidecar's dates.
4. Otherwise INSERT.

Rows claimed earlier in the same import are excluded from 2 and 3, so two variants differing
only by date range cannot steal each other's row. That makes the loop **order-insensitive**:
processing a dated entry before or after its null-dated sibling yields the same result.

The sidecar is therefore **authoritative** for `FromDate`, `ToDate` and `IsPrimary`; the line
path is authoritative for nothing the sidecar also carries.

## Rejected alternatives

**Match on the exact tuple only.** The literal reading of 0009, and the one a later reader is
most likely to "correct" the code back to, because step 3 looks suspiciously loose. It silently
reintroduces #398 for every dated variant, and — worse — it does so *invisibly today*, because
no UI writes dates yet. The bug would ship the day the date-range write path lands, with nothing
connecting it to this decision.

**Match on `(PersonId, Type, Name)` and ignore dates entirely.** Fixes the double-insert and is
simpler. Rejected because it collapses two variants that differ only by date range into one,
destroying a distinction the schema deliberately keeps — it fixes #398 by breaking 0009's
identity rule instead of implementing it.

**Let the sidecar own all `NameVariant` writes and have the line path skip Nickname/Alias**
("sidecar wins"). Already rejected in 0009 because the sidecar entry carries citations the line
does not. It fails for a second, independent reason: a `.ged` imported **without** its
`sources.json` would then lose every nickname. The `.ged` must stay useful on its own.

## Consequences

- **Do not tighten step 3 into an exact match.** It is the step that makes the #398 fix hold for
  dated variants. If it ever looks redundant, that is because no data exercises it yet.
- A `.ged` imported without `sources.json` still gets its `Nickname`/`Alias` rows — with null
  dates and no primary flag. Degraded, not lost, which is the intended asymmetry.
- Cost is one `SELECT` per sidecar name-variant entry, bounded by variant count rather than
  people count. Acceptable for an import already inside one transaction.
- When the `FromDate`/`ToDate` write path lands, this reconciliation is what keeps the round trip
  correct. The round-trip guards in `__tests__/unit/gedcom-roundtrip-semantic.test.ts` cover the
  null-dated case today; a dated fixture should be added alongside that UI work.
