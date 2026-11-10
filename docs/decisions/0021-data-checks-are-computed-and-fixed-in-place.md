# 0021 — Data checks are computed on demand, and fixed where the date lives

**Date:** 2026-09-26 (#786; built in #826–#835, tracking #809)
**Status:** Accepted
**Area:** data-integrity / design-system

This lands #786's design outcome (the 2026-09-25 draft ADR comment), corrected against what
was built, with the 2026-09-26 build-plan decisions.

## Context

The app showed impossible data without comment (task audit ED-6). In the large test tree,
Mary Ellen Byrne died aged seven months but is the mother of four children born 1843–1849, and
her family hero read "~1842–1814". Home's suggestions covered only duplicates, missing parents
and missing events, and the last two never reach zero. The checks were compared with
FamilySearch, MyHeritage, RootsMagic, Legacy, Gramps 6.0, Family Tree Analyzer and Geneanet.

## Decision

### The checks

- **19 checks** in `lib/data-checks/` (`rules.ts`, `engine.ts`): 13 **impossible**, 5
  **unlikely** (parent under 12, mother over 55, married under 12, age at death over 110,
  marked living but born over 110 years ago), and one record-shape check (dates the checks
  can't read; GEDCOM date phrases are skipped, not flagged). A child born more than
  **10 months** after the father's death is impossible, as in Legacy and Gramps. Thresholds
  are fixed.
- **Flag only when every reading conflicts**, over date intervals (`lib/date-intervals.ts`):
  `ABT`/`EST`/`CAL` are ±5 years, `BEF`/`AFT` are open on one side, `BET … AND` uses its two
  ends, a bare year covers the year, `INT` uses its date. A missing birth or death is bounded
  by the earliest baptism or burial.
- **One entry per person per check**, listed under the person whose date is most likely
  wrong: a child born after a parent's death is the parent's entry, so Mary Ellen's four
  children make one entry.
- **Each problem names its `editable` dates**, by fact address (`PersonBirth:12`,
  `Families:4`, `Events:9`): one for most checks, **both for "death before birth"**, none for
  "own ancestor" or "marked living" (not dates).

### How it runs

- **Computed on demand** by one pure engine that the server and the static build's PGlite
  both call. The whole tree has a 300 ms budget (`data-checks-large-tree.pglite.test.ts`).
  `GET /api/data-checks` can narrow to one person's timeline (`personId`) or one family
  (`familyId`), but still runs over the whole tree. Nothing is stored except confirmations.
- **Unlikely checks can be confirmed as correct** with a required reason. Impossible ones can
  only be fixed. Viewers can't confirm; contributors can; reopening deletes a confirmation,
  so it's owner and editor only. Both are audited. A confirmation (`DataCheckConfirmations`)
  stores the rule, threshold and each involved fact's address and date string. If any of them
  changes, it no longer applies and the problem is back to To check. An overwrite import
  clears the table, and GEDCOM export leaves it out.

### Where problems appear

- **The Data checks page** (`/data-checks`), under the menu renamed from "Utilities" to
  **"Tools"** in English, next to Audit log. From 768 up it's the Places Explore layout: the
  filters across the top, then one card with the list beside the detail. Phones get a
  full-width list, and an entry opens full screen with a Previous / Next bar fixed to the
  bottom. The list is grouped by check, impossible first, 25 to a page with the shared
  `Pagination`. The "All checks" menu lists only checks that found something, with a footer
  naming how many came up clean. The selected entry and a family filter live in the query.
- **The detail** marks only the row or rows to fix. Every other date stays in the evidence
  amber. A neutral card-alt note says why it's flagged; it's not a blue banner.
- **Fixed in place:** each date to fix has an always-visible outline **Edit date** that turns
  its row into `InlineDateEditor`. Below 480px of its container it's a 44px pencil, and every
  resting row is as tall as the button. A line under the field says, as you type, whether the
  date clears the problem, by re-running the engine in the browser on the person's
  neighbourhood (`/api/data-checks/neighbourhood`). Save writes through the normal audited
  person, family or event update, re-runs the checks and moves on, unless the problem is still
  there or the edit raised a new one for that person. "Open [person]'s page" is for fixes that
  aren't one date.
- **Person and family pages:** only the timeline row of a date to fix gets a mark, never the
  other involved rows or a derived row (a partnership end taken from a death). The mark is the
  warning tint and an always-visible **Check this date** button that discloses a panel under
  the row: the problem, Edit date (the row's own editor) and "Open in Data checks ›". No
  problems sidebar. Confirmed checks get no mark.
- **One shared flag**, `DatesToCheckFlag`: a static warning pill with the count, then an ink
  "Review ›" link. It's on the family hero (the island's dark warning pair in both themes)
  and on the import result.
- **Home** has a "Dates to check" card with the count and the first three entries, impossible
  first, hidden at zero. The "people with no parents" and "people with no events"
  suggestions are gone.
- **Leaving the page is an ink link** ("Open … ›", "Review ›"); acting in place is a button.
- **Warnings are orange**, never amber, which means evidence. Each check has a name, a list
  summary and a sentence in en, fr and ru, each one ICU message with a `select` on sex and a
  `plural` on counts.

Filed outside the build: #824 (warning badge fill contrast), #825 (a borderless layout for the
page), #837 (choosing a family filter on the page).

## Rejected alternatives

- **Stored results with a "Check again" button.** They go stale, and the static build has no
  background jobs.
- **Missing parents, events or sources as checks or home suggestions.** That work never
  finishes, so the count never reaches zero.
- **Confirming an impossible check**, and the wordings "It's right…", "Dismiss" and "Ignore".
  A late-registered birth is a wrong birth date: enter the best estimate and cite the register.
- **Marking every involved date.** It put orange on the dates that are probably right (Mary
  Ellen's children's births). Only the date to fix is marked.
- **A problems sidebar on the family page.** It repeats the page and adds orange.
- **Other page layouts:** sections by check, grouping by family, a family-grouped
  fix-in-place version, and a review drawer from home.
- **The full `InlineEventEditor` restricted to the date.** A fix here is only ever a date, and
  one can live on a family's start, which that editor doesn't write. `InlineDateEditor` is the
  date-only editor.
- **A clickable flag pill.** Navigation in this app is an ink link, so the pill stays static.
- **Checks dropped as noise, or not errors:** a child born before the parents' marriage,
  same-sex partners, more than one set of parents, siblings with the same first name, partners
  with the same surname, large age gaps, late baptism or burial, birth on the day of death,
  name formatting, children out of order, and a missing sex.

## Consequences

- **A new check must say which dates it edits and whether it's impossible or unlikely.** Only
  unlikely checks can be confirmed.
- **Don't add stored check results or a "Check again" button.** If the checks get slow, make
  the engine faster.
- **A new table that an overwrite import clears joins the [0008](0008-overwrite-import-gate-counts-every-cleared-table.md)
  lockstep list**, as `DataCheckConfirmations` did.
- **Home shows only work that can reach zero.** Don't add suggestions for open-ended research.
