# 0025 — A citation's record link is a column, exported as `_LINK`

**Date:** 2026-10-04 (#1022, #1023, #1024; spec #1017 §4; tracking #1031)
**Status:** Accepted
**Area:** gedcom

## Context

"Source this fact" turns a find on a record site into a citation, and the link to that one
record has to be kept. GEDCOM 5.5.1's `SOURCE_CITATION` and GEDCOM 7 have no link on a
citation, so every app uses its own tag: Family Tree Maker writes `_LINK` under the citation,
Ancestry writes `WWW` there although 5.5.1 doesn't allow it, and others use `_URL`. Before this
record, those lines rode the citation's passthrough (`Citation."RawGedcom"`, #980): they
survived a round trip, but the app couldn't show or edit them.

## Decision

- `Citation."Url"` (TEXT, nullable) holds the link to the record a citation points at. It
  lives on the citation, not the source: the source is the collection, the citation is one
  entry in it. `Sources."Text"` and its `_URL` tag are a separate field and are unchanged
  (#1019).
- **Export** writes `Url` as `<L+1> _LINK <url>` under the citation's `SOUR`, before the
  citation's passthrough lines. A long link continues with `CONC`, like any long value.
- **Import** reads the first direct child of a citation tagged `_LINK`, `_URL` or `WWW` with a
  non-blank value (plus its `CONC` lines) into `Url`, and removes it from the passthrough. Any
  later link line stays in `RawGedcom` verbatim. A `_URL` or `WWW` line comes back out as `_LINK`.
- **Existing data:** a one-time backfill lifts the first link line out of each citation's
  stored `RawGedcom`, using the same helper as import (`lib/gedcom/citation-link.ts`), so a
  tree imported before this change neither loses the link nor exports it twice. A comment on
  the column marks it finished, and is set only after it finishes.
- **`PAGE` is not used for the link.** Export doesn't append the link to `PAGE`, and import
  doesn't look for one there.

### Rejected: mirroring the link into `PAGE`

Appending the link to `PAGE` would keep it in apps that drop custom tags. It was rejected:

- `PAGE` (`WHERE_WITHIN_SOURCE`) is limited to 248 characters, and record links with query
  strings often don't fit. Ancestry's newspaper citations, which put `URL: …` inline in
  `PAGE`, are cut off mid-link in the vendor corpus (`test-data/vendor/exports/gedcom-go__pres2020.ged`).
- FTM's own export (2,587 `_LINK` lines in `pres2020.ged`) never copies the link into `PAGE`.
- Import would have to strip the mirrored suffix again, and that breaks as soon as another
  app edits `PAGE`. The citation would then show the link twice.
- An app that drops `_LINK` can't show the link as a link anyway.

## Consequences

- A citation with a link always exports exactly one `_LINK` from the column. A second link line
  that arrived in the same citation exports after it, from the passthrough, so the first one is
  still the one re-import lifts.
- The backfill runs until it has finished once, so clearing a citation's link later never
  brings back a second link line from the passthrough. Dropping the column's comment would run
  it again. A link line the helper won't lift, such as one with sub-lines other than `CONC`,
  stays in the passthrough and still exports.
- `Url` is shown as a link only when it's an `http(s)` URL; anything else is shown as text.
  The API refuses a link with a line break of any kind, and export replaces one with a space,
  because `_LINK` is a single GEDCOM line.
- A new citation field must be carried by the import's insert and merge-dedupe paths in
  `lib/services/gedcom.ts`, the export query and the round-trip fixture's coverage ratchet.
