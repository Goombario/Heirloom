# 0001 — `effectiveFirstName` requires `IsPrimary` — do not relax it

**Date:** 2026-07-24 (recorded 2026-08-01)
**Status:** Accepted
**Area:** gedcom / people

## Context

A maintainer report said nicknames were invisible in the UI. The assumed cause was a parser
gap dropping `1 NICK` lines.

Reproduction against the live database (via `npm run db:query`) showed otherwise. All **36**
nickname variants already existed as `NameVariant` rows. The display rule `primaryNickname`
required `IsPrimary = 1`, and **nothing in the app ever set that flag** — so a value that was
present for every record rendered for none of them. The parser gap was real but had produced
**0** stranded `"NICK: "` note lines, so the planned backfill was dropped as dead code.

## Decision

Fix it by **setting the flag** on the write paths. Keep `effectiveFirstName` /
`primaryNickname` requiring `IsPrimary`.

The display rule is correct: a person may have several nicknames, and the app must be able to
say which one replaces the given name in display. A rule that renders "whichever variant
sorts first" is not a rule, it is an accident.

## Rejected alternatives

**Relax `effectiveFirstName` to fall back to any nickname when none is primary.** This is the
tempting one-line fix, and it is wrong twice over:

1. It makes display order load-bearing — the rendered name would depend on insertion order or
   an incidental `ORDER BY`, and would change when unrelated rows are added.
2. It removes the only signal distinguishing "this person goes by Bill" from "we also have
   'Billy' and 'W.J.' recorded" — the whole point of the flag.

## Consequences

- Any write path creating a `NameVariant` must decide the flag deliberately. Silence means
  not-primary, and not-primary means not displayed in place of the given name.
- **This makes the GEDCOM round trip a data-integrity concern, not a fidelity nicety.** Since
  display keys off the flag, a round trip that drops it silently renames people. That is
  tracked as issue #399, and the fix there **must be to carry the flag through the export
  bundle** — not to relax this rule. The `sources.json` sidecar is the intended channel.
- Anyone reading `NameVariant` for display should go through the shared helper rather than
  re-deriving the rule, so there is one place this invariant lives.
