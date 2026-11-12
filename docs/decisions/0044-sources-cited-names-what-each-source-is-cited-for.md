# 0044 — Sources cited names what each source is cited for

**Date:** 2026-11-12 · **Context:** #49, #780, ADR 0020 · **Status:** Accepted · **Area:** citations / people

Supersedes one clause of [0020](0020-sources-cited-is-a-footnote-list.md): "It lists no facts".
The rest of 0020 stands: Sources cited is the page's footnote list, one row per source in
footnote order, linking to the source, with no action, counted by sources; `CitationDrawer` is
the single-fact citation workspace.

The desktop person page (#49) was locked with the "Detailed" Sources cited style (owner,
2026-10-29), which adds a second line to each row: the source's type and the facts on this page
it is cited for. The owner asked for this record.

## Decision

1. **Each row names the facts the source supports here.** The second line reads
   "Census · Cited for Birth 1868, Census 1880, Residence 1885 and 2 more": the source type, then
   up to three facts by label and year in page order, then a count of the rest.
2. **It stays a footnote list.** The facts are plain text inside the row's one link to the
   source. They are not links, not grouped rows and not a second timeline; a fact's citations are
   still read and edited from its chip.
3. **Scope:** the desktop person page. The family page and the phone keep the plain list until
   their redesigns decide.

## Why

0020 removed 0018's ledger rows because they repeated the chips and made the rail read as a
second timeline. One short line per source doesn't do that, and it answers the question a
reader has at the foot of a page ("what does this census actually support?") without hunting
for the matching chips.

## Rejected

- **0018's ledger (a row per fact under each source).** Still rejected, for 0020's reasons.
- **Linking each named fact to its row.** More targets in a list whose job is to leave for the
  source.
