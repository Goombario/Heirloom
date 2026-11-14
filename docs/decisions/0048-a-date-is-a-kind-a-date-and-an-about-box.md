# 0048 — A date is a kind, a date and an About box

**Date:** 2026-11-14 · **Context:** #64 · **Status:** Proposed · **Area:** dates / gedcom

The date input led with one qualifier menu of eight entries: Exact, About, Estimated, Calculated,
Before, After, Between … and …, From … to …. Three of those say how sure a date is and the other
four say what kind of date it is, so the menu mixed two questions. The owner asked, in the `#1013`
walkthrough, for certainty to be its own thing. GEDCOM 5.5.1 can't qualify a range (there is no
`ABT BET …`), and citations already carry the quality of the evidence (`QUAY`). The owner chose the
design from a mockup on 2026-11-13 (layout A, "one line").

## Decision

1. **The field has three parts:** a **Kind** menu (On, Before, After, Between, From), the date box
   (and a second box after "and" or "to" for Between and From), and an **About** checkbox.
2. **About shows only when the kind is On.** A range or an open end can't be approximate in GEDCOM,
   so the box isn't offered there.
3. **Ticking About stores `ABT`,** the modifier FamilySearch and most apps write. Unticking stores no
   modifier. New dates can't be entered as Estimated or Calculated.
4. **An imported `EST` or `CAL` reads as About ticked and is kept exactly** until the user unticks
   the box or changes the kind. Editing only the date keeps the modifier. Unticking clears it;
   ticking again writes `ABT`.
5. **The stored value and the GEDCOM mapping are unchanged**, so import and export round-trip as
   before: On is no modifier, About is `ABT` (or a kept `EST`/`CAL`), Before `BEF`, After `AFT`,
   Between `BET … AND …`, From `FROM … TO …`. `INT` values and free-text date phrases keep their
   single box. There is no schema change.
6. **Display words don't change.** Lifespans, tree cards and the timeline show "abt.", "est.",
   "cal." and the range words as they did.
7. **Date certainty stays separate from citation `QUAY`.** One is how precise the date is, the other
   how good the evidence is; neither sets or overrides the other.
8. **Phones use the same row,** at touch height: Kind, date, About. For a range the second box is on
   its own row with "and" or "to" under the Kind menu. This replaces the About/Before/After/Between
   chips under the box, so the phone and the desktop enter dates the same way.
9. **The UI never shows GEDCOM tokens** or "saves as" values. The words are On, About, Before, After,
   Between and From.

## Consequences

- Estimated and Calculated survive an import and an untouched edit, but can no longer be chosen. A
  user who wants one back must use another app or a GEDCOM edit.
- Typed shorthand ("abt 1850", "~1850", "est 1850", "1850-1852") still moves into the menu and the
  box on blur; "est" and "cal" typed by hand now land as a kept `EST`/`CAL` under a ticked About.
- The narrow sheet layout (`stacked`) puts Kind on its own row and keeps date and About together.
