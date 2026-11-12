# 0045 — A case holds leads, findings and claims; the tree changes only when the case closes

**Date:** 2026-11-12 · **Context:** #58, ADR 0042, ADR 0009 · **Status:** Proposed · **Area:** cases / data-integrity

The desktop research workspace (#58) turns a case from a title, a description and a journal into
a piece of research: the case holds **leads**, each lead gathers **findings** from records, a
finding makes **claims** that are decided in place, and the case closes with an answer that
applies the accepted claims to the tree. Records asked of an archive or a relative are tracked as
**requests**. Journal entries can be filed under several leads. None of this has a home in
GEDCOM, so it is the app's own model (schema v69).

## Decision

1. **Leads.** `"CaseLeads"` holds a case's sub-questions: the question, optional from/to years,
   their order, and when (and by whom) the lead was settled or dropped. `"CaseLeadPerson"` holds
   each lead's people. A lead's status is **worked out, never stored**:
   - **Settled** when `"SettledAt"` is set;
   - **Waiting** while one of its requests is still waiting;
   - **To search** with no findings;
   - **In progress** otherwise.

   A dropped lead keeps its findings (they stay in All evidence) and leaves the rail. A new case
   gets its question as the first lead, with the case's people. Every existing case gets the same
   first lead when v69 runs.
2. **Findings.** `"CaseFindings"` is one record a lead turned up, or one search that turned up
   nothing:
   - **Record** (`Kind = 'record'`): the source is a citation in the existing `"Citation"` table
     (`FactTable = 'CaseFindings'`), the same way a journal entry cites a source. It can also carry
     an image or PDF (`"MediaId"`) and how the record came to be: `"SourceNature"`
     (original / derivative / authored) and `"Information"` (primary / secondary / unknown).
   - **Nothing found** (`Kind = 'nothing'`): what was searched, where, and a note.

   A finding is filed under one or more leads (`"CaseFindingLead"`), or under none for the whole
   case. A source added to the case this way is "new evidence"; records already in the tree stay
   in the library.
3. **Claims.** `"CaseClaims"` are what a record says, one row each:
   - what (a fact key such as `BIRT`, or free text);
   - about whom (a person in the tree, or a name for someone not in it yet);
   - what it says, a date and a place;
   - the kind of evidence (direct / indirect / negative).

   Each claim is decided in place, **Accepted / Rejected / Undecided**, with who decided it and
   when. A decision is case work, not a tree change, so it is not audited; the journal shows the
   finding. A claim stays apart from the tree's facts until the case closes. `"AppliedAt"` and
   `"AppliedAuditId"` record the change Answer and close made from it, so the closed case can
   offer **Undo**, and each change is its own audit entry.
4. **Decisions lock with their lead.** A settled lead's claims can't change until it is reopened.
   A claim on a finding filed under several leads is locked if any of them is settled. Nothing
   can change once the case is closed.
5. **Requests.** `"CaseRequests"` tracks a record asked for:
   - what, who holds it, how it was sent, when, their reference, and a reminder date;
   - its state (waiting / they sent it / they have nothing) and the reply's note.

   Heirloom sends nothing. A request belongs to a lead, and a waiting request puts its lead in
   **Waiting**.
6. **The journal tells the story.** The app writes entries of new kinds: `finding` (a record
   added), `search` (nothing found), `request` and `reply`. They point at their finding or request
   (`"FindingId"`, `"RequestId"`, `ON DELETE SET NULL`). `"CaseCommentLead"` files any entry under
   one or more leads; an entry filed under none belongs to the whole case. The append-only rule
   (ADR 0042) is unchanged: only a researcher's note can be struck out.
7. **The case knows its scope and outcome.** `"Cases"` gains from/to years, a focus place (text),
   the kind of question it started as (`"QuestionKind"`), and, once closed, its outcome (answered / ruled out /
   unresolved) and when it closed. The answer itself stays the `conclusion` journal entry.
8. **Existing case citations stay where they are.** A citation on the case itself
   (`FactTable = 'Cases'`) shows in All evidence as a source with no claims yet. v69 moves no
   data into findings.
9. **cases.json carries all of it, additively (ADR 0009).** A case that has leads, findings,
   claims or requests exports them; `version` stays 1. People are referenced by xref, sources by
   their `@Sn@` xref, and images by media xref, as elsewhere in the sidecar. Import rebuilds them
   in order (leads, requests, findings with their citations and claims, then filing), mapping each
   reference through the same tables as the rest of the import and dropping one that doesn't
   resolve.
10. **People stay linked through a delete and its Undo.** A person's lead links and the claims
    about them come back with the person, like `"CasePerson"`. A claim about a deleted person
    keeps its text and loses the link (`ON DELETE SET NULL`).

## Why

- **Worked-out lead status** can't drift from the findings and requests that define it.
- **Findings cite through `"Citation"`** so a source's "cited by", source deletion and the
  citation editor already cover them. A second citation model would split the library.
- **Claims apart from facts** keep conflicting evidence visible until the researcher decides,
  which is the point of the workspace. Applying them is a deliberate step with its own audit
  entries.
- **Migrating no citations** keeps v69 additive: an old case looks the same until it is worked
  in.

## Rejected

- **A stored lead status:** every write would need to keep it in step, and a missed one would
  show a lead as Waiting forever.
- **Claims as pending tree facts** (an `Events` row with a "proposed" flag): every fact query
  would have to learn to skip them, and a rejected claim would linger in the tree's tables.
- **One audit entry for Answer and close:** the owner decided each change gets its own entry, so
  each one can be undone alone.

## Consequences

- Schema v69 adds seven tables and five `"Cases"` columns. It replaces the `"CaseComments"."Kind"`
  check with one that allows the new kinds.
- The phone case page reads the new journal kinds as plain entries. Its redesign is #57.
