# Adding a New Tree Layout Mode to Heirloom

*(e.g. a horizontal tree or a fan chart — written against the architecture shipped in PRs #189/#190)*

After the tree-system refactor, all layout math lives in a pure, framework-free core under `lib/tree/`, and the renderer (`TreeVisualization`) has **zero per-mode branching** — it dispatches through a registry and consumes a mode-agnostic `LayoutOutput`. Adding a mode is therefore mostly *additive*: one compute module + one registry entry, plus a handful of small plumbing touchpoints listed below.

---

## 1. The contract you have to satisfy

A layout mode is one entry in `lib/tree/layout/registry.ts`:

```ts
interface TreeLayoutMode {
  id: string;                                    // 'horizontal', 'fan', …
  compute(input: TreeLayoutInput): LayoutOutput; // pure function, no React
}

interface TreeLayoutInput {
  tree?: TreeNode | null;          // single hierarchy (descendants/ancestors-style input)
  focusTrees?: FocusTrees | null;  // three-subtree input (focus-style)
}
```

Your `compute()` must return a `LayoutOutput` (see `app/components/tree/types.ts`):

```ts
interface LayoutOutput {
  nodes: FlowNode[];        // positioned cards; position = card TOP-LEFT, px
  edges: FlowEdge[];        // typed connectors between node IDs
  bounds: LayoutBounds;     // bbox incl. card extents (use layoutBounds() helper)
  anchor: {                 // what the initial viewport fit centers on
    nodeId: string;
    placement: 'top' | 'bottom' | 'center';
  };
}
```

Rules that keep you out of trouble:

- **Node IDs** must be built with `nodeKeyToId()` from `lib/tree/keys.ts` — never with string templates. If your mode composes multiple sub-layouts and dedups people, use `canonicalNodeId()` for identity, exactly as `focusLayout.ts` does.
- **Geometry constants** (card size 96×145, gaps, colors) come from `lib/tree/geometry.ts` only.
- **No interaction state.** Sidebar selection, click handlers, and display prefs are decorated onto nodes *after* layout by `TreeVisualization`. Your output is pure geometry + identity.
- **Declare your own anchor.** The renderer will not guess: descendants declares root/`top`, ancestors root/`bottom`, focus declares the focus card/`center`. A fan chart would declare its center person with `placement: 'center'`.

## 2. The easy case: a horizontal tree

A horizontal tree is the existing column layout with the axes swapped, so **do not write new d3 code**. Two options, in order of preference:

1. **Transpose adapter** — `lib/tree/layout/horizontalLayout.ts`:
   run `computeColumnLayout()` (or reuse `computeStandardLayout`) and then map every node position `(x, y) → (y, x)`, swap the edge `sourceHandle`/`targetHandle` values from `bottom`/`top-target` to `right`/`left` (the `PersonNode` handle set already includes left/right handles), and recompute `bounds` via `layoutBounds()`. Anchor: root card, `placement` is a judgment call — `'center'` reads best for a left-to-right tree.
2. **Engine option** — add `orientation: 'right'` inside `columnEngine.ts` itself. Only do this if the transpose produces bad spouse placement (spouse cards currently extend along +x; after transposition they'd stack vertically, which may actually be what you want for a horizontal tree — prototype first).

Watch out for:
- `SpouseEdge` draws strictly horizontal lanes; a transposed layout needs either a vertical-lane variant or accepting horizontal spouse connectors between vertically-stacked cards. Prefer adding a `lane.axis` field to the edge `data` over forking the component.
- `BranchEdge`'s colorblind stalk markers key off `Position.Top/Bottom`; they already receive `sourcePosition`/`targetPosition` from React Flow, so left/right handles mostly "just work" — verify with the DebugOverlay (`D` key on the tree page in dev).

## 3. The hard case: a fan chart

A fan chart genuinely needs new math, but it still fits the same contract:

- **Positions:** polar → cartesian inside your `compute()`. Each ancestor generation is a ring (`ring r = generation × VERTICAL_SPACING` is a fine start); a person's angular span is half their parent's. Emit ordinary `FlowNode`s at the computed cartesian positions — upright cards on radial positions are acceptable for v1 (React Flow nodes can't be rotated cheaply; a rotated-card variant of `PersonNode` is a later enhancement, keyed off a new `data` field).
- **Edges:** add a `'radial'` edge type — a new component next to `BranchEdge.tsx` that draws an SVG arc between rings — and register it in `TreeVisualization`'s `edgeTypes` map (this is the one renderer file you touch, and it's a one-line registration).
- **Input shape:** ancestors-style — request the tree with `mode=ancestors` semantics server-side (the d3 `children` field holds *parents* in that shape; this convention is documented in `tree-system.md`).
- **Anchor:** the center person, `placement: 'center'`.
- Do **not** reuse focus mode's per-y-row bucketing (Pass 3/3b) — that logic is row-based by design and confined to `focusLayout.ts`. Rings don't have rows.

## 4. The plumbing checklist (the part the registry does NOT cover)

The layout side is one file + one entry, but the mode *ID* still flows through a few closed unions and UI pickers. Grep for one of the existing mode names to find them all:

| # | File | What to change |
|---|------|----------------|
| 1 | `lib/tree/layout/registry.ts` | Add your `MODES` entry (unknown IDs already fall back to descendants, so partial rollouts are safe). |
| 2 | `app/components/tree/types.ts` | Widen `TreeData.currentMode` / `suggestedMode` union. |
| 3 | `app/components/tree/treeCache.ts` | Add to `TreeMode` union **and** `parseTreeMode()` (this gates the URL param and localStorage restore — miss it and deep links to your mode silently fall back). |
| 4 | `app/tree/tree-page-helpers.ts` | Extend `bestModeFor()` if your mode should ever be auto-picked client-side. |
| 5 | `lib/services/tree.ts` | Add the ID to the accepted-mode allowlist (~line 29) and, if desired, the `suggestedMode` heuristics. Decide which tree shape the API returns for your mode (descendants-shape, ancestors-shape, or focusTrees). |
| 6 | `app/tree/TreeHeader.tsx` + `TreeLeftRail.tsx` | Add the picker button/entry, including availability logic (`canViewX`-style, from `allPeople` flags). |
| 7 | `messages/en.json` + `fr.json` + `ru.json` | Picker label keys — all three files in the same change (hard project rule: no hardcoded user-visible strings). |
| 8 | `tree-system.md` | Update the file map + modes sections (hard project rule: keep it in sync). |

`TreeVisualization`, `useTreeLayoutMode`, fit-view, JPEG export, and the tree cache keys all work unchanged — they're mode-agnostic.

## 5. Testing recipe (copy the existing pattern)

1. **Golden snapshot** — add a fixture + `toMatchSnapshot()` case to `__tests__/unit/tree-layout-parity.test.ts` (it calls `useTreeLayoutMode` with a mocked `useMemo`; your mode slots straight in). Also add your mode to the anchor/bounds assertion block there.
2. **Invariant tests** — property-style checks in the spirit of `focus-tree-layout.test.ts`: e.g. for a fan chart, "no two cards in the same ring overlap angularly", "every generation-N card sits on ring N".
3. **Live check** — `scripts/debug/test-focus-tree.ts` shows the pattern for driving the real engine against live DB data; clone it if your mode warrants a CLI inspector.
4. **Visual** — seed a small family, `npm run build && npm start`, screenshot via Playwright, and toggle the DebugOverlay (`D`) for exact coordinates/gaps.
5. Gates before pushing: `npx tsc --noEmit`, `npm run lint`, `npm run audit:knip:ci`, `npm run test:unit`.

The parity snapshots are the safety net for everything you *didn't* mean to change: if your PR touches shared engine code and any existing-mode snapshot shifts, that's drift — fix it or justify it hunk by hunk before `vitest -u`.

## 6. Suggested first PR slice

1. Compute module + registry entry + snapshot test (mode reachable only by URL `?mode=<id>`, no UI). Small, fully gated, zero risk to existing modes.
2. Follow-up: picker UI + i18n keys + server suggestion logic.
3. Optional polish: rotated cards / custom edge rendering / mode-specific export tweaks.
