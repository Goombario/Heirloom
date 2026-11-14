# Decision records

One decision per file. **Append-only — never edit a record after it lands.**

If a decision is later reversed, write a *new* record that supersedes it and add a
`> **Superseded by [XXXX](...)**` line to the old one. That single line is the only
permitted edit.

## Why these exist separately from issues

Issues track *mutable state* — what is left to do, what got done. They close, and their
content stops being read.

These records track *immutable knowledge* — why something is the way it is, and what was
tried and rejected. That knowledge stays true after the work ships, and it is the expensive
thing to rediscover. Every record here exists because the reasoning was already nearly lost
once, or because someone (human or agent) was about to "fix" something that was deliberate.

## When to write one — and when not to

**Test:** *if the next person doesn't know this, what breaks, and would they notice?*
A record earns its place only when the answer is **concrete and silent** — code that looks
redundant and isn't, a heuristic that must not be "simplified", a legacy read path whose
deletion loses data quietly.

**Write one after the work lands, not before.** Records written as plans-of-record rot
immediately, because they state conclusions about code nobody has touched yet. 0012 was written
that way and needed 0013 to correct four premises the next day; 0014 was amended twice before it
even landed. The records that have held up — 0009, 0011, 0013, 0015 — were all written *after*
the thing they describe was built and verified.

**Do not write one for:**

- **A decision log.** "We chose X over Y, here's why" belongs in the PR body and a comment on
  the issue. Both are permanent, and both are where someone actually looks.
- **A rule already stated in `CLAUDE.md` or `architecture.md`**, unless the ADR adds the
  *rejected alternatives* that stop the rule being re-litigated (which is why 0004 and 0006 stay).
- **One record per batch of issues.** That shape produces a long document whose durable content
  is three invariants buried in a table.

One ADR per invariant beats one per decision session. If a record's Consequences section is the
only part that would still matter in six months, it should have been only that.

## Naming

```
NNNN-kebab-case-summary.md
```

Sequential, zero-padded. Date goes inside the file, not in the name.

## Template

```markdown
# NNNN — Title

**Date:** YYYY-MM-DD
**Status:** Accepted | Superseded by NNNN
**Area:** gedcom | places | design-system | ...

## Context
What forced a decision. Include the measurement or bug that surfaced it.

## Decision
What we chose, stated so someone can act on it without reading the rest.

## Rejected alternatives
What else was considered and the specific reason it lost. This is the highest-value
section — it is what stops the same idea being re-proposed in six months.

## Consequences
What this makes easy, what it makes hard, and what invariant must now be maintained.
```

## Index

