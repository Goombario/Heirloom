# 0002 — Living people emit `_LIVING Y`, not `DEAT N`

**Date:** 2026-07-23 (PR #368; recorded 2026-08-01)
**Status:** Accepted
**Area:** gedcom

## Context

The generator marked living people with `1 DEAT N`. GEDCOM 5.5.1 disallows N-valued event
tags — an event tag asserts that the event happened, and there is no standard way to spell
"this event did not happen" (`08 §Other`; see the spec text under `GEDCOM Specs/extracted/`).
So the export was non-conformant, and a strict reader could reasonably reject or misread it.

## Decision

Emit `1 _LIVING Y`. The leading underscore makes it a custom tag, which is explicitly legal
in 5.5.1 — readers that do not know it are required to skip it.

**Keep the `DEAT N` reader path** in the parser, so files this app exported before the change
still import correctly.

## Rejected alternatives

- **Emit nothing for living people.** Loses the distinction between "known living" and "death
  simply unrecorded", which is exactly the privacy-relevant signal the field carries.
- **Use `RESN` (restriction notice).** `RESN` means "access restricted", not "alive". Related
  concept, different claim — conflating them would misrepresent the data. `RESN` support is
  tracked separately as part of #285.

## Consequences

- The reader path is now asymmetric on purpose: we **write** `_LIVING`, we **read** both
  `_LIVING` and `DEAT N`. Do not "simplify" by deleting the legacy read — it would silently
  drop the flag for every file exported before 2026-07-23.
- Other genealogy tools will not understand `_LIVING` and will skip it. Acceptable: the
  alternative was emitting something they would understand *incorrectly*.
