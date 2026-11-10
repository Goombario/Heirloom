# 0013 — Building the ADR 0012 set: four corrected premises, and `_RELTYPE` retired

**Date:** 2026-08-02
**Status:** Accepted
**Area:** gedcom / notes

## Context

[ADR 0012](0012-gedcom-gap-matrix-decision-session.md) closed the #421 decision session and moved it to its Build phase, covering the four rows marked **implement**: custom-event `TYPE`, `PEDI` ↔ `FamilyPerson.RelationshipType`, Repository notes, and the People-notes half of [ADR 0010](0010-people-notes-column-is-retired-in-favour-of-first-class-notes.md) / #407.

Verifying each row against live code before building found that four of the matrix's premises no longer held — three of them in ways that would have shipped broken output if implemented as written. ADR 0012 is append-only and stays as landed; this record supersedes those four specific claims and captures one fresh maintainer decision taken during the build.

The corrections matter beyond this batch: the matrix's own method was "grep before asserting", and each of these came from a grep that was narrower than the claim it supported.

## Decision

### The four corrected premises

**1. Custom-event `TYPE` was not "one missing switch case", and the label was not being lost.** `HANDLED_PERSON_EVENT_L2` did not list `TYPE`, so since #423 the label was swept into the event's `rawLines` and round-tripped as opaque passthrough. It was a fidelity gap, not data loss. #423 landed the same day the matrix was written and the row was not re-checked against it. Adding only the parser case would have stored the label twice and emitted it twice; and the person-event emit path wrote `1 ${evt.Type}` directly, so a structured "Land Lease" would have exported as the malformed line `1 Land Lease` — re-importing as tag `Land`. The generator needed the same `STD_*_TAGS` guard the family path already had. Three changes, not one.

**2. `'Step'` had been reachable.** ADR 0012 recorded "no code path — UI, import, or otherwise — has ever actually set it" as the basis for zero-cost retirement. Three paths could set it: `POST` and `PATCH /api/families/[id]/children` both listed it in `validTypes`, and the `_RELTYPE` import wrote its value unvalidated. The column is unchecked `TEXT`, so live rows may hold it. The retirement decision stands unchanged — the reasoning behind it never depended on the value being unused — but it required a runtime guard (`isChildRelationshipType`, kept adjacent to the type) rather than a type edit alone.

**3. GEDCOM already read and wrote `RelationshipType`.** The matrix concluded "nothing currently reads or writes `RelationshipType` from GEDCOM import/export" from a grep for `PEDI`/`_FREL`/`_MREL` only. A custom `2 _RELTYPE` under `FAM.CHIL` did exactly that, in both directions. So the row was not greenfield — see the fresh decision below.

**4. The Repository note was not "S (cheap)".** The estimate assumed the same `NoteLink`-vocabulary shape as the other note rows. The generator does not read the `Repository` table at all: it synthesises `0 @Rn@ REPO` records from `Sources.RepositoryName` **strings**, deduped by name, so no `Repository.Id` existed in scope to key an owner note on. Resolved with a name → id map supplied by the export service — safe because `Repository` is unique per `(TreeId, Name)`.

### `_RELTYPE` is retired, not kept alongside `PEDI`

Maintainer decision, 2026-08-02. The custom `2 _RELTYPE` is removed from **both** the generator and the parser, rather than kept as a compatibility reader.

**Accepted consequence:** a GEDCOM this app exported *before* this change re-imports with `Adoption`/`Foster` downgraded to `Birth`. `_RELTYPE` nests under `CHIL`, itself a handled level-1 tag, so the #423 passthrough never captured it either — there is no recovery path. This is pinned by a named test (`_RELTYPE retirement`) so it reads as a decision with evidence rather than a silent regression a later PR "fixes" by accident.

### The preferred-note flag lives on `NoteLink`

ADR 0012 left the placement open ("`Note.IsPrimary` vs. a flag on `NoteLink`") and pointed at the `MediaTag`/`NameVariant` precedent. That precedent settles it: `MediaTag."IsPrimary"` sits on the **join** row, scoped by a partial unique index. `NoteLink` is the join analogue. A `Note."IsPrimary"` would mean "primary for every owner at once", which breaks the shared note ADR 0010 exists to enable — the same note attached to a person and their family could not be that person's preferred note without also claiming to be the family's.

### The People inline emit survives as a fallback

ADR 0010's task list says "remove the inline emit". Taken literally that drops any `People."Notes"` write not yet mirrored by the init-schema backfill from every export until the next server boot. ADR 0010's own Consequences say "until the column is dropped, both models are live and **the column is the fallback**", so the emit is kept, conditioned on the person having no first-class note. The `NICK:`/`_AKA:` prefix extraction that lived inside that block runs unconditionally — ADR 0010 named it specifically as the thing not to lose.

### `TYPE` names an event only in its generic `EVEN` form

Caught in review of this batch. `TYPE` is not an `EVEN`-specific tag: it is the first member of `EVENT_DETAIL` (`ged551-2.txt:359-361`) and legal under every event — *"The TYPE tag can be used with each of the above tags used in this structure"* (`:448-449`). Treating it as the event's name unconditionally turns a `1 BURI` / `2 TYPE Cremation` into an event of type `"Cremation"`, which then exports as `1 EVEN` / `2 TYPE Cremation` — the burial is gone from the database, the UI, and every later export.