| # | Title | Area |
|---|-------|------|
| [0001](0001-effective-first-name-requires-isprimary.md) | `effectiveFirstName` requires `IsPrimary` — do not relax it | gedcom / people |
| [0002](0002-living-people-emit-custom-living-tag.md) | Living people emit `_LIVING Y`, not `DEAT N` | gedcom |
| [0003](0003-gedcom-export-carries-a-utf8-bom.md) | GEDCOM exports carry a UTF-8 BOM | gedcom |
| [0004](0004-services-may-own-sql-only-inside-a-transaction.md) | Services may own SQL, but only inside a transaction | architecture |
| [0005](0005-single-fit-floor-for-tree-autofit.md) | One auto-fit zoom floor for every viewport | tree |
| [0006](0006-tree-scope-resolved-at-one-choke-point.md) | Tree scope is resolved at exactly one choke point | architecture |
| [0007](0007-place-media-dropped-no-obje-in-place-structure.md) | Places do not get media attachment | gedcom / media |
| [0008](0008-overwrite-import-gate-counts-every-cleared-table.md) | The overwrite-import gate counts every table the wipe clears | gedcom |
| [0009](0009-sidecars-are-additive-only-and-namevariants-are-identified-by-value.md) | Export sidecars are additive-only; a `NameVariant` is identified by its value | gedcom |
| [0010](0010-people-notes-column-is-retired-in-favour-of-first-class-notes.md) | `People."Notes"` is retired in favour of first-class `Note` rows | gedcom / people |
| [0011](0011-sidecar-claims-the-line-paths-null-dated-name-variants.md) | The sidecar claims the line path's null-dated `NameVariant` rows (refines 0009) | gedcom |
| [0012](0012-gedcom-gap-matrix-decision-session.md) | GEDCOM gap-matrix decision session — what to build, accept, or defer | gedcom |
| [0013](0013-gedcom-gap-matrix-build-corrections.md) | Building the 0012 set — four corrected premises, and `_RELTYPE` retired | gedcom / notes |
| [0014](0014-gedcom-tail-closure-decisions.md) | Closing the GEDCOM tail — seven calls, and what is accepted rather than built | gedcom |
| [0015](0015-note-xref-labels-are-minted-on-emission.md) | Note `@Nn@` labels are minted on emission, never on lookup | gedcom / notes |
| [0016](0016-date-year-rule-and-death-only-cause.md) | Dates stay strings with a derived sort year; cause stays death-only | gedcom |
| [0017](0017-place-name-vocabulary.md) | Place name vocabulary: “Place name” and “Geocoded as” | places / design-system |
| [0018](0018-citations-remain-fact-scoped.md) | Citations remain fact-scoped; owner-wide views are projections | citations / people / families |
| [0019](0019-tree-opens-at-a-readable-zoom.md) | The tree opens at a readable zoom (supersedes 0005's threshold) | tree |
| [0020](0020-sources-cited-is-a-footnote-list.md) | Sources cited is a footnote list; citations are edited one fact at a time (supersedes part of 0018) | citations / people / families |
| [0021](0021-data-checks-are-computed-and-fixed-in-place.md) | Data checks are computed on demand, and fixed where the date lives | data-integrity / design-system |
| [0022](0022-stranded-rows-are-kept-and-not-counted.md) | Rows a delete strands are kept, and user-visible counts skip them | data-integrity |
| [0023](0023-child-links-carry-their-own-gedcom-passthrough.md) | Child links carry their own GEDCOM passthrough | gedcom |
| [0024](0024-note-and-media-record-citations-are-counted-not-kept.md) | Citations on note and media records are counted, not kept | gedcom / citations |
| [0025](0025-a-citation-record-link-is-a-column-exported-as-link.md) | A citation's record link is a column, exported as `_LINK` | gedcom / citations |
| [0026](0026-the-phone-person-page-handles-back-swipe-and-the-keyboard.md) | The phone person page handles Back, swipe and the keyboard itself, and vitals own birth and death | design-system / people |
| [0027](0027-a-child-is-linked-to-each-partner.md) | A child is linked to each partner, not to the family (supersedes 0012's child-linkage row) | gedcom / families |
| [0028](0028-phone-screens-undo-is-an-audit-revert-and-sheet-content-mounts-late.md) | Phone screens: Undo is an audit revert, and sheet content mounts late | design-system |
| [0029](0029-hosted-membership-lives-in-the-database.md) | Hosted membership lives in the database, separate from tree sharing | auth / architecture |
| [0030](0030-media-can-be-scoped-to-a-vital-fact.md) | Media can be scoped to a vital fact, the same way notes are | gedcom / media |
| [0031](0031-a-place-has-no-modern-name-and-its-other-names-wait-on-placeid.md) | A place has no modern-name field, and its other names wait on `PlaceId` (answers 0017's open question) | places / gedcom |
| [0032](0032-tree-branch-colour-stops-after-one-generation.md) | A tree branch colour stops after one generation | tree |
| [0033](0033-a-fact-points-at-its-place-by-the-string-it-records.md) | A fact points at its place by id, derived from the string it records | places / gedcom |
| [0034](0034-dates-that-only-identify-a-person-are-muted.md) | Dates that only identify a person are muted; amber is for dates read as facts | design-system |
| [0035](0035-a-facts-place-references-are-the-truth.md) | A fact's place references are the truth; its place text is a copy | places / gedcom |
| [0036](0036-two-places-may-share-a-name.md) | Two places may share a name; a typed name means the most-used one | places / gedcom |
| [0037](0037-facts-keep-no-place-text.md) | Facts keep no place text; it is built from their references | places / gedcom |
| [0038](0038-an-oral-sources-teller-is-its-author.md) | An oral source's teller is its author, and every source can hold its text | sources / gedcom |
| [0039](0039-a-pdf-is-media-drawn-in-the-browser.md) | A PDF is media, drawn in the browser and viewed in the browser's own viewer | media |
| [0041](0041-a-tree-can-be-shared-before-the-person-has-an-account.md) | A tree can be shared before the person has an account | auth / sharing |
| [0042](0042-case-journal-entries-are-append-only.md) | Case journal entries are append-only: struck out, never edited or deleted | cases / data-integrity |
| [0043](0043-a-note-can-move-to-another-thing-it-is-about.md) | A note can move to another thing it is about (supersedes 0016 decision 3) | notes / people |
| [0044](0044-sources-cited-names-what-each-source-is-cited-for.md) | Sources cited names what each source is cited for (supersedes 0020's "lists no facts") | citations / people |
| [0045](0045-a-case-holds-leads-findings-and-claims.md) | A case holds leads, findings and claims; the tree changes only when the case closes | cases / data-integrity |
| [0046](0046-answer-and-close-fills-gaps-and-adds-events.md) | Answer and close fills gaps and adds events, each change cited and undoable | cases / data-integrity |
| [0047](0047-a-family-can-have-a-family-photo.md) | A family can have a family photo, chosen as a portrait is | media / families |
| [0049](0049-a-repository-has-a-website-phone-and-email.md) | A repository has a website, phone and email, lifted from GEDCOM passthrough | sources / gedcom |
| [0050](0050-a-place-knows-what-kind-of-place-the-geocoder-matched.md) | A place knows what kind of place the geocoder matched | places |
| [0051](0051-whats-new-shows-each-release-once-per-user.md) | What's new shows each release once per user | releases / accounts |
