# 0010 — `People."Notes"` is retired in favour of first-class `Note` rows

**Date:** 2026-08-01
**Status:** Accepted
**Area:** gedcom / people

## Context

Notes exist twice for people. `People."Notes"` is a scalar column inherited from the .NET app.
`Note` + `NoteLink(OwnerTable, OwnerId)` is the first-class model that Families, Sources,
Events and Places already use.

GEDCOM export drops the first-class form for people **entirely** (#407).
`lib/gedcom/generator.ts:316-319` builds the shared-note set by excluding `OwnerTable='People'`,
on the reasoning that person notes are emitted inline from the column at `:612-626` and would
otherwise double-emit. But `generatePersonRecord` never looks up `noteXrefsByOwner('People:<id>')`
the way the Sources / Events / Families / Places paths do. So a People-owned `Note` row has no
path out at all — no shared record, no inline text, nothing. `POST /api/notes` accepts that
shape and `People` is already in `LINK_OWNER_TABLES`, so the row can exist in a database today.

Import is lossy in the mirror direction: `lib/gedcom/parser.ts:772-779` folds a resolved shared
`@N@` note's text into the scalar column, so a note shared between a person and a family
round-trips into two unrelated notes.

The *expand* half of the migration already ships. `lib/db/init-schema.ts:700-724` mirrors every
non-empty `People."Notes"` into `Note` + `NoteLink('People')`, idempotent via
`Note."BackfilledFromPersonId"`, and its own comment records that the column is deliberately
**not** dropped there, pending "a later retirement slice". So what remains is a contract step,
not a migration to be written.

## Decision

**Retire `People."Notes"`.** People move onto the shared `Note` + `NoteLink` path like every
other owner.

**The column is not dropped in the same slice.** It stays in the schema, still written, for one
release as a rollback net; a later slice removes it.

The work this commits to:

- **UI** — replace the three column writers with the existing generic `OwnerNotesCard`
  (`ownerTable="People"`), already wired for Families, Sources and Places:
  `app/components/person-form/NotesSection.tsx:22-23`,
  `app/components/tree/person-sidebar/SidebarContent.tsx:214-215`,
  `app/people/view/InlineNotesCard.tsx:50`. This closes the UI gap in #407's scope note — it is
  part of this decision, not separate work.
- **Parser** — person notes become `Note` + `NoteLink('People')` rows instead of folding into
  the column (`lib/gedcom/parser.ts:772-779`, `:1013-1024`), so a shared note stays one note.
- **Generator** — remove the People exclusion (`:317-318`) so people join the shared `@Nn@`
  path, and remove the inline emit (`:612-626`).
- **Do not lose the legacy prefix extraction.** The `"NICK: "` / `"_AKA: "` promotion lives
  *inside* that inline emit block (`:616-619`). It exists for pre-`NameVariant` imports.
  Deleting the block deletes it too — preserve it, or prove it dead, as its own step.
- Only once all of the above has shipped and been exercised does the column get dropped.

## Rejected alternatives

**Keep the column and de-duplicate on export** — teach `generatePersonRecord` to read
People-owned note links and reconcile them against the inline text. Smallest diff, and it does
fix the reported drop. Rejected because it makes the duplication permanent and load-bearing:
every future read, write, import and export of a person note would have to know which of the
two models is authoritative and de-duplicate on the fly — and de-duplication by text comparison
is a guess, so an edited copy of the same note silently becomes two notes. It also leaves the
lossy import fold in place, so the shared-note case stays broken. Families / Sources / Events /
Places already went the other way; People being on a second model is the *only* reason the
export needed a People-shaped exception in the first place.

**Retire and drop the column in one slice.** Cleaner end state, no dual-write window. Rejected
for sequencing risk only, not direction: the readers are spread across the person form, the tree
sidebar, the person detail page, the parser and the generator, and the drop is the one step in
this migration that cannot be undone by redeploying. A release with both models present costs a
dual write and buys a reversible mistake.

## Consequences

- **This is the sequencing constraint on the column drop.** People must be reading and writing
  first-class notes, and export must emit them, *before* `People."Notes"` is dropped. Dropping
  it first is total person-note loss. That is why #407 is P1 despite no UI writing that shape
  today — the exposure is in the future, not the present.
- The backfill at `lib/db/init-schema.ts:700-724` is the expand step and stays. It is idempotent,
  so it remains safe to re-run throughout the retirement.
- Once People are on the shared path, `generator.ts` has no owner-table exception left and the
  note-emit path is uniform across every owner in `LINK_OWNER_TABLES`.
- A person can then have several notes rather than one blob. UI that assumes a single note — the
  tree sidebar's collapsible textarea — has to become a list.
- Until the column is dropped, both models are live and the column is the fallback. After, `Note`
  is the only person-note store.
