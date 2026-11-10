# 0035 — A fact's place references are the truth; its place text is a copy

> **Superseded by [0036](0036-two-places-may-share-a-name.md)** (point 5's one-place-per-string rule; a typed name now means the most-used place of it)
>
> **Superseded by [0037](0037-facts-keep-no-place-text.md)** (points 2 and 3: the text copy and the link pass are gone; the text is built from the references)

**Date:** 2026-10-25 · **Context:** #1186, ADR 0031, ADR 0033 · **Status:** Accepted · **Area:** places / gedcom

ADR 0033 derived a fact's place id from the string it records, so a rename still rewrote
every matching string. The maintainer asked for places to be stored as references instead,
so that fixing a place's spelling changes one row. This is the first step: the references
become the truth while the text stays, as a copy, for the code that reads it.

## Decision

1. **A fact has two place references.** Beside each place id from v61 (ADR 0033), v62 adds
   `People.BirthPlaceNameId` / `DeathPlaceNameId`, `Families.MarriagePlaceNameId` and
   `Events.PlaceNameId`, each a nullable FK to `PlaceName.Id` with `ON DELETE SET NULL`. NULL
   means the place's own name; otherwise it is the other name the fact was written under.
2. **The text is a copy of the name the references pick.** The other name when one is set
   (and still belongs to the fact's place), else the place's own name. `refreshFactPlaceText`
   (`lib/db/queries/place-links.ts`) rewrites the copy from the references after anything
   that changes them or a place's name.
3. **Text is matched once, when it changes.** The forms and importers still send text, so
   `linkFactPlaces` remains, but it only touches a fact whose references no longer spell its
   text: own name first, then other names, then a new bare place. A fact whose references
   agree with its text is never matched again. The every-init pass therefore fills the name
   references of a database from before v62 and repairs facts an older build wrote, and does
   nothing else.
4. **Rename and merge change references, not matching strings.** A rename changes the
   `Places` row's name and refreshes the copies of the facts that point at it; facts written
   under its other names keep them. A merge moves the merged place's facts (keeping the name
   each used) and other names to the surviving place, then deletes the merged row. The audit
   snapshot is marked `byReference` and records which facts moved, so undo moves exactly
   those back. Snapshots logged before v62 carry no mark and are undone the old way, by
   rewriting the text back and matching it. Renaming text that is not a place's own name (one
   of its other names) still rewrites the facts that hold it, as before.
5. **What ADR 0033 says still holds where this does not replace it:** every place string has
   a gazetteer row, a string names one place, and GEDCOM writes the fact's text as `PLAC` and
   matches it again on import. The new columns are surrogate keys to the round-trip ratchet.

## Why keep the text for now

About 25 files read the text columns directly. Keeping them as a refreshed copy lets the
switch to references land, and be checked on real data, without touching every reader in the
same change. The plan in #1186 drops the copies once same-name places are allowed and the
readers build the text by a join.

## Consequences

- Undoing a plain rename renames the place back, so a record added after the rename (which
  points at the same place) shows the old name again too. Before, only the records the rename
  had rewritten went back.
- A merge's record count now includes the facts written under the merged place's other
  names, since their references move too.
- Removing another name (its FK sets the fact's name reference to NULL) still leaves the fact
  with its text, which the next link pass matches again: to a new place of its own when no
  place has that name.
