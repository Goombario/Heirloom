# 0052 — A person merge is one revertible change

**Date:** 2026-11-21 · **Context:** #28 · **Status:** Proposed · **Area:** people / audit

A real duplicate could only be deleted, and its citations, notes, names, photos and family links
went with it. The decisions on #28 (2026-11-20) and its locked mockup settle what a merge does.

## Decision

1. **One record is kept, the other moves onto it and is removed.** The reader picks the record to
   keep. For each field that differs (name, sex, living status, birth, death) the kept record's value
   is the default and the other one can be taken instead. A birth or death date and its place move
   together, as one choice per event.
2. **Everything moves.** Events, citations, name variants, note links, photo links, face tags and face
   suggestions, case and lead links, claims, data-check confirmations, partner slots and child links
   all point at the kept record afterwards.
   - The name that isn't kept becomes an Alias name variant, and the citations on it follow it.
   - Citations on birth, death and the whole person stay with that fact whichever value is kept, so
     both people's sources end up on the kept fact.
   - Where the kept record already has the same link (a photo, a note, a face tag on the same photo,
     a case, the same family as a child), the other person's copy is dropped: the two child links in
     one family become one. A primary photo, note or preferred name moves only where the kept record
     has none.
3. **Some pairs can't be merged.** Two people who are the partners of one family, or where one is a
   partner in a family the other is a child of, would become their own partner or parent. The merge
   is refused and names the family. Two families with the same other partner are both kept.
4. **A merge needs edit permission.** It rewrites many records at once, like a place merge
   (`renamePlaceService`), so a contributor can't merge.
5. **One audit entry holds an undo log.** The entry is a `person` update with
   `summary.kind = 'person_merge'`. Its `merge` object lists, in order, every row the merge
   changed (with the whole row as it was), deleted (the whole row) or inserted (its key), plus counts
   and the values not kept for the log. The rows are named by table and key from a fixed list of
   tables, and revert checks each name against that list.
6. **Revert is exact.** Reverting the merge first reverts, newest first, every later audit entry on the
   kept person or on a record that points at it, then plays the undo log backwards: the removed
   person comes back under the same id, and every moved row gets its old values back. The Revert
   confirmation lists those later changes first. A merge that was already reverted can't be reverted
   again.

## Consequences

- No schema change: the undo log lives in the audit entry's `Changes`.
- Something added to the kept person after the merge without its own audit entry (none today) would
  stay on the kept person after a revert.
- Generated columns (`SearchName`) are never written by revert; the database recomputes them.
- The home person on a device (`selectedRootPerson`) can name the removed record; the tree then
  falls back to its usual default.
