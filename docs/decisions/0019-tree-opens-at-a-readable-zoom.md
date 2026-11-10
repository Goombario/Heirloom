# 0019 — The tree opens at a readable zoom

**Date:** 2026-09-24 (#771; decided in the 2026-09-23 UX sweep, §15 item 9)
**Status:** Accepted
**Area:** tree

Supersedes the fit-versus-anchor threshold in [0005](0005-single-fit-floor-for-tree-autofit.md).
Its single-value rule stands.

## Context

0005 set one low auto-fit floor (`FIT_FLOOR = 0.12`), so only genuinely extreme trees used
anchor mode and everything else fit whole, "shrinking card text rather than clipping nodes
off-screen". In practice an ordinary four-generation tree then opened at 29%, with 5px names
nobody could read (UX sweep FL-1). The tree's first screen showed shapes, not people.

## Decision

`READABLE_ZOOM = 0.7` in `lib/tree/fitView.ts` replaces `FIT_FLOOR`, and it is the only zoom the
initial fit uses:

- A tree that fits whole at or above it opens fitted, as before.
- A bigger tree opens at it on the layout's anchor (root, leaf or focus person, per 0005's
  anchor placements). The minimap and the Controls fit-to-view button still show the whole tree.

It stays one value for every viewport, for 0005's reason: `naturalFitZoom` is already
canvas-relative, so a per-viewport threshold double-counts screen size.

## Rejected alternatives

- **Keep fitting whole and raise only the card font size.** The problem is the zoom, not the
  type: at 29% nothing on the card is legible.
- **A per-viewport readable zoom** (lower on phones). It brings back 0005's inversion.

## Consequences

- "Small-but-present beats absent" no longer holds for the first screen: readable-but-partial
  wins, and the whole tree is one click away.
- Don't lower `READABLE_ZOOM` to make more trees fit whole. That undoes this decision.
