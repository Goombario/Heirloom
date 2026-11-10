# 0033 — A fact points at its place by id, derived from the string it records

> **Superseded by [0035](0035-a-facts-place-references-are-the-truth.md)** (the id is no longer re-derived from the string, and rename no longer rewrites strings; the gazetteer-row and one-place-per-string rules stand)

**Date:** 2026-10-25 · **Context:** #1167, #1030, ADR 0017, ADR 0031 · **Status:** Accepted · **Area:** places / gedcom

ADR 0031 settled the model: a place has an identity apart from its names, a fact keeps its
place as recorded, and the place can carry other names. This records how the link is kept
and the rules that make it safe to rely on.

## Decision

1. **Every fact column that holds a place string has a nullable FK beside it.**
   `People.BirthPlaceId` / `DeathPlaceId`, `Families.MarriagePlaceId` and `Events.PlaceId`
   reference `Places.Id` with `ON DELETE SET NULL`. Deleting a gazetteer row never deletes a
   fact.
2. **The id is derived from the string, never chosen apart from it.** A fact points at the
   place in its tree whose `Name` is its string, or that has the string among its other names
   (`PlaceName`). `linkFactPlaces` (`lib/db/queries/place-links.ts`) is the only code that
   sets the ids, and every path that writes a fact's place string, or a place's names, calls
   it afterwards: person, family and event writes, GEDCOM and spreadsheet import, audit
   revert, and place rename / merge and their revert. `initializeSchema` runs it over every
   tree on every init, so a database restored from before v61 or written by an older build is
   repaired on the next boot.
3. **Every place string has a gazetteer row.** Linking gives a string that names no place a
   bare `Places` row, as the init backfill already did. So the place pages, counts, maps and
   the dashboard read facts by id, and a fact recorded under another name ("Lemberg") counts
   for and opens its place ("Lviv").
4. **A string names one place.** `PlaceName` is unique per tree, and a name is never both a
   `Places.Name` and another place's other name: rename refuses a target that is another
   place's other name, import skips an incoming other name the tree already uses, and the
   geocode, coordinate and hierarchy writes land on the place itself when handed one of its
   other names.
5. **Rename still rewrites strings.** Rename corrects a spelling, so it rewrites the facts
   that hold exactly the old string, as before, and the ids are relinked after. A merge also
   moves the merged place's other names to the surviving place, and its revert moves them
   back. A fact recorded under one of the place's other names is never rewritten.
6. **GEDCOM is unchanged.** The `.ged` writes each fact's string as `PLAC`; the ids are not
   exported (the round-trip coverage ratchet treats them as surrogate keys), and import
   derives them again. Other names travel in `places.json` as an additive `names` field
   (ADR 0009, 0031).

## Why derive the id instead of storing a choice

A fact whose id could disagree with its string would need a UI to choose the place, a rule
for which one wins on export, and a migration for every write path that only knows strings.
Deriving it keeps the `.ged` lossless and makes the id recomputable at any time, so a
missed write is repaired by the next link pass rather than corrupting data. Choosing a place
for a fact independently of its spelling can be added later on top of this, if it is ever
needed.

## Consequences

- The country of a fact's place can be found through the gazetteer: Source this fact walks
  the place's `ParentId` chain to the nearest country when the text names none (#1030).
- Place search, the places list filter and global search match any of a place's names.
- Editing a place's other names has no screen yet; until one is built they arrive only
  through `places.json`.
