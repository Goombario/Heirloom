# 0046 — Answer and close fills gaps and adds events, each change cited and undoable

**Date:** 2026-11-12 · **Context:** #58, ADR 0045, ADR 0042 · **Status:** Proposed · **Area:** cases / data-integrity

ADR 0045 keeps a case's claims apart from the tree until the case closes, and says Answer and close
applies the accepted ones, each as its own audit entry, with **Undo** on the closed case. This ADR
settles what applying a claim writes. The maintainer chose "Fill gaps, add events" on 2026-11-12.

## Decision

1. **Only accepted claims about a person in the tree are applied,** and only the ones ticked on the
   Answer and close page. Each claim is applied at most once (`"AppliedAt"`).
2. **A birth or death fills empty fields.** The claim's date and place go into the person's empty
   `BirthDate` / `BirthPlace` (or `DeathDate` / `DeathPlace`). Where the tree already says
   something else, the page shows it with a **Replace** checkbox that starts unticked; only a ticked
   Replace overwrites it, and ticking Replace takes Edit access (Contribute fills gaps and adds
   events only). A death also marks the person deceased. When the tree already says what the
   claim says, nothing is written but the record is cited on the fact.
3. **Other life events become new events.** Baptism, burial, residence, occupation, census,
   emigration, immigration and naturalisation become an `"Events"` row on the person: the claim's
   type, date and place, with what the record says as the description. When the person already has
   an event of that type on the same date, the record is cited on that event instead.
4. **Each change cites the record.** The claim's finding's source, page, link and transcription are
   cited on the fact the change wrote (`PersonBirth`, `PersonDeath` or the event). An identical
   citation already there means the claim is listed as already in the tree, with nothing to do.
5. **Two audit entries per claim, both kept.** The fact change (person update or event create) and
   the citation are separate entries, as an edit on the person page would make them. v70 adds
   `"CaseClaims"."AppliedCitationAuditId"` beside v69's `"AppliedAuditId"`; when the change is a
   citation alone, it is `"AppliedAuditId"`.
6. **Marriages, parents, free-text claims and people not in the tree are entered by hand.** The
   page lists them under "To enter by hand"; nothing is written for them.
7. **Applying and closing is one transaction.** The page sends the answer, the outcome and the
   ticked claims; the server works out each change again from the rows as they are, after the one
   before it (so a second claim about the same fact cites it, or needs Replace), applies them, then
   closes the case with the answer as its last journal entry. A choice that is no longer a
   change fails the whole close.
8. **Undo reverts both entries, newest first,** through the audit log's own revert, and clears the
   claim's applied mark; the case stays closed. It takes Edit access, like reverting from the audit
   log. It is refused when the person's birth or death, or the new event, has been edited since, or
   the event has gained other sources, so it never overwrites later work. A change already undone
   elsewhere (from the audit log, or its record deleted) just clears the claim's mark.
9. **A case that changed the tree can't be deleted** until its changes are undone, so the record of
   where those facts came from isn't lost.

## Why

- **Filling gaps only** never loses what the tree said; a replacement is a deliberate tick.
- **New events with a citation** put the research where the person page shows it, sourced.
- **Separate entries** match ADR 0045's "each change its own audit entry", so a change can be
  undone from the case or from the audit log.
- **Marriage and parents** need a family to be chosen or made, which is a form, not a checkbox.

## Rejected

- **New events only, birth and death included:** the app keeps a person's birth and death on the
  person (`assertNotPersonVital`), so a birth event would be a second copy of the fact.
- **A list only, applying nothing:** the owner wanted the case to finish the work it found.
- **Finding the citation's audit entry when undoing** (same transaction time, same source) instead of
  storing it: it guesses, and a guess that misses leaves a citation behind.

## Consequences

- Schema v70 adds one nullable column. cases.json keeps exporting `AppliedAt` only; an imported case
  shows what it applied but offers no Undo, since audit entries don't travel.
- The desktop Answer and close page replaces the old close dialog. The phone keeps its own close.
