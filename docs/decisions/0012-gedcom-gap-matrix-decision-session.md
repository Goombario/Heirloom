# 0012 — GEDCOM gap-matrix decision session: what to build, accept, or defer

**Date:** 2026-08-02
**Status:** Accepted
**Area:** gedcom

> **Four premises below were corrected by [0013](0013-gedcom-gap-matrix-build-corrections.md)
> before they were built** — custom-event `TYPE`, the reachability of `'Step'`, whether GEDCOM
> already read/wrote `RelationshipType`, and the Repository-note effort estimate. The decisions
> stand; three of the four rationales do not. **Read 0013 alongside this record.** Pointer added
> because this file is cited from 17 source and test files and 0013 was not discoverable from
> any of them.

## Context

#421 ("finish GEDCOM — close the modeling gaps, then stop") set a deliberate sequence: scope every gap once (`docs/gedcom-gap-matrix-2026-08-01.md`, produced by #422), decide the accept/implement/defer calls in one batch, then build the accepted set. The goal was explicit: stop re-litigating GEDCOM coverage per feature, and stop treating every gap as equally worth closing — "the goal is a defensible stopping line, not maximal coverage."

The matrix audited 11 areas the maintainer flagged 2026-08-01, each grounded in a `file:line` grep hit or GEDCOM 5.5.1/7 spec citation rather than assumption (several corrected the epic's own starting assumptions — see Consequences). This record is the output of the decision session held against that matrix, 2026-08-02.

## Decision

One call per area. Full reasoning, evidence, and spec citations for each live in `docs/gedcom-gap-matrix-2026-08-01.md`'s per-area sections and Decisions Log — this ADR is the durable summary, not a replacement for that detail.

| Area | Decision |
|---|---|
| Notes as first-level records | **Implement** (already Accepted as [0010](0010-people-notes-column-is-retired-in-favour-of-first-class-notes.md)). UI half decided this session: People adopts the primary-note concept + `OwnerNotesCard` in place of `InlineNotesCard` — see #407. |
| Citation ↔ Note ↔ Media relationships | **Implement** the Repository note (cheap, spec'd, `NoteLink`-vocabulary addition). **Accept-and-document** Citation↔Media and Media↔Citation either direction. **Defer** the citation shared-note-pointer resolution bug (real, low incidence). |
| Cause of events (`CAUS`) | **Done.** Shipped 2026-08-01 as #423 — `Events.RawGedcom` plus dedicated `People.BirthRawGedcom`/`DeathRawGedcom`/`Families.MarriageRawGedcom` (the Events-only fix #423 itself proposed would have missed the common bare-`DEAT` case). Structured modeling/UI (#480) stays out of scope — no natural home while birth/death are `People` columns. |
| Custom events | **Implement.** Confirmed bug: `processPersonTag` has no `TYPE` case, so a person-level custom `EVEN`'s label is silently dropped on import while the identical family-level structure round-trips correctly. One missing switch case. |
| Child linkage + associations (`PEDI`, `_FREL`/`_MREL`, `ASSO`/`RELA`) | **Implement** `PEDI` ↔ `FamilyPerson.RelationshipType` for `Birth`/`Adoption`/`Foster`. **`Step` dropped from `RelationshipType` entirely** — see Rejected Alternatives. **Accept-and-document** `ASSO`/`RELA` (already passthrough-safe, no UI consumer). "Pedigree (PEDI)" retired as a duplicate row of the same decision. |
| Fuzzy dates and ranges | Entry-side fix (#490 item 1) proceeds independently — pre-approved exception, no fresh call needed. **Structured modeling deferred** (#490 item 3, #400). |
| The concept of "Facts" (`FACT`) | **Accept-and-document.** No data loss (passthrough-protected); a second generic-attribute concept alongside custom `EVEN` isn't earned yet. |
| Other multimedia formats | **Accept-and-document.** GEDCOM `FORM` round-trips as unrestricted metadata; the real gap is that no attachment path in the app (interactive upload or GEDCOM-import zip-attach) accepts non-image bytes — filed separately as #510 (capability) and #511 (test coverage), since that's an app capability question, not a GEDCOM fidelity one. |
| Phonetics (`FONE`/`ROMN`) | **Accept-and-document.** Confirmed data loss, but GEDCOM 7 dropped both tags in favor of a generic `TRAN` structure — not worth building toward a design the format itself abandoned. |
| Name prefixes/suffixes (`NPFX`/`NSFX`) | **Accept-and-document.** `GIVN`/`SURN` already round-trip; `NPFX`/`NSFX` are lost but low-stakes, and the spec's own authors flagged this tag family as lightly adopted. |

#285 (the previously-deferred event-model fidelity audit) is superseded and closed: its High finding matches the `CAUS` fix above exactly (done), its Medium `EVEN`/`TYPE` finding matches "Custom events" above (decided), and its three remaining findings — not covered by any of the 11 areas — are split out as #512, #513, #514.

## Rejected alternatives

**Mapping `Step` to a `PEDI` value on export (e.g. `foster` + a passthrough note, or a non-standard extension tag)**, instead of dropping it. Rejected on two independent grounds: `PEDIGREE_LINKAGE_TYPE` is spec-scoped to "pedigree navigation purposes" in both 5.5.1 and GEDCOM 7 (unchanged across 20+ years) — a stepchild isn't part of that family's bloodline at all, so this isn't a missing enum value, it's a category mismatch. Externally verified against Gramps, the one FOSS tool that *does* model "Stepchild" as a first-class child-relationship type: its own documentation calls its GEDCOM export "necessarily lossy" for exactly this. A lossy mapping would have papered over a structural mismatch the wider ecosystem hasn't solved either. Confirmed zero current cost: `'Step'` was already excluded from the UI dropdown and never set by any import path.

**Building structured date-range modeling now, alongside the entry-side date fix.** Rejected as a bigger, separate bet (L effort, overlaps #400) than the matrix session was scoped to decide in one sitting — the entry-side fix alone delivers most of the user-visible value. Explicitly not a rejection of ever doing it, just not bundled into this batch.

**Resolving "Other multimedia formats" by running the live round-trip test originally flagged as necessary** (real fixtures were available in `test-data/`). Rejected as unnecessary once the actual code path was read directly (`insertOwnerMedia`, `importMediaUploadService`) — static analysis answered it conclusively without needing new information, which is what the live-test flag was for in the first place.

**Modeling `FACT` as its own concept, or treating "Other multimedia formats"/Phonetics/Name affixes as blocking gaps.** Rejected per the epic's own stated bias: "accept-and-document" is the default outcome, not maximal coverage. None of the four cross the bar of clear data loss + clear genealogical value + reasonable effort that the rows marked `implement` did.

## Consequences

**What this makes easy:** every area in #421's original "areas in scope" table now has a recorded decision with reasoning — no future feature needs to re-open a spec consultation to know whether Repository notes, `PEDI`, `FACT`, or non-image media are modeled, passthrough-preserved, or accepted-as-absent. That was the actual cost #421 existed to stop paying.

**What this makes harder:** `FamilyPerson.RelationshipType` is now a closed set (`'Birth' | 'Adoption' | 'Foster'`) rather than the wider type the code briefly carried — reopening `Step` (or any other pedigree-adjacent concept) needs a fresh decision, not a type-widening patch, given the reasoning above.

**Invariants now in force:**
- `RelationshipType` never contains `'Step'` — the value is retired, not merely unused. A future PR reintroducing it should point back here first.
- `Events.RawGedcom`, `People.BirthRawGedcom`/`DeathRawGedcom`, and `Families.MarriageRawGedcom` (added by #423) are the passthrough net for event-level and BIRT/DEAT/MARR sub-tags — kept as separate columns from the general `RawGedcom`, specifically so a captured sub-tag re-emits nested under its own line rather than dangling at record end. Any new BIRT/DEAT/MARR-adjacent parsing must route through the existing `subRawTarget`/`subRawHandled` mechanism in `lib/gedcom/parser.ts`, not a new one.
- The image-only `ALLOWED_EXTENSIONS` whitelist in `lib/services/media-upload.ts` is confirmed to be the *only* gate on file attachment app-wide (both the interactive upload and the GEDCOM-import zip-attach path converge on it) — a future non-image-media feature (#510) has exactly one place to change, not several.
- Next: #421 moves to its **Build** phase — a bounded plan covering every row marked `implement` above.
