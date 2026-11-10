# Citations — Design Specification

> Status: **Implemented**
>
> Durable interaction and ownership rules are recorded in [ADR 0018](../decisions/0018-citations-remain-fact-scoped.md).

> Approved UI direction (2026-09-11): **01A quiet citation preview** and
> **02A grouped citation workspace**. Use the
> [durable HTML reference](../mockups/citation-photo-approved-structures.html)
> and [implementation plan](../superpowers/plans/2026-09-11-citation-and-photo-ui-structures.md)
> for the approved hierarchy; this specification remains authoritative for data,
> ownership, permission, and interaction behavior.

## Data model

`Citation` joins one persisted fact to one `Source` through `(FactTable, FactId, SourceId)`. Evidence specific to that assertion stays on the citation: `Page`, `Quay`, `DataText`, `DataDate`, `Even`, and `Role`. The application does not create a second assertion entity.

Canonical fact-table values live in `lib/db/fact-tables.ts`. Person-wide reads include person-keyed facts, that person's `Events`, and `NameVariant` rows. Family-wide reads include the `Families` row and `Events` whose `FamilyId` is that family. Derived child rows and inferred partnership-end rows are display context, not family-owned facts.

## Source pins

- An empty `+` pin is an invitation to attach evidence. Editors open the citation drawer directly in Add mode; viewers do not receive an inert action.
- A filled numbered pin represents one citation record. It opens that citation in an anchored desktop preview or the shared mobile bottom sheet.
- The preview identifies the supported fact (`label — value`) and shows the source, repository, page, readable certainty, and transcription excerpt.
- Everyone with tree access may open the source. Editors may continue directly into the citation editor.

## Citation drawer

`CitationDrawer` is the shared citation workspace. It reuses the established source picker/editor rather than competing with the photo-lightbox `EvidencePanel`.

Single-fact mode lists attached citations, attaches an existing or new source, and edits or detaches citation evidence. Owner-wide mode groups citations by their supported fact. Editors can enter the single-fact workspace; view-only users receive the same evidence list without mutation controls.

Person and family detail pages expose owner-wide mode from the **Sources cited** header as **Manage all citations →** or **View all citations →**, using the standard detail-rail action treatment.

## Sources cited ledger

The rail card is a source rollup and assertion ledger:

- Each source appears once.
- Beneath it, each distinct supported fact appears as `label — value`.
- The count is the number of distinct facts, not the number of citation rows.
- Multiple citations from one source to the same fact remain separately editable in the drawer but count as one supported assertion.
- An unfamiliar or deleted display association is shown with a stable `{FactTable} #{FactId}` fallback; evidence must not disappear because its display row is unavailable.

## Permissions and scope

Reads use `resolveTreeScope` and are available to tree viewers. Adds and edits require contribute-or-better access; detachment follows the existing delete ladder. All SQL remains tree-filtered.

Family-wide HTTP reads use `GET /api/citations?familyId=<id>`; they include the children's `PersonBirth` and `PersonDeath` citations, because the family timeline shows and pins those facts. Person-wide reads continue to use `personId`; one-fact reads use `factTable` plus `factId`. Hosted and local/PGlite clients implement the same contract.

## Citing one source on many facts

"Cite on…" in the source view (#799) cites one source on many person facts through `POST /api/citations/bulk` (`citations.createMany`). The body carries a shared `Page`, `Quay` and `DataText` and a `facts` list of `{ FactTable, FactId, Page? }`, where a fact's own `Page` overrides the shared one. It accepts person and family fact tables only, at most 200 facts, and cites a fact listed twice once. Every fact is checked against the tree before any row is written, and the rows and their audit entries commit in one transaction.

The picker adds people one at a time or as a household (a family's partners and children). It offers each person's facts as their page shows them. It ticks the facts dated in the year the source's title names, and it disables facts already citing the source. The Attach drawer lists the tree's five most recently cited sources before any search (`GET /api/sources?recent=true`).

## Deferred citation creation

New person/family forms and the Cases journal may queue a citation before the cited row exists. The pending value carries either an existing source ID or a complete new-source payload plus `Page`, `Quay`, and `DataText`. The flush creates the source when necessary, then creates the citation without dropping those evidence fields.

## GEDCOM mapping

| Feature | GEDCOM encoding | Round-trip |
|---|---|---|
| Per-fact citation | `SOUR @S1@` sub-record on fact | Yes |
| Locator detail | `PAGE` under `SOUR` | Yes |
| Certainty | `QUAY` under `SOUR` | Yes |
| Transcription | `DATA` / `TEXT` under `SOUR` | Yes |
| Citation note | `NOTE` under `SOUR` | Yes, subject to parser limits |
| Cases | Backup sidecar | No GEDCOM analogue |

## Accessibility and responsive behavior

Pins are keyboard-operable with localized accessible names. Desktop previews stay anchored within the viewport and close on outside click or Escape. Mobile previews use the shared Vaul `Sheet`, including its swipe, scrim, Escape, title, and safe-area behavior. Citation actions use text as well as amber styling; color is never the only cue.
