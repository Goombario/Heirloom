# 0043 — A note can move to another thing it is about

**Date:** 2026-11-12 · **Context:** #49, #545, ADR 0016 · **Status:** Accepted · **Area:** notes / people

Supersedes decision 3 of [0016](0016-date-year-rule-and-death-only-cause.md) ("note scope is set
from context and never re-scoped by the user"). Decisions 1 and 2 of 0016 stand.

0016 named what would reopen it: "a user-facing need to *change* an existing note's scope". The
desktop person page (#49, locked prototype) lists every note about the person in one Notes
section, labelled by what it is about: the biography, the person in general, the birth or death,
or one of their events. The owner asked for an "About" select on each note so a note written in
the wrong place can be moved without retyping it, and asked for this record (2026-10-29).

## Decision

1. **A note's link can move to another record or fact it is about.** `notes.move(id, from, to)`
   moves one `NoteLink` from one end (`OwnerTable`, `OwnerId`, `OwnerFact`) to another. The note
   row, its id, its text and its other links stay as they are. A note shared with a family or a
   source stays shared.
2. **The choices come from the page, not free entry.** On the person page "About" offers the person
   in general, their Birth and Death when recorded, and each of their own events. The control
   never offers a fact the person doesn't have, which was 0016's objection to a free scope
   dropdown. A note whose current scope isn't one of those (an imported Marriage note on a
   person) keeps it as a choice, so opening a note never moves it.
3. **A move is an edit, not a delete.** Contribute access can move a note, as it can edit the
   text: nothing is destroyed. Both records must be in the tree. A note linked to one record
   twice (under two facts, #512) can't move one of those links to another record, and a move onto
   a record where the note already is refused.
4. **Undo puts it back.** On the same record the move is logged as an `update` of the link's
   `OwnerFact`, which the revert sets back. Across records it is logged as the new link's
   `create` and then the old link's `delete`; a revert runs newest first, so the old link returns
   before the new one goes and the note is never without a link.
5. **The preferred flag stays with its record.** A link moved within one record keeps
   `IsPrimary`; a link moved to another record arrives unpreferred. The biography isn't moved
   from Notes: it is edited in the cover, and "Use as biography" is how a note becomes it.

## Why

Without a move, fixing a note filed under the wrong event means copying the text, deleting the
note and writing it again, which loses its history and breaks any share. The page already knows
what each note can be about, so the select can't put a note somewhere meaningless.

## Rejected

- **Delete and recreate under the new scope.** Loses the note's id, `CreatedAt`, audit history and
  any other links.
- **A free scope dropdown in the general list (Birth, Death, Marriage for any record).** This is
  what 0016 rejected: a note could claim a fact the record doesn't have.

## Consequences

- `NoteLink."OwnerFact"` is no longer fixed at creation. `Note.OwnerFact`'s comment and
  `NotesClient.create` still describe how a note gets its first scope.
- `PATCH /api/notes/[id]` takes `{ ownerFact, moveTo: { ownerTable, recordId, ownerFact } }`
  beside `{ isPrimary }`.
- The audit revert for notes handles an `OwnerFact` field change.
- The phone page and the other notes rails keep their current behaviour; they can adopt the move
  later.
