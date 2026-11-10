# 0038 — An oral source's teller is its author, and every source can hold its text

**Date:** 2026-10-25 · **Context:** #470, #1019, #70 · **Status:** Accepted · **Area:** sources / gedcom

Oral testimony was the only source type with fields of its own, a holdover from the retired
Stories feature (#70): a "Told by" column (`Sources.ToldBy`, exported as the invented tag
`_TOLDBY`) and a transcript (`Sources.Contents`, exported as `TEXT`) that the library only
kept while the type was Oral. Switching a source to another type erased both. The
maintainer decided on 2026-08-01 to remove the special case rather than the type.

## Decision

1. **The teller is the author.** v65 folds `Sources.ToldBy` into `Sources.Author` and drops
   the column. An empty author takes the teller; a different author keeps its value and
   names the teller after it, as `Anna Petrova (told by Ivan)`; the same name is kept once.
   The fold and the drop run in one guarded `DO` block, so a crash between them cannot fold
   twice. The rule lives once in TypeScript too, as `foldToldBy` (`lib/utils/told-by.ts`).
2. **Every source can hold its text.** `Contents` is offered and kept for every type, not
   just Oral, and exported as `SOUR.TEXT` as before. Nothing is lost on the way in: the old
   gate meant only Oral sources could hold a transcript.
3. **GEDCOM writes no `_TOLDBY`, but still reads it.** Export stops writing the tag. Import
   folds a `_TOLDBY` line into the author by the same rule, so a backup or GEDCOM written
   before this change still restores with its teller. This keeps the maintainer's direction
   (no invented tag on the round trip) while protecting older files.
4. **The audit log keeps its history.** The "Told by" label stays so older entries still
   read. Restoring a deleted source from an older entry folds its snapshot's teller into
   the author; an older edit that changed only the teller has nothing left to revert.
5. **The source's link is its own website (#1019).** `Sources.Text` keeps its column and the
   `_URL` tag, and is relabelled "Website": the source's own site, such as an archive's
   collection page. A link to one record belongs on the citation (ADR 0025), and a
   repository's site on the repository.

## Rejected

- **Keep Oral and stop erasing on a type change.** It fixes the data loss but keeps one type
  structurally special for no reason.
- **Remove the Oral type.** Genealogy uses the category; the problem was the bespoke fields.
- **Delete the `_TOLDBY` reader with the writer.** Older Heirloom exports would lose the
  teller on re-import.

## Consequences

- The schema loses a column before the 1.0 freeze (#811), so no 1.0 database carries it.
- The teller's "told by" wording is stored in English in a merged author. It appears only
  where a source had both an author and a different teller.
