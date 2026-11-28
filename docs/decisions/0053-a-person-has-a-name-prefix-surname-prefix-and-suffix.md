# 0053 — A person has a name prefix, surname prefix and suffix

**Date:** 2026-11-25 · **Context:** #37, `#964`, `#872` · **Status:** Proposed · **Area:** people / gedcom

GEDCOM's `PERSONAL_NAME_PIECES` give a name a prefix (`NPFX`, "Dr"), a surname prefix (`SPFX`,
"von") and a suffix (`NSFX`, "PhD"). `#964` kept them as passthrough under the primary `1 NAME`
(`"People"."NameRawGedcom"`) so a round trip didn't lose them, but nobody could see or change them,
and an export after a name edit still wrote the old ones. The maintainer decided on 2026-11-24 to
model them, and picked the editor layout (A2) the same day.

## Decision

1. **A person has one name prefix, one surname prefix and one suffix:** `"People"."NamePrefix"`,
   `"SurnamePrefix"` and `"NameSuffix"`, nullable text, added in schema v76. The first and last name
   stay as they are, so lists, the tree, search, sorting and `"SearchName"` keep the short name.
2. **Only the person page header and the editor show them.** The header reads "Dr Johann von
   Habsburg PhD"; a starred other name still replaces the whole heading. The editor has a "More name
   parts" link under the first and last name, closed unless a part has a value, that opens Prefix,
   Before last name and Suffix (stacked on the phone).
3. **Import and a one-time backfill lift the first `2 NPFX`, `2 SPFX` and `2 NSFX` out of the
   passthrough,** with the same helper. A line is lifted only when it has a value and no lines
   under it; later occurrences stay passthrough. Many programs also write the pieces into the NAME
   text ("Dr Johann /von Habsburg/ PhD"), which the import splits into first and last name, so a
   piece at the front of the first name, the front of the last name, or the end of either is taken
   off there and the name doesn't show it twice. The backfill runs until it has finished once; the
   comment on `"People"."NamePrefix"` marks that, as `"Repository"."Website"`'s does (ADR 0049).
4. **Export writes them from the fields:** the NAME text carries every piece, and the pieces follow
   in `PERSONAL_NAME_PIECES` order (`NPFX`, `GIVN`, `SPFX`, `SURN`, `NSFX`), then the passthrough. A
   person with none of them exports exactly as before.
5. **The primary name's `TYPE` stays hidden passthrough,** exported as it came. Other names already
   map `TYPE` to `"NameVariant"."Type"` (`#872`); the primary name has no type picker.
6. **A person merge treats the parts as part of the name choice,** so the kept name brings its own
   parts.

## Consequences

- An edit in the app is what export writes. A second `NPFX` kept as passthrough still exports after
  the modeled one.
- Clearing a part doesn't promote a later passthrough occurrence; that one stays where it was.
- A part only the NAME text carried (no `NPFX` line) stays in the first or last name, as before.