So the mapping is guarded to `currentEvent.Type === 'EVEN'`, and `TYPE` is only excluded from raw capture for the generic form (`HANDLED_*_EVEN_L2`). Under a standard tag it stays passthrough, as before.

**The family path had the same defect already** — `HANDLED_FAMILY_EVENT_L2` has always listed `TYPE` and `processFamilyTag`'s case has always been unguarded, so `1 DIV` / `2 TYPE Civil` parsed to type `"Civil"` and exported as `1 EVEN`, losing the divorce. Fixed symmetrically here: "mirror the family side" would otherwise have mirrored a bug.

### Accepted: unmodeled `FAMC` sub-tags are dropped

Closing the stale sub-raw scope on a level-1 `FAMC` (see the invariant below) is what lets `2 PEDI` reach its handler. The cost is that `FAMC`'s *other* unmodeled sub-tags — `2 STAT` (`CHILD_LINKAGE_STATUS`) being the standard one — now have no capture target and are dropped. Previously they were swept into whichever event scope happened to be open and re-emitted misattached under it (a `2 STAT` re-emerging under `1 DEAT`), which preserved the bytes but not the meaning, and only when some event scope happened to precede them.

Accepted as a clean loss in place of situational corruption. Closing it properly needs a dedicated per-`FAMC` raw column, the way #423 added `BirthRawGedcom`/`DeathRawGedcom`/`MarriageRawGedcom` — a schema change out of scope here. Pinned by tests in `gedcom-pedi.test.ts` so it reads as a decision.

## Rejected alternatives

**Keeping `_RELTYPE` on import as a compatibility reader while emitting only `PEDI`.** This was the recommended option: it costs one switch case and removes the only data-loss path in the batch, since files this app already exported are the only files in the world containing `_RELTYPE`. Rejected by the maintainer in favour of a clean break. Recorded here with its consequence rather than silently.

**Fixing the note-cleanup gap while adding `Repository` as a note owner.** `deleteNotesForOwner` has no callers, so *no* owner cleans up its note links on delete. Repository now behaves exactly like Sources and Places; fixing it for one owner alone would be inconsistent, and fixing it for all six is separate work.

**Stripping `NICK:`/`_AKA:` prefix lines from backfilled note text on export.** A legacy column of `"NICK: Bill\nHe was a farmer."` was mirrored verbatim into a `Note` row by the backfill, so the prefix line now also appears inside the shared note's text. Rejected because a note's text is emitted once as a shared record across all its owners — rewriting it per-owner would break sharing. Cosmetic redundancy in a legacy edge case, and strictly better than losing the `NICK` tag.

## Consequences

**Invariants now in force:**

- `RelationshipType` never contains `'Step'` — enforced at runtime by `isChildRelationshipType` in the **services** (`addChildToFamilyService` / `updateChildTypeService`), not only in the route handler and not only by the TypeScript union. The service is the real choke point: the static/desktop build's `LocalFamiliesClient` calls it directly and never passes through a route. `POST` still defaults when the field is absent. Existing rows holding `'Step'` keep rendering as unrecorded and are **not** migrated.
- Backfilled person notes carry their **person's** tree, not the owner's default tree. The `People."Notes"` backfill inserts `Note` rows with no `TreeId`, and the generic stamping pass fills it from the owner's lowest-Id tree — which silently hid legacy notes for anyone whose person lived in a second tree, once the UI moved to tree-scoped reads. Repaired idempotently after the stamping pass.
- Promoting a primary note validates membership **before** writing, and demote+promote run in one transaction (mirroring `setPrimaryForPerson` in `media.ts`). Demoting first would clear the owner's preferred note on a request that then 404s; two concurrent promotes would interleave into an `idx_notelink_one_primary` violation.
- Pedigree linkage travels as standard `2 PEDI` under the child's `1 FAMC` only. `sealing` stays unmapped by design and falls back to the column default.
- At most one primary note per `(OwnerTable, OwnerId)`, enforced by `idx_notelink_one_primary`. Promoting requires demoting first — the index rejects a second primary, so the demote is correctness, not tidiness.
- A person's notes are first-class `Note` + `NoteLink('People')` rows. `People."Notes"` is written only by the person form's **new** mode (no id exists yet to link against) and remains readable as the export fallback until its retirement slice.
- Any new level-1 person tag must close an open `subRawTarget` scope. The dispatch chain previously left one open for every tag outside `NAME`/`BIRT`/`DEAT`/`_LIVING`/events/`OBJE`, so a `2 PEDI` under a `1 FAMC` following a `1 DEAT` was captured into `deathRawLines` and re-emitted misattached under `1 DEAT`. Fixed here; the `else` branch is load-bearing.

**What this makes easier:** the `gedcom-roundtrip-semantic` quarantine on notes (`it.fails('preserves notes at every scope')`) is lifted — it documented exactly the #407 drop and was explicitly waiting on "a design call, not a patch". That call was ADR 0010.

**What this makes harder:** nothing new is blocked, but the `People."Notes"` drop now has a precondition list rather than a date: all three UI writers are off the column, export emits first-class notes, and the fallback is the only remaining reader.
