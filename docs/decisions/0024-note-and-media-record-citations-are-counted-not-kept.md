# 0024 — Citations on note and media records are counted, not kept

**Date:** 2026-10-03 (#981, tracking #998)
**Status:** Accepted
**Area:** gedcom / citations

## Context

GEDCOM 5.5.1 allows a `SOURCE_CITATION` on a shared `NOTE_RECORD` and on a
`MULTIMEDIA_RECORD` (`0 @N1@ NOTE` / `1 SOUR @S1@` / `2 PAGE …`). The 2026-10-03 interop rerun
(`docs/testing/2026-10-02-gedcom-interop.md`) found 7 `NOTE.SOUR` in three files (TGC 5.5.1 and
5.5C, Ancestris), several with full evidence: `PAGE`, `QUAY`, `DATA.DATE`, `DATA.TEXT`,
`EVEN`/`ROLE`.

A citation here is stored as `Citation(FactTable, FactId, SourceId)` and belongs to one fact
(ADR 0018). Notes and media aren't facts, so these citations have no home. Since #963 the import
counts them in the `citations_unplaced` warning instead of dropping them silently.

Keeping them would mean a `Note` (and later `Media`) fact table: parser and generator support,
ADR 0018 display descriptors for the owner-wide citation views, and a decision on whether the
notes UI shows or edits note citations.

## Decision

- **Citations on NOTE and OBJE records aren't kept.** The note and the media are; their
  citations, and every line under them, aren't stored or exported again.
- **The import keeps counting them** in `citations_unplaced`, so the user is told how many were
  left out.
- **The loss is a documented known limit** in the interop report, which is what #810's acceptance
  asks of a loss that isn't fixed.

## Consequences

- Notes and media stay uncitable. `Citation."FactTable"` gains no `Note` or `Media` value.
- Evidence written only on a note or media record is lost on import. Citing the same source on
  the fact the note describes keeps it in the app.
- A note record has no kept lines of its own, so its `CHAN` (#994) stays a known limit too.
- Making notes or media citable later needs its own decision, which would supersede this one.
