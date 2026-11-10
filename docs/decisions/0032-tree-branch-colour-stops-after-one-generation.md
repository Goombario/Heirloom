# 0032 — A tree branch colour stops after one generation

**Date:** 2026-10-23 (#462)
**Status:** Accepted
**Area:** tree

## Context

When a parent has children with more than one partner, the tree colours each child's edge by
the other parent (`BRANCH_COLORS`) and adds a `BranchEdge` shape marker, the colourblind-safe
cue. The colour was then copied down to every later generation: a single-partner parent
passed its own branch colour to its children with no depth limit. On a deep tree, one
remarriage near the root turned whole subtrees green or purple, and the colour kept saying
"a different mother" generations after it meant anything. The shape markers, meanwhile, only
ever appeared on the multi-partner parent's own child edges, so the two cues disagreed below
the first generation.

## Decision

Only a multi-partner parent's **direct children** get a branch colour, chosen by which
partner is their other parent. Every edge below them is the plain `var(--color-tree-edge)`
again, which matches where the shape markers already stop. A child whose other parent isn't
one of the parent's child-bearing partners gets no colour. The coloured child's own partner
connector keeps the child's colour, since it is still that child's card.

The rule lives in the branch-colour pass of `computeColumnLayout`
(`lib/tree/layout/columnEngine.ts`).

## Rejected alternatives

- **Keep the cascade.** It was deliberate (the old code comment said so), on the idea that a
  whole descendant branch stays attributable to one mother. In practice it makes large parts
  of the tree loud for a fact that only matters at one join, and it contradicts the shape
  markers.
- **Decay per generation** (lower opacity each step). More code, and the shape markers would
  have to decay in step or the two cues would disagree again.

## Consequences

- Do not "restore" inheritance by copying `node.parent.data._branchColor` down. A parent with
  one child-bearing partner never passes a colour on.
- Colour and shape now describe the same thing: which partner a multi-partner parent's child
  came from. Any change to one must change the other.
- `__tests__/unit/tree-layout-parity.test.ts` asserts that a grandchild of a multi-partner
  parent has a plain edge.
