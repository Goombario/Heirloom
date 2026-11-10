# 0014 — Closing the GEDCOM tail: seven calls, and what is accepted rather than built

**Date:** 2026-08-02
**Status:** Accepted
**Area:** gedcom

## Context

[ADR 0012](0012-gedcom-gap-matrix-decision-session.md) decided the eleven areas of the
#421 gap matrix and
[ADR 0013](0013-gedcom-gap-matrix-build-corrections.md) recorded what changed while building
them. Both left a tail: issues that were filed separately, split out of
#285, or marked `needs:decision` /
`status:deferred` and therefore *left* the epic's scope by being re-filed rather than resolved.

Maintainer direction, 2026-08-02: every open `area:gedcom` issue is resolved this push —
implemented or closed as won't-do. No deferrals, no `needs:decision`, no "revisit later". The
GEDCOM data layer is finished so work can move to the UI layer. Nothing leaves scope by being
re-filed; only by being closed with a recorded reason.

This record holds the calls. It exists because four of them (#394, #401, #402, #404) had carried
`needs:decision` for weeks and one (#480) carried `status:deferred` — states that describe a
backlog waiting on a maintainer, which is exactly what this push ends.

Re-verifying the sixteen issues against live code before deciding found six whose text had
drifted, two of them already fixed. **Never trust the issue text** — the same rule that produced
ADR 0013's four corrections produced these:

- **#406** (family-event `2 SOUR` binds to the family) was fixed 2026-07-08 in `191131b`
  (PR #238) and has read as current ever since. `parser.ts:442-451` routes a level-2 `SOUR`
  under an open family event to `currentEvent.citations`, with unit and integration coverage.
- **#423** (events have no passthrough) shipped in `c80d6cf`; `Events.RawGedcom`,
  `People.BirthRawGedcom`/`DeathRawGedcom` and `Families.MarriageRawGedcom` all exist
  (`init-schema.ts:308-316`). It stayed open only because `Closes #N` does not fire on `dev`
  merges.
- **#512** describes a note under a promoted `1 BIRT` folding into the `People."Notes"`
  **scalar**. Since #518 it becomes a
  first-class `Note` + `NoteLink('People')` (`parser.ts:1216-1222`). The defect is real; the
  stated mechanism is not.

Two defects surfaced that no issue covered, both folded into the slices below rather than filed
and left:

- **Free-text vital dates are deleted on import.** `person.BirthDate = parseDate(value)` with no
  `?? value` (`parser.ts:1110`, `:1112`, `:1307`); `parseDate` returns `null` for unparseable
  text and `DATE ∈ HANDLED_COLUMN_EVENT_L2`, so the #423 passthrough does not catch it either.
  Outright loss, not the representation shift #400 describes.
- **Merge-mode import drops notes and media** for any person or family already present.
  `insertPersonTail` / `insertFamilyTail` own notes and media and are reached only from the
  *new-record* branch (`lib/services/gedcom.ts:1168`), never from the existing-record branch
  (`:1120-1135`, `:1254-1280`). This is the answer to #492's question 3.

## Decision

| # | Call | Basis |
|---|---|---|
| #394 | **Implement** — idempotent `UPDATE "Places" SET "Form" = NULL WHERE "Form" = 'LINEAGE-LINKED'` in `initializeSchema` | Not a manual prod-only run: static/PGlite and Tauri users hold their own databases and cannot be reached later. Safe because `Places."Form"` has **no UI writer** (`lib/db/queries/places.ts:286`; zero hits in `app/places/`) — only GEDCOM import sets it, so no typed value can be destroyed. `LINEAGE-LINKED` is a `HEAD.GEDC.FORM` dialect declaration and never a valid `PLAC.FORM` place hierarchy |
| #400 | **Implement + backfill** — `parseDate(value) ?? value`, plus a JS pass over non-ISO `Events."Date"` rows | The `??` is mandatory: bare `parseDate` would delete every unparseable date. Backfill included because the existing rows are exactly the ones displaying wrongly — `formatDateForDisplay` falls back to the raw string (`date-utils.ts:143`), so an imported `26 AUG 1819` renders literally instead of `Aug 26, 1819` |
| #401 | **Implement** — emit an explicit `_PRIM N`; the parser learns to read it | Round-trips our own files losslessly while keeping the first-photo heuristic for foreign files that never emit `_PRIM`. Dropping the heuristic instead would import such files with no primary photo at all. `_PRIM` is a legal non-standard tag (`ged551-4.txt:441-444`) and 5.5.1 has no standard primary-photo marker |
| #402 | **Implement** — a fourth bundle sidecar, `places.json` | The 5.5.1 record vocabulary has no place record (`ged551-2.txt:113-289`) and `PLACE_STRUCTURE` (`:659`) is event-only, so a gazetteer row no fact references has nowhere standard to go. Unlike the accepted items below there is **no passthrough net** under it: typed coordinates on a parent-only row are simply lost |
| #404 | **Accept** — de-quarantine with a positive assertion | "Uniqueness of the cross-reference identifier is required within the transmission file" (`ged551-4.txt:225-227`). A NULL, malformed or duplicated xref *must* be replaced; preserving it verbatim would emit an invalid file. There is no implement option that is not "emit a broken file" |
| #480 | **Implement** — `People."DeathCause"` | ADR 0012 kept this out on the grounds that a death-event sub-tag has no natural home while death is a `People` column. #423 dissolved that: `People."DeathRawGedcom"` is already a death-scoped column on `People`, and `DeathCause` is the same shape. `CAUS` is `EVENT_DETAIL` (`ged551-2.txt:366`, `{0:1}`), `CAUSE_OF_EVENT` size 1:90 (`ged551-3.txt:169`) |
| #512 | **Implement** — a nullable `NoteLink."OwnerFact"` (`'Birth' \| 'Death' \| 'Marriage'`) | Keeps `OwnerTable = 'People'`, so the note stays visible in the existing UI and the `LINK_OWNER_TABLES` "real tables only" invariant (`lib/db/fact-tables.ts:50-57`) is not breached. The generator nests the pointer under `1 BIRT` / `1 DEAT` / `1 MARR` |
| #513 | **Implement** — a second same-type promoted block routes to record-level `RawGedcom` | It re-emits verbatim at record end (`generator.ts:801-806`), producing a valid second `1 MARR` / `1 BIRT` block. No schema change, and it reuses the #423 passthrough rather than inventing a mechanism |
| #501 | **Split** — model `ABBR`; accept `DATA`/`EVEN`/`AGNC` | See Rejected alternatives |

**`People."Notes"`: the precondition is completed here, the drop is not.** The one live writer
left on the column — the person form's new-person mode, which had no id to hang a `NoteLink` on
(`app/components/person-form/NotesSection.tsx:29-36`) — moves onto `Note` + `NoteLink('People')`,
which is the last item on [ADR 0010](0010-people-notes-column-is-retired-in-favour-of-first-class-notes.md)'s
precondition list and the outstanding item [ADR 0013](0013-gedcom-gap-matrix-build-corrections.md)
recorded. The `DROP COLUMN` itself is tracked as
#524 and deliberately carries **no**
`area:gedcom` label.

That split is not a deferral dressed up. Export already emits person notes as first-class
`1 NOTE @Nn@` pointers (`lib/gedcom/generator.ts:693-695`), so the column contributes nothing to
GEDCOM fidelity and its removal closes no gap this epic owns — it is schema cleanup that happens
to have been discovered here. It is also the only irreversible step that was on the table:
everything else in this push is undone by redeploying.

Recording the precondition as *met* is the point. ADR 0010 left a precondition list rather than a
date, and a list with nothing marked off is indistinguishable from a list nobody checked.

#406 and #423 close as **already fixed**, verified against code rather than commit messages.

## Rejected alternatives

**Modelling `SOUR`'s `DATA`/`EVEN` and `AGNC` alongside `ABBR` (#501).** `ABBR` is a scalar short
title that improves source lists and short citations immediately (`ged551-2.txt:251`). `DATA/EVEN`
is a source-to-event-type *relation* with its own nested `DATE` and `PLAC` (`:241-245`) — a new
join table and a new UI surface, for a field whose value is bibliographic provenance rather than
genealogical fact. `AGNC` is a scalar but has no reader. All three already survive round trips via
`Sources.RawGedcom`, so accepting them costs fidelity, not data. This is ADR 0012's stated default
— "accept-and-document is the default outcome, not maximal coverage" — applied unchanged.

**Adding `PersonBirth`/`PersonDeath` to `LINK_OWNER_TABLES` to solve #512.** It mirrors
`Citation.FactTable`, which already carries exactly those person-keyed pseudo-facts, and needs no
new column. Rejected because `LINK_OWNER_TABLES` explicitly documents itself as *real tables whose
`OwnerId` is a row id in that table* (`lib/db/fact-tables.ts:50-57`), and because a note under a
pseudo-owner has **no UI surface** — `OwnerNotesCard` is mounted per real owner. That would ship a
note the exporter can see and the user cannot, which is the precise defect class #407 existed to
fix. A nullable discriminator on the link keeps one owner and one UI.

**Accepting #512 as a non-corrupting misattachment.** Genuinely defensible: the note survives,
only its association with the birth is lost, and that loss follows directly from the locked
decision that birth and death stay `People` columns. Rejected because the fix is one nullable
column and the association is the part a genealogist actually wrote down.

**Dropping the parser's first-photo-is-primary heuristic instead of emitting `_PRIM N` (#401).**
Honest — absent `_PRIM`, "not primary" is the truthful reading — and it avoids putting a
non-standard tag on every non-primary photo. Rejected because it changes how *foreign* files
import in order to fix how *our own* files round-trip: a file from a tool that never emits `_PRIM`
would arrive with no primary photo at all, which is a worse default than a wrong guess about one.

**Running #394's remediation manually against Railway only.** Cheapest, and it fixes the databases
we can see. Rejected because the static/Cloudflare and Tauri builds put the database in the user's
browser or on their desktop; a one-off we run reaches none of them, and there is no later
opportunity that an `initializeSchema` step does not already provide.

**Deferring #402's sidecar as "a product call about bundle scope".** That was the issue's own
framing and it is why the row sat unresolved. Rejected because the scope question was already
answered three times — `cases.json`, `media.json` and `sources.json` all exist, all are additive,
and all are governed by ADR 0009. A fourth sidecar carrying the gazetteer is the established
pattern, not a new product direction.

## Consequences

**Invariants now in force:**

- **A person's GEDCOM xref is stable only when it was usable.** `assignPersonXrefs`
  (`lib/gedcom/generator.ts:265-296`) preserves a stored `GedcomId` that is non-null, matches
  `/^@I[A-Za-z0-9]+@$/`, and is unique across the tree; everything else is reminted. A reminted
  xref **may legitimately equal the value it replaced** — `nextFreeXref` counts up from `@I1@`
  skipping only *usable* xrefs, and a duplicated xref is by definition not usable. Any future test
  asserting "the xref changed" is wrong; assert uniqueness and well-formedness instead.
- **`Places."Form"` never holds `'LINEAGE-LINKED'`.** Enforced by an idempotent remediation in
  `initializeSchema`, not merely by the parser fix in `1947a59`, which was forward-only.
- **`_PRIM` is emitted for every owner-attached photo, positively or negatively.** Absence of the
  tag now means "this file came from somewhere else", which is what re-enables the first-photo
  heuristic to be a heuristic rather than a silent overwrite.
- **`SOUR`'s `DATA`, `EVEN` and `AGNC` are accepted as absent.** They round-trip through
  `Sources.RawGedcom`. A future PR modelling them should start here, and must remove them from raw
  capture in the same change or they will emit twice — the failure mode ADR 0013 recorded for
  custom-event `TYPE`.
- **Any newly modelled `SOUR` sub-tag must join `HANDLED_SOUR_L1`** (`lib/gedcom/parser.ts:159`)
  in the same commit that models it. Same rule, stated once for the whole record type.

**What this makes easy:** `area:gedcom` stops carrying decision debt. `needs:decision` and
`status:deferred` are both empty of GEDCOM issues after this push, and `status:deferred` is
retired entirely — nothing else held it.

**What this makes harder:** the accepted set (`FACT`, phonetics, name affixes, `ASSO`/`RELA`,
Citation↔Media, and now `DATA`/`EVEN`/`AGNC`) is decided, not merely unbuilt. Reopening any of them
needs a fresh record pointing back here, not a patch.
