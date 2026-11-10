# 0037 — Facts keep no place text; it is built from their references

**Date:** 2026-10-29 · **Context:** #1186, ADR 0035, ADR 0036 · **Status:** Accepted · **Area:** places / gedcom

ADR 0035 made a fact's place references the truth and kept its text as a copy, so the code
that read the text could move over in steps. ADR 0036 then let two places share a name, so
the text alone can no longer say which place a fact means. The maintainer approved the last
step of the #1186 plan: drop the copies, build the text from the references when it is read,
and match text only once, when it is saved.

## Decision

1. **v64 drops the text columns.** `People.BirthPlace` / `DeathPlace`,
   `Families.MarriagePlace` and `Events.Place` go, with their four indexes. A fact's place is
   its `…PlaceId` and `…PlaceNameId` and nothing else.
2. **The upgrade proves nothing is lost before it drops anything.** On a database that still
   has the text (one from before v64, or a backup restored from one), `initializeSchema`
   runs the old link pass once more, then counts the facts whose references don't spell
   their text exactly. Any such fact stops the upgrade with the text kept, and the error
   names how many facts of each column (`lib/db/place-text-migration.ts`). The text columns
   go only when that count is zero.
3. **Readers get the text under the old names.** `factPlaceTextColumns` /
   `factPlaceTextSql` (`lib/db/queries/place-links.ts`) build it in SQL: the other name the
   fact points at, when that name still belongs to its place, else the place's own name. The
   queries add them to their select lists, so the screens, search, the GEDCOM writer,
   places.json and the audit snapshots read `BirthPlace` and the rest as before.
4. **Writers resolve text once, at save time.** The forms and importers still send text.
   `factPlaceRefs` matches each changed field: a place the user picked when its own or other
   name is the text, else the most-used place of that name, else the place it is another
   name of, else a new bare place. An unchanged field keeps its references. There is no
   every-init link pass any more.
5. **Undo restores the place itself.** An update's audit entry records the references before
   and after (`Changes.places`), including a move between two same-name places. Undo puts
   the saved reference back while it still spells the recorded text, and matches the text
   otherwise. Entries logged before v64 carry only text, which is matched as it was.
6. **Imports link inside their transaction.** The GEDCOM import writes facts without places
   and keeps their text in memory. Inside the same transaction, after the places.json
   restore, the `PLAC.MAP` pass and the promotion pass, it links every fact at once, then
   applies places.json's facts map. The three place passes stay best-effort, each behind a
   savepoint. The link itself is not: if it fails, the import fails. The spreadsheet import
   resolves its places before inserting.
7. **GEDCOM round trips are unchanged.** The writer emits the built text as `PLAC`, and the
   importer matches it again. places.json still says which of two same-name places each
   fact means.

## Consequences

- Each read of a fact's place is two keyed subselects. Per-row lookups by primary key, they
  are cheap at family-tree sizes; a large list that does not need the place should not
  select it.
- A text that names no place makes a bare place at save time, before the save commits. Two
  saves of the same new name at once can still make two rows, as under ADR 0036.
- `ON DELETE SET NULL` on the references stays as a backstop, but it is now lossy. Deleting
  a place that facts point at leaves them with no place, and deleting another name leaves
  its facts under the place's own name. Every delete in the app (merge, undo of a created
  place, tree delete, overwrite import) moves or deletes the facts first, or keeps the row
  while anything points at it.
- A fact with text but no tree (only possible in very old data) blocks the upgrade until it
  is given a tree or its place is cleared.
- Going back to a build from before v64 needs a backup from before v64: older builds read
  the text columns, which are gone.
