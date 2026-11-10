# 0016 — Dates stay strings with a derived sort year; cause stays death-only

**Date:** 2026-08-08
**Status:** Accepted
**Area:** gedcom

## Context

#421 closes only when every open
`area:gedcom` issue is resolved — implemented or closed as won't-do, no re-filing. Two remaining
issues are won't-do calls that need a record before they can close:

- **#490 item 3** — "structured modeling" for dates: `yearOnly()` / `calcAgeAtDeath()`
  (`app/families/view/derive.ts`), `computeEndedYear`, and the SQL year extraction in
  `lib/db/queries/families.ts` all "degrade on a range" because dates are stored as strings and a
  year is pulled out of them. Item 1 of #490 (teaching `parseUserDateInput` the qualifier grammar)
  is a separate, already-scoped fix; item 3 is the question of whether the storage model itself
  should change.
- **#547** — life events on the timeline have no Cause field; only the two death surfaces #480
  added expose one. The issue asks whether cause should become a general `Events` field or stay
  death-only.

A third issue, **#545**, surfaces a related but distinct gap in note scoping that this record also
closes as an accepted limitation rather than a defect, per the same maintainer direction that
produced [ADR 0014](0014-gedcom-tail-closure-decisions.md): every open `area:gedcom` issue resolved
this push, no deferrals.

Tasks 1 and 2 of this plan already implemented the #490-item-1-adjacent piece that this record
depends on: `sortableYear()` (`lib/date-utils.ts:197-205`) is now mirrored by a SQL function
`"SortableYear"(text)` (`lib/db/init-schema.ts:1168-1182`), and both call sites in
`lib/db/queries/families.ts` (`:90`, `:163`) use it. A parity test
(`__tests__/unit/sortable-year-sql-parity.test.ts`) and a query-level regression test
(`__tests__/unit/families-sortable-year-sql.test.ts`) already exist and already cite this ADR by
number — this record is what makes those citations resolve.

## Decision

**1. #490 item 3 — no structured date type. Dates stay strings; a year is derived, once, in one
place.**

The rule lives in `sortableYear()` (`lib/date-utils.ts:197-205`):

```ts
export function sortableYear(date: string | null | undefined): number | null {
    if (!date || !date.trim()) return null;
    const q = splitDateQualifier(date);
    if (q) {
        if (q.prefix === 'PHRASE') return null;
        return bareYear(q.parts[0]);
    }
    return bareYear(date);
}
```

`"SortableYear"(text)` (`lib/db/init-schema.ts:1168-1182`) implements the same branches in SQL —
phrase (parenthesised) → `NULL`, `BET x AND y` → the year of `x`, everything else → the first
4-digit run — and the comment there documents the branches in the same order as
`splitDateQualifier` (`lib/date-qualifiers.ts:36`) specifically so the two cannot drift silently.
`sortable-year-sql-parity.test.ts` runs both implementations over the same fixture set and fails on
any disagreement; that test is the anti-drift device, not a one-off migration check.

**Rejected: start/end `Events` date columns.** ADR 0012 already scoped this as L-effort — a schema
change touching import, export and every consumer — and deferred it out of the original matrix
session ([0012:43](0012-gedcom-gap-matrix-decision-session.md)). #490 itself deferred it a second
time, scoping it as "the larger, separate half" that "should not be started before" the smaller
entry-side fix. Nothing since has shrunk that estimate; the derived-year model this record confirms
is the reason it can stay deferred rather than merely postponed again — see the behaviour below.

**What this decision buys, concretely:** a phrase-dated value (`"(sometime in the 1850s)"`) now
sorts **last**, not by whatever digits happen to sit inside its prose. Before `sortableYear`
existed, roughly fourteen call sites each grew their own `match(/(\d{4})/)` and one of the bugs that
motivated consolidating them was exactly this — a phrase's first 4-digit run being read as its
year (`lib/date-utils.ts:188-190`). The SQL comment records the same guarantee for the
`family_event_agg` / marriage-ended-date query (`lib/db/queries/families.ts:159-163`): a phrase date
"sinks to the end instead of being ordered by a digit run inside its prose."

**What would reopen this:** a feature that needs to *query* by date range — "find events between
1850 and 1860" — rather than sort by a point year. A derived year cannot serve a range query; that
is a different capability than sorting, and would need the start/end columns rejected above.

**2. #547 — cause stays death-only. This is a narrowing, not a reading of the standard.**

`CAUS` is `EVENT_DETAIL` in GEDCOM 5.5.1 — `n CAUS <CAUSE_OF_EVENT> {0:1}` at
`GEDCOM Specs/extracted/ged551-2.txt:366`, inside the `EVENT_DETAIL` structure that both
`FAMILY_EVENT_DETAIL` and `INDIVIDUAL_EVENT_DETAIL` include (`ged551-2.txt:359,377,452`).
`CAUSE_OF_EVENT` is a plain size-bounded string (`{Size=1:90}`, `ged551-3.txt:169`). Nothing in the
spec ties `CAUS` to `DEAT` specifically — it is legal on any event. The app's decision to expose it
only for death is therefore a product narrowing, made because the app stores cause in a **person
column** (`People."DeathCause"`) rather than on `Events`, and only the death event has a natural
person-column home for it.

