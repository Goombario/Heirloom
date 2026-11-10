# 0009 — Export sidecars are additive-only, and a `NameVariant` is identified by its value

**Date:** 2026-08-01
**Status:** Accepted
**Area:** gedcom

## Context

Three JSON sidecars ride alongside the `.ged` in the export zip: `cases.json`, `media.json`,
`sources.json`. Each writes `version: 1`. **None of them reads it.** `parseSourcesSidecar`
(`lib/gedcom/sources-sidecar.ts:115`), `parseMediaSidecar` (`lib/gedcom/media-sidecar.ts:114`)
and the inline `cases.json` parse (`lib/services/gedcom.ts:839-857`) are all tolerant
field-by-field readers: they ignore unknown keys, tolerate missing ones, and never inspect
`version`. The `cases.json` type even declares `version: number` and never checks it.

Two data-integrity bugs forced a decision on this format:

- **#398** — every `NameVariant` is inserted twice. The `1 NICK` / `1 _AKA` line path
  (`lib/services/gedcom.ts:669` → `:641-645`) and the `sources.json` loop (`:1294-1303`)
  both persist the same row, and neither knows about the other. Nickname lists double on
  every round trip: 2 → 4 → 8. On merge-into-existing it is worse — the line path dedupes
  at `:1072`, the sidecar does not, so it is +1 row per merge, unbounded.
- **#399** — `NameVariant."IsPrimary"` is carried nowhere in the bundle, so it defaults to 0
  on reimport. Because `effectiveFirstName` keys the displayed given name off that flag
  ([0001](0001-effective-first-name-requires-isprimary.md)), a round trip silently renames
  people.

Fixing #399 means adding a field to a `version`ed sidecar. That is what surfaced the
versioning question, and the question turned out to be broader than the issue: it is about
what `version` means in all three sidecars, not whether one of them increments.

## Decision

Two rules.

**1. A `NameVariant` is identified by its value** — the tuple
`(PersonId, Type, Name, FromDate, ToDate)`. The `sources.json` import loop reuses a row
matching that tuple instead of inserting a second, and merges the sidecar entry's citations
onto the row it found. Two variants identical in every one of those fields are *one* variant
with two citations, and collapse to a single row on the first round trip.

**2. Sidecars are additive-only.** New fields are added as optional; readers stay tolerant
field-by-field parsers that ignore unknown keys and tolerate missing ones. `version` is
therefore never a parse switch — no reader branches on it to choose how to read a bundle. It
gets exactly one use: an import-time guard that **warns** when a bundle's version exceeds the
reader's `CURRENT_VERSION`, so that a future non-additive change is loud instead of silent. A
bump is reserved for a change that is not additive. Adding `isPrimary`, `fromDate` and
`toDate` is not one, and does not bump.

## Rejected alternatives

**Bump `sources.json` to version 2 when adding `isPrimary`** — the framing #399 was filed
with. Since no reader inspects `version`, the bump changes nothing any importer can observe:
an older build reading a "v2" bundle already handles it correctly, because it ignores the keys
it does not know. The bump would be decorative. Worse, it would establish that adding a field
bumps the version, training every future change to increment a number that carries no meaning
— until someone eventually assumes it does and writes code that trusts it.

**Leave `version` write-only, as a diagnostic stamp.** Cheapest, and truest to the code as it
stood. Rejected because it makes the field permanently inert: the single scenario `version`
exists for — an older build handed a newer bundle — is exactly the one where silence costs
data. The reader is a few lines, and pre-1.0 is the last moment at which every bundle in
circulation was produced by this codebase.

**Drop `version` from all three sidecars.** Honest about the present, but it removes the only
escape hatch at the moment the format stabilises for 1.0. A format with no version can never
announce a breaking change.

**"Sidecar wins" for the double-insert** (drop the line-path insert, keep only the sidecar's).
Shown in `docs/gedcom-roundtrip-followup-2026-07-27.md` to trade duplication for data loss:
the `.ged` line carries only Type+Name, while the sidecar entry additionally carries the
citations `insertCitation` attaches to the row it creates (`lib/services/gedcom.ts:1305-1307`).
It is also not a superset in the other direction — `Given` / `Maiden` / `Anglicized` variants
have no GEDCOM line at all, so the line path never sees them. Dropping *either* insert loses
information.

**Preserve duplicates by count** — reuse one existing row per sidecar entry and insert only the
surplus, so N identical variants survive as N. This is the one alternative that is not
obviously wrong: the schema permits duplicates (`lib/db/init-schema.ts:575-581` has only
`idx_namevariant_personid`, `idx_namevariant_ownerid`, and the partial
`idx_namevariant_one_primary`), and `createNameVariant` does not dedupe
(`lib/services/people.ts:295`), so they are authorable today. It lost on two counts. It makes
correctness depend on export ordering — which sidecar entry pairs with which existing row is
positional, so citations land on rows by accident. And nothing distinguishes the surviving rows
afterwards: the only case anyone could construct for preserving both is "two identical
nicknames attested by different sources", which is better modelled as one row with two
citations — which is exactly what collapse produces.

## Consequences

- Adding an optional field to a sidecar is a normal change needing no coordination. Removing or
  renaming one is breaking, must bump `CURRENT_VERSION`, and the warn-guard is then what makes
  the break visible to an older reader.
- **The guard warns; it does not reject.** A newer bundle still imports best-effort. That is
  the behaviour today and is preferable to refusing the import outright.
- `FromDate` / `ToDate` must be carried in `sources.json` as part of this work, because they are
  load-bearing in the identity tuple. They are dropped today — `SidecarNameVariantInput`
  carries only `Id / PersonId / Type / Name` (`lib/gedcom/sources-sidecar.ts:23-28`) — and have
  no UI write path yet (`app/components/person-form/NamesPanel.tsx:221`,
  `TODO(names-date-range)`). Carrying them now keeps the identity rule true when that write
  path lands.
- Two identical `NameVariant` rows on one person are now, by definition, the same variant.
  Anything that creates a pair (a double-submit through `createNameVariant`) produces rows the
  next round trip merges. If that needs preventing at the source, the fix is a unique index on
  the value tuple — not a change to this rule.
- `IsPrimary` rides the sidecar, **not** the `.ged`. That is the channel
  [0001](0001-effective-first-name-requires-isprimary.md) named. Do not "fix" #399 by relaxing
  `effectiveFirstName` instead.
- At most one primary per person is enforced by `idx_namevariant_one_primary`. A merge must set
  `IsPrimary` on the surviving row when the sidecar entry claims it, and must never attempt a
  second primary for the same person — the partial unique index will reject it.
