# 0015 — Note `@Nn@` labels are minted on emission, never on lookup

**Date:** 2026-08-02
**Status:** Accepted
**Area:** gedcom / notes

## Context

#405 reported that shared-note
labels swap across an export → import → export cycle. [ADR 0014](0014-gedcom-tail-closure-decisions.md)
closed the GEDCOM tail but did **not** cover #405 — it was filed as `kind:polish` and read as
cosmetic, so the decision session never took it. This record fills that gap, because the fix
introduces an invariant that is easy to undo by accident.

The cause was that `@Nn@` was assigned from each note's position in `extras.notes`, which
`getNotesForTree` orders `ORDER BY "Id" ASC` (`lib/db/queries/notes.ts:138`). Row ids record when
the user happened to create a note; a reimport re-creates them in *emission* order. So the first
export numbered by creation order and the second by emission order, and the two diffed.

The instability is a one-time permutation, not perpetual churn — export₂ and export₃ agree. It
still matters, because it is the difference between "the export is a fixed point" and "the export
settles after one round trip", and the byte-identity assertion in
`__tests__/unit/gedcom-roundtrip-bundle.test.ts` can only be meaningful under the former.

## Decision

**Labels are minted on first emission, by an allocator, in the order records reference them.**
Owner maps hold note **ids** (`noteIdsByOwner: Map<string, number[]>`), and
`xrefForNote(id)` mints `@N${size + 1}@` the first time a given id is emitted. Record order —
people, then families, then sources and repositories — is itself stable across a round trip, so
first-reference order is invariant where row-id order is not.

**`.get()` must never allocate.** Minting belongs at the point a pointer line is written, not at
a point where code merely asks whether an owner has notes. There is one such probe today: the
REPO existence check (`lib/gedcom/generator.ts`, `repoIdByName` loop) tests
`noteIdsByOwner.get(...)?.length` to decide whether a repository reachable only via a note still
warrants its own `0 @Rn@ REPO` record. If that probe minted, a repository note would take `@N1@`
before the first person record was emitted, and every label in the file would shift.

This is the whole reason the allocator is an explicit function rather than a memoising accessor
or a lazily-populated `Map` behind the same `.get()` shape the old code used. The lazy-`Map`
version is smaller and needs no signature changes; it is also the version that silently
reintroduces #405 the first time someone adds a probe.

## Rejected alternatives

**Sorting `notesToEmit` by a content-derived natural key** (text, or owner-table plus owner key)
instead of tracking emission. No signature changes, and stable across a reimport. Rejected
because it duplicates knowledge of the emission sequence in a second place: the sort comparator
would have to be kept in agreement with the order records are actually written, with nothing
forcing the two to move together. Minting at the emit site cannot drift from the emit order,
because it *is* the emit order.

**Generating records into a buffer, then renumbering the `@Nn@` tokens in a post-pass.** Also
correct, and needs no signature churn. Rejected because it makes the generator's output depend on
a string-rewriting step over already-emitted lines, so a note whose text happened to contain
something matching the token pattern could be rewritten.

**Leaving it.** The issue is `pri:P4` and the mis-numbering corrupts nothing — every
pointer-to-text pairing resolves correctly inside any single file. Rejected because it is one of
the two defects that kept the whole-file byte-identity assertion quarantined, and a blanket
`it.fails` on the `.ged` is blind to *every* other regression in the file. Closing it converts a
dead assertion into a live one. That reasoning is about the test suite, not about the diff noise
the issue described.

## Consequences

**Invariants now in force:**

- **Mint where you emit, never where you probe.** Any new code asking "does this owner have
  notes?" uses `noteIdsByOwner.get(...)` and must not call `xrefForNote`. Any new code *writing*
  a `NOTE @Nn@` pointer must call `xrefForNote`, so the label is allocated in file order.
- **Record order is now load-bearing for output stability.** Deliberately changing the order in
  which people, families, sources or repositories are emitted will renumber every note label.
  That is acceptable and self-consistent, but it will show up as a large diff in
  `gedcom-roundtrip-bundle`, and it is not a regression.
- **A note whose owners are never emitted produces no record at all**, where it previously
  produced an orphan `0 @Nn@ NOTE` with nothing pointing at it *and* consumed a label. Reachable
  when an `Events:<id>` link belongs to a BIRT/DEAT row the person path suppresses, or a
  `Places:<id>` no longer matches any emitted `PLAC` string. Nothing round-trippable is lost —
  the parser only resolves notes reachable from an owner, so such a record was always dropped on
  reimport — but the export no longer contains the text at all. Pinned by a named test.

**What this makes easier:** with #401 and #405 fixed and #398 already closed, the byte-identity
assertion is blocked only on the by-design media re-upload gap and
#525, so it can become a real
assertion rather than a blanket quarantine.
