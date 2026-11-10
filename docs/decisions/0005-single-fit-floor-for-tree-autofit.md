# 0005 — One auto-fit zoom floor for every viewport

> **Superseded by [0019](0019-tree-opens-at-a-readable-zoom.md)** (the fit-versus-anchor threshold; the single-value rule stands)

**Date:** 2026-07-22 (PR #348; recorded 2026-08-01)
**Status:** Accepted
**Area:** tree

## Context

The tree's initial auto-fit used a per-viewport anchor floor: 0.3 on desktop, 0.2 on mobile.
Below the floor it abandons whole-tree fit and switches to "anchor mode" — pinning the
root/leaf/focus node and letting the rest run off-screen.

This produced an inversion. An 11-generation pedigree computed a natural fit zoom of ~0.24, so
it **fit on a 390px phone** (0.24 ≥ 0.2) but **anchored and clipped its top generations on a
1600px desktop window** (0.24 < 0.3). The larger screen had the higher bar.

## Decision

One `FIT_FLOOR` for every viewport, in `lib/tree/fitView.ts`.

`naturalFitZoom` already scales with the available canvas dimensions, so the zoom value it
returns is *already* viewport-relative. Applying a second, viewport-dependent threshold on top
of it double-counts the screen size — which is precisely what caused the inversion.

Kept ≥ the ReactFlow `minZoom` (0.1) so `fitView({ minZoom: FIT_FLOOR })` is not clamped.

## Rejected alternatives

- **Swap the floors** (higher on mobile). Fixes the inversion but keeps the double-counting,
  so the same class of bug returns at a different aspect ratio.
- **Remove anchor mode entirely.** Genuinely extreme trees (hundreds of nodes deep or wide)
  shrink to unreadable text when force-fitted. Anchor mode is the right behaviour there — it
  just should not trigger for ordinary pedigrees.

## Consequences

- Anchor mode now triggers only for genuinely extreme trees. Everything else fits whole,
  **shrinking card text rather than clipping nodes off-screen** — a deliberate preference:
  small-but-present beats absent.
- The fit/anchor decision is pure and unit-tested, extracted from
  `TreeVisualization.fitViewWithAnchor` specifically so this class of bug is testable without
  a browser.
- If a future change makes `naturalFitZoom` no longer canvas-relative, this reasoning breaks —
  re-derive the floor rather than tuning the constant.
