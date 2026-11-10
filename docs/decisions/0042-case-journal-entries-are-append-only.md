# 0042 — Case journal entries are append-only: struck out, never edited or deleted

**Date:** 2026-11-07 · **Context:** #1251, #1227, ADR 0028 · **Status:** Accepted · **Area:** cases / data-integrity

A case's research journal is a chain of events: what was checked, what it showed, and what was
believed at the time. #1227 (PR #1238, schema v67) let entries change: Contribute access edited
its own notes, and Edit access edited or deleted any. The owner reversed that on 2026-11-05.
An entry that changes after it was written loses the record of what was believed and when.

## Decision

1. **A journal entry never changes after it is posted.** No route, service or client edits its
   text or deletes it. The edit and delete endpoints (`PATCH`/`DELETE
   /api/cases/[id]/comments/[commentId]`) are removed, with their client methods.
2. **An entry that is no longer accurate is struck out.** `"CaseComments"` carries
   `"StruckAt"`, `"StruckBy"` (`ON DELETE SET NULL`) and an optional one-line `"StruckReason"`
   (schema v68). The text, photo and citation stay as written. A struck entry shows in place,
   greyed and crossed out, with "Struck out by X · date · reason"; its citation and photo stay
   visible but muted. It is never hidden behind a toggle.
3. **Only a researcher's note can be struck.** The status and conclusion lines the app writes
   are the case's own history. The `casecomments_struck_check` constraint refuses a marker on
   them, and refuses a reason or striker without a strike.
4. **Who may strike.** The note's author with Contribute access, and anyone with Edit access or
   the owner. Viewers can't. The same people can undo a strike (`POST`/`DELETE
   /api/cases/[id]/comments/[commentId]/strike`). A closed case's journal is read-only, as it
   is for adding; reopen the case first. An author can undo a strike an editor put on their
   own note: retracting and restoring one's own note is the author's call, and the change is
   audited either way.
5. **Strikes are audited and revert.** Each strike or undo is a `casenote` audit entry (the type
   v67 added) whose snapshot keeps the marker before and after; a revert puts the old marker
   back and logs its own entry. Undo on the toast is that revert, so it needs Edit access
   (ADR 0028); a contributor undoes their own strike with "Undo strike out".
6. **The edits and deletes #1227 logged stay in the log but no longer revert.** Reverting one
   would change an entry again. Entries already edited under #1227 are left as they are; the
   audit log keeps their history.
7. **cases.json carries the strike.** A struck note exports `StruckAt` and, when given,
   `StruckReason`, additively (ADR 0009). Import keeps them; who struck it stays behind, as the
   author does, so an imported strike shows no name. A merge strikes a matching note that still
   stands only when its text and written time both match and its case isn't closed; like the
   rest of an import, that isn't audited. A strike on a status or conclusion line is ignored.

## Why

- **The journal is evidence of the research process.** Striking keeps both what was written
  and the fact that it was later doubted, with when and why.
- **A marker on the row, not a new entry type,** keeps the struck entry where it was written in
  the timeline, so the reader sees what was believed at that point.
- **Same permission ladder as before,** minus delete: the author can retract their own note,
  and an editor can retract anyone's.

## Rejected

- **Keeping edit with a version history:** the journal would show only the latest wording, and
  the old wording would live in the audit log, which most readers never open.
- **Hiding struck entries behind "Show struck out (N)":** the point is to keep them visible.
- **Re-running a #1227 delete's revert to bring an entry back:** it reopens the edit path that
  this record closes. Nothing is lost that the audit log doesn't hold.

## Consequences

- Supersedes the #1227 edit and delete behaviour; `restoreCaseNote` and the snapshot restore of
  journal rows are gone.
- A struck note isn't used as the case card's preview or the home page's last entry.
- A citation on a struck note can still be opened from its chip.
- A revert puts back the marker its entry recorded, even over a newer strike; that revert is
  logged and can itself be reverted.
