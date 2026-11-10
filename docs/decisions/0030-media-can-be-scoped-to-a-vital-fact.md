# 0030 — Media can be scoped to a vital fact, the same way notes are

**Date:** 2026-10-22 (#905)
**Status:** Accepted
**Area:** gedcom / media

Written before the build, at the maintainer's request, because it changes the schema. It
records only what was decided on #905 (2026-10-18, option A) and in its follow-up. If the build
finds a wrong premise, a new record corrects it.

## Context

Birth and death live in `People` columns and marriage in `Families` columns, not in `Events`
rows. GEDCOM allows a multimedia link under any of them, and real exports put certificate scans
exactly there. Notes already handle this with `NoteLink."OwnerFact"` (`'Birth' | 'Death' |
'Marriage'`, ADR 0016). `MediaLink` has only `OwnerTable` and `OwnerId`, so media on those facts
has nowhere to go, and the importer handles it two different wrong ways (#905):

- `2 OBJE` under `1 MARR` is claimed by the family branch. The image becomes general family
  media and exports as `1 OBJE` on the `FAM` record, so the link to the marriage is lost.
- `2 OBJE` under `1 BIRT` / `1 DEAT` falls through to the raw passthrough and is re-emitted
  verbatim. An inline object never reaches the app. A pointer keeps the source file's xref, but
  export renumbers media records by database id (`assignMediaXrefs`), so the re-emitted pointer
  can dangle or point at a different image.

## Decision

- **`MediaLink` gets a nullable `"OwnerFact"`**, with the vocabulary `NoteLink` uses: `Birth` and
  `Death` on `People`, `Marriage` on `Families`. `NULL` is the record-level link it is today.
  Every writer validates the value against the owner table.
- **Link identity includes the fact.** The `("MediaId", "OwnerTable", "OwnerId")` primary key is
  replaced by a unique index over `("MediaId", "OwnerTable", "OwnerId", COALESCE("OwnerFact",
  ''))`, as `NoteLink` did for #512. The same photo can be linked to a person and to their birth;
  those are two links, and removing one leaves the other.
- **The portrait is always a record-level link.** `IsPrimary = 1` requires `"OwnerFact" IS NULL`,
  enforced by the table's check constraint, and every query that sets or clears a primary filters
  on it.
- **Scope is set from context and never changed**, as ADR 0016 rules for notes. Two writers may
  set it: the importer, from the vital block an `OBJE` is nested under, and the Birth, Death and
  Marriage panels in the app, which pass the fact the user is already on. No control picks or
  changes a link's fact. To move a photo, the user removes the link and adds a new one.
- **Display mirrors fact notes.** A fact's panel or timeline row shows only that fact's media.
  The person's or family's own media list shows every link, and a fact-scoped one carries the
  fact's name as its label.
- **Import.** `2 OBJE` under `1 BIRT`, `1 DEAT` or `1 MARR`, pointer or inline, becomes a
  `MediaLink` with that fact. The family branch no longer claims an `OBJE` inside `MARR`, and
  `OBJE` leaves the BIRT/DEAT passthrough.
- **Export.** A fact-scoped link is written as `2 OBJE @On@` under its fact line, using the same
  renumbered xrefs as every other media pointer. It counts as fact content exactly as a fact note
  does, so it alone makes the generator write the fact line.
- **Existing data is not migrated.** `Media` keeps no GEDCOM xref, so a raw `2 OBJE @Oxx@` line
  already stored under BIRT/DEAT can't be matched to a photo. From this change the generator
  stops re-emitting raw `OBJE` pointer lines and counts each one it skipped in the export's media
  summary. A raw inline `OBJE` keeps round-tripping as text. Re-importing the original file
  attaches both kinds properly. Marriage media already imported as family media stays family
  media, because nothing records that it came from `MARR`.
- **Audit.** Every snapshot that records a media link carries `OwnerFact`. Revert of an entry
  written before this change reads a missing value as `NULL`.
- **Order of work.** The stale-pointer export (case 2 in #905) is fixed and covered by a
  round-trip test before the schema change lands.

## Rejected alternatives

- **B. Keep fact media as passthrough, remapping pointers on export.** It round-trips safely,
  but the media is invisible in the app, and the remap needs the source file's xrefs, which
  aren't kept.
- **C. Import fact media as owner media on purpose.** Simplest and consistent, but every round
  trip loses which certificate belongs to which fact, which is what users put it there to say.
- **Promoting birth, death and marriage to `Events` rows so they use event media.** The vitals
  are columns that the vitals strip, the data checks, import and export all read. Moving them is
  far larger than the problem, and fact media doesn't justify it.
- **A second table for fact media.** Every media list, count, delete and audit path would need
  to read two tables. Notes showed one link table with a fact column is enough.
- **Keeping the primary key and adding the fact to it.** A primary key column can't be `NULL`,
  and a sentinel value like `''` in the column would leak into every reader. The expression index
  keeps `NULL` meaning "the record".
- **Emitting existing raw pointers anyway.** An export that attaches the wrong image to a birth
  is worse than one that leaves it off.

## Consequences

- Every `ON CONFLICT` on `MediaLink` must target the new identity, and every write that
  identifies one link must say which fact. A lookup by `(MediaId, OwnerTable, OwnerId)` alone can
  now match two rows.
- Clearing a death (the status switcher) leaves its Death-scoped media in place, as it leaves
  Death-scoped notes. Like those notes, it still shows in the person's media list with its label,
  and it still makes the generator write a `1 DEAT`.
- Counts and media integrity checks that go through `MediaLink` count a photo linked to a person
  and to their birth once per link. Any user-visible count of media on a person must count
  distinct `MediaId`s.
- Tests: the import → export round trip for `MARR`, `BIRT` and `DEAT` pointers and an inline
  object, asserting each link's fact and that every exported pointer resolves to the same file it
  did on import; plus the primary-must-be-record-level constraint.