**No data is lost by this narrowing.** `HANDLED_PERSON_EVENT_L2` (`lib/gedcom/parser.ts:197`) is
`Set(['DATE', 'PLAC', 'NOTE', 'SOUR', 'OBJE'])` — `CAUS` is absent from it. The parser's `CAUS`
handler (`lib/gedcom/parser.ts:1186-1191`) only promotes the value into `person.DeathCause` when
`currentTag === 'DEAT'`; for every other event it returns `null` and claims nothing. Because `CAUS`
is unclaimed, it falls through to the passthrough path the #423 raw-GEDCOM columns exist for
(`lib/gedcom/parser.ts:1201`, "Anything not claimed here stays passthrough") — a non-death `CAUS`
is captured verbatim into `Events."RawGedcom"` and re-emitted on export unchanged. The value
survives a round trip; the app simply has no editing surface for it.

**The `showCauseInput` gate stays exactly as written.**
`app/components/InlineEventEditor.tsx:81` —

```ts
const showCauseInput = isSyntheticVital && vitalLock === 'DEAT';
```

— is load-bearing for the #480 data-loss fix: when the Cause field is absent, the editor passes
`undefined` rather than `''` on save (`InlineEventEditor.tsx:159`,
`vitalPatchFor(type, date, place, showCauseInput ? cause : undefined)`), so the patch omits
`DeathCause` instead of nulling a stored value. Widening the gate to cover more event types without
also giving those types a column to write to would either resurrect that null-out bug or silently
discard what the user typed. #547 is the request to widen *capability*; it is not a reason to touch
this gate, and this record fixes that conflation by naming them as separate questions.

**What would reopen this:** a user needing to *edit* a cause on a non-death event — burial,
emigration, illness. That is a UI-layer request (an `Events."Cause"` column or an event-detail
route, per the two options #547 already lays out) and is unrelated to whether the gate above stays
narrow.

**3. #545's accepted limitation — note scope is set from context and never re-scoped by the user.**

*(Amended in place later on the same branch, once Tasks 9-14 had landed. As first written, this
decision said the client `notes.create` API had no `ownerFact` parameter at all and that no app path
could write one. That is no longer true — Task 12 shipped a context-inferred create path — and it
was never the decision itself, which is and remains "set from context at creation, never re-scoped".
Decisions 1 and 2 are untouched.)*

`NoteLink."OwnerFact"` (`lib/db/init-schema.ts:742`, typed `'Birth' | 'Death' | 'Marriage' | null`
in `lib/db/queries/notes.ts:49`) records which promoted vital fact a note is about. Scope is **set
from the context the note is created in, and never changed afterwards.** Two writers exist, and both
infer the scope rather than asking for it:

- the GEDCOM importer, from the vital block a `NOTE` was nested under;
- the synthetic vital editor's Note box (`app/components/InlineEventEditor.tsx:171-185`), which is
  only rendered while editing an intrinsic Birth or Death row, and passes
  `vitalLock === 'DEAT' ? 'Death' : 'Birth'` — the vital the user is already editing — through
  `notes.create` (`lib/data/types.ts:483-484`, `lib/data/http/notes.ts:19`,
  `lib/data/local/notes.ts:23`). There is no free-form scope picker: the parameter exists, but every
  caller that supplies it is a caller that already knows the answer from where the user is standing.

#545's actual complaint was not that scope can be assigned — it is that a fact-scoped note was
**indistinguishable** from a record-level one in the notes list, so a scope change happened
silently. Task 11's scope label (`OwnerNotesCard`'s `scopeLabel`, rendered as the
`data-testid="note-scope"` overline) makes existing scope **visible**, which is the fix for the
complaint that was raised. Deleting a fact-scoped note and retyping it in the *general* notes rail
still produces a plain record-level note (`OwnerFact = NULL`) — that rail has no vital context to
infer from — and now the user can see the difference, because the old row carried a label and the
new one does not.

**What would reopen this:** a user-facing need to *change* an existing note's scope, or to choose a
scope with no context to infer it from (a scope dropdown in the general rail). That is #545's option
"if it is user-facing" in its own framing, and remains a different, larger piece of work than
context-inferred creation plus a visible label.

## Rejected alternatives

**Structured `Events` date columns (start/end), to close #490 item 3 by building rather than
accepting.** Rejected twice already — ADR 0012's original scoping and #490's own follow-up — as
L-effort work spanning schema, import, export and every consumer, for a capability (range queries)
nothing currently needs. See Decision 1.

**Modelling `CAUS` as a general `Events` column to close #547 in full.** Both real options #547 lays
out — an `Events."Cause"` column, or routing through the generic event-detail passthrough — are
legitimate future work, not rejected as wrong. They are out of scope for this record because #547
asks two separable questions (does the *app* narrow cause to death-only, and should it stop), and
this record answers only the first: the narrowing is deliberate, not accidental, and the #480 gate
is not the reason it exists. The building work, if taken up, starts from that clarified premise.

**Widening `showCauseInput` now, as an interim step toward #547.** Rejected because the gate's
`undefined`-vs-`''` distinction only means something for a field that has a column to write to
(`People.DeathCause`). Widening the *display* condition without widening the *write* target would
either silently drop non-death cause input again (the exact #480 bug) or require inventing a write
path ad hoc, which is the schema decision #547 explicitly defers to a future implementation.

**Letting `notes.create` accept an *arbitrary*, user-chosen `ownerFact` — a scope dropdown in the
general notes rail.** Rejected, and still rejected after Tasks 9-14. Shipping a scope control with
no context behind it re-creates the defect class #545 is about: a user could label a note "Marriage"
on a person who has no marriage the note is about, and nothing downstream distinguishes that from an
imported scope the GEDCOM actually asserted. What shipped instead is narrower and is *not* this
alternative — `ownerFact` is only ever supplied by a caller that already knows the answer from the
surface the user is on (the synthetic vital editor, `InlineEventEditor.tsx:171-185`), and no code
path re-scopes an existing note. See Decision 3.

## Consequences

**Invariants now in force:**

- **`sortableYear()` (`lib/date-utils.ts:197-205`) is the one place the year-derivation rule is
  defined.** `"SortableYear"(text)` (`lib/db/init-schema.ts:1168-1182`) is a mirror, not an
  independent implementation — any change to one must be reflected in the other, and
  `sortable-year-sql-parity.test.ts` is what catches a divergence. Do not add another local
  `match(/\d{4}/)` at a new call site; call one of these two.
- **A phrase-only date has no sortable year and sorts last**, never at year zero and never by a
  digit run inside its prose. This is now guaranteed identically in JS and SQL.
- **`CAUS` under any non-`DEAT` event is intentionally unhandled by the parser and relies on the
  #423 passthrough to survive.** Adding a claim for it under a new event type without also giving
  it a schema home would start silently dropping data that currently round-trips.
- **`showCauseInput` (`InlineEventEditor.tsx:81`) gates on `vitalLock === 'DEAT'`, not on "is this a
  death-shaped event."** It must stay narrow until a write target for non-death cause exists;
  widening it alone is not a valid partial fix for #547.
- **`NoteLink."OwnerFact"` is written at creation only, and only from context — never re-scoped.**
  Its two writers are the GEDCOM importer (from the vital block a `NOTE` was nested under) and the
  synthetic vital editor's Note box (`app/components/InlineEventEditor.tsx:171-185`), which passes
  the vital the user is already editing. A new writer is allowed only if it can infer the scope from
  where the user is standing; a control that lets a user *pick* a scope, or *change* an existing
  note's scope, is out of scope for this record and needs its own. The rail renders the scope but
  offers no control to change it (`OwnerNotesCard`'s `scopeLabel`), which is what stops the
  indistinguishability #545 complains about from coming back.
- **A bundle round trip is a fixed point in media *content*, never in media *filenames*.** The
  upload service is the only writer of `Media."FilePath"` and mints a fresh
  `imported_<ts>_<uuid8><ext>` on every import (`lib/services/media-upload.ts:280`), so a reimported
  file's basename necessarily differs from the one it was exported under. The round-trip harness
  reproduces this deliberately rather than reusing `mediaRefs[].originalFilename`
  (`__tests__/setup/gedcom-bundle.ts`'s `roundTrip()`), and the assertions that compare exports
  therefore exclude the basename and compare everything else under full equality —
  `gedcom-roundtrip-bundle.test.ts` (`omitMediaFile`, plus the positive guard "renames every
  reimported media file rather than reusing the original basename") and
  `gedcom-roundtrip-semantic.test.ts`'s three `omit(..., 'file')` comparisons. Do not "fix" a
  churning basename by making the harness reuse the original name: that fabricates a fixed point
  production never produces and turns every media comparison above into a tautology.

**What this makes easy:** #490 item 3 and #547 close as won't-do with a citable reason instead of
carrying `needs:decision` indefinitely. #545 gets a scoped, buildable next step (a row label) instead
of an open modelling question.

**What this makes harder:** any future date-range query still needs the start/end-column work this
record declines to start now — reopening #490 item 3 means reading this record first, not
re-litigating the estimate. Any future non-death cause editing or note re-scoping UI must reckon
with the write-target and gate constraints recorded above rather than patching the existing gates
in place.
