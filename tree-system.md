# Tree System Reference

This document maps the complete tree visualization system. **Keep it up to date when changing tree files.**

---

## File Map

### Core Files

| File | Role |
|------|------|
| `app/tree/page.tsx` | Main tree page — root/mode selection, search, export, sidebar wiring |
| `app/api/tree/route.ts` | GET `/api/tree` — builds full tree hierarchy server-side |
| `app/contexts/TreeContext.tsx` | `activeTreeId` + `activePermission` for multi-tree/shared tree access |
| `app/components/tree/types.ts` | All shared types: `TreeNode`, `Spouse`, `SiblingInfo`, `FlowNodeData`, etc. |

### Components

| File | Role |
|------|------|
| `app/components/tree/TreeVisualization.tsx` | React Flow wrapper — renders nodes/edges, handles fit-view. `nodeTypes` registers `person` + `personBar`. |
| `app/components/tree/PersonNode.tsx` | 96×145px portrait card (vertical orientation) with photo, status mark, name, dates (anatomy below) |
| `app/components/tree/PersonBarNode.tsx` | 188×44px compact bar card (horizontal orientation) — avatar chip + name + dates, then the age (when on) and status mark at the right end |
| `app/components/tree/personCardModel.ts` | Shared derivation (name abbreviation, initials, living status, shown age) consumed by both `PersonNode` and `PersonBarNode` so the two cards never drift |
| `app/components/tree/TreeCardLifespan.tsx` | Both cards' (and the descendants panel's) life span: the payload's `lifespan` through the shared `Lifespan` (#808). The standard card's lifespan line is 11px mono, like the bar card, and borrows 3px of side padding, so the widest case ("~1796 – ~1819", 77px; 86px if the mono font falls back and draws thin spaces full width) fits its 88px without an ellipsis (#934, #1215) |
| `app/components/tree/PersonSidebar.tsx` | Slide-in editor panel — inline edits, focus-person, photo display |
| `app/components/tree/BranchEdge.tsx` | Parent→child edge; colorblind shape markers (square/circle/triangle/diamond) |
| `app/components/tree/SpouseEdge.tsx` | Spouse connector; `data.laneAxis` = `'x'` (horizontal lanes, vertical layout) or `'y'` (vertical lanes, horizontal layout); lane offsetting for multiple spouses |

### Layout engine (pure, framework-free — `lib/tree/`)

| File | Role |
|------|------|
| `lib/tree/geometry.ts` | **Single source of truth** for card dimensions (portrait 96×145, bar 188×44), spacing constants, branch colors, focus canvas anchors, and the injectable `LayoutGeometry` (`DEFAULT_LAYOUT_GEOMETRY` = portrait, `HORIZONTAL_BAR_GEOMETRY` = bars). Everything that draws or measures cards imports from here. |
| `lib/tree/layout/columnEngine.ts` | `computeColumnLayout()` — THE one d3 column layout (widths, branch colors, birth-year sort, lineage splice, separation, mirror, anchor shift, node/edge emission). Parameterized by orientation/mirror/prefix and an injectable `geometry`; exports `columnSeparation()`, `mirrorLeftEdge()`, `layoutBounds(nodes, dims?)`, and `transposeToHorizontal()` (axis swap → bar layout). |
| `lib/tree/layout/standardLayout.ts` | `computeStandardLayout(root, mode, orientation)` — descendants/ancestors: one engine pass + ancestor-mode sibling injection; when `orientation==='horizontal'` runs with bar geometry then transposes to a left-to-right bar layout |
| `lib/tree/layout/focusLayout.ts` | `computeFocusLayout()` — focus view: three engine passes (left/right/center) + Pass 3/3b overlap correction + canonical-ID dedup + edge remapping |
| `lib/tree/layout/registry.ts` | Layout-mode registry — one entry per display mode (`getLayoutMode(id)`, unknown → descendants). **Adding a new layout mode = one entry here + its compute module**; the renderer has no per-mode branching. |
| `lib/tree/keys.ts` | `NodeKey` codec — the single encoder/parser for node IDs (`person-42`, `person-42-spouse1`, `person-42-sibling`, `left-\|right-\|center-` cluster prefixes) and the canonical dedup identity (`canonicalNodeId`). No other file builds or parses these strings. |

### Hooks & Utilities

| File | Role |
|------|------|
| `app/components/tree/useTreeLayoutMode.ts` | THE one React layout adapter — dispatches to the mode registry and memoizes; returns `LayoutOutput` (nodes, edges, `bounds`, viewport `anchor`). Replaced the former per-mode hooks. |
| `app/components/tree/useTreeExport.ts` | JPEG export via `html-to-image` |
| `scripts/debug/test-focus-tree.ts` | CLI validation script for focus-mode layout — prints tree structures, per-pass layout output and edge-routing analysis against live DB data, running the REAL engine (`computeColumnLayout` / `computeFocusLayout`) rather than a simulation |

---

## Key Constants (`lib/tree/geometry.ts`)

All geometry constants live in **one module**, `lib/tree/geometry.ts`, imported by the layout engine, `PersonNode`, `TreeVisualization`'s fit-view math, and `DebugOverlay`:

```
PERSON_CARD_WIDTH  = 96     // px — portrait card width  (matches PersonNode inline style)
PERSON_CARD_HEIGHT = 145    // px — portrait card height (matches PersonNode inline style)
BAR_CARD_WIDTH     = 188    // px — horizontal bar card width  (matches PersonBarNode)
BAR_CARD_HEIGHT    = 44     // px — horizontal bar card height (≥44 tap target)
SPOUSE_GAP        = 20      // px — gap between person and spouse card(s)
VERTICAL_SPACING  = 220     // px — distance between generations
MIN_SIBLING_GAP   = 60      // px — min space between siblings
MIN_BRANCH_GAP    = 140     // px — min space between cousins; also the Pass 3 side-tree gap

BRANCH_COLORS = ['#fb923c', '#34d399', '#a78bfa', '#2dd4bf', '#fbbf24']  // 5 rotating colors

FOCUS_Y   = 0               // canvas Y of the focus person
CENTER_X  = -48             // left edge of focus card in center tree (-(CARD_W/2))
INNER_GAP = 60              // px — Stage A fallback gap between center and side trees
```

`LEFT_X = CENTER_X - INNER_GAP = -108` and `RIGHT_X = CENTER_X + CARD_W + INNER_GAP = +108` are derived locally in `focusLayout.ts` as Stage A fallback anchors.

In Stage D (`stage: 'D'`), `LEFT_X`/`RIGHT_X` are bypassed — side trees are anchored at the parent's canvas position inside CENTER. The parent's Y in CENTER is `FOCUS_Y - VERTICAL_SPACING = -220`, so ancestors fan further up the canvas at `y = -220 - (depth-1) * VERTICAL_SPACING`. Pass 3 enforces `MIN_BRANCH_GAP` per y-level (cross-cluster pairs are different branches by definition) and skips nodes whose canonical ID is already in CENTER (they are removed by dedup anyway).

Initial fit-view zoom (`lib/tree/fitView.ts`):

```
READABLE_ZOOM = 0.7  // one value for every viewport; see fitViewWithAnchor below
```

---

## Core Types (`types.ts`)

```typescript
interface TreeNode {
  id: number;
  name: string;
  photoMediaId: number | null; // Media.Id of primary photo; null = no photo
  focalX?: number;         // 0–100, default 50
  focalY?: number;
  focalRadius?: number | null;
  sex?: string | null;
  lifespan?: TreeLifespan; // display years { birth, death, deceased }; cards render it
                           // through <Lifespan preformatted> (TreeCardLifespan, #808)
  age?: number | string;   // "6mo" for infants
  spouses: Spouse[];
  otherParentId?: number;  // other parent's ID (multi-spouse branch tracking)
  children?: TreeNode[];   // descendants mode
  siblings?: SiblingInfo[]; // ancestor mode root only
}

interface Spouse {
  id: number; name: string; photoMediaId: number | null;
  focalX?: number; focalY?: number; focalRadius?: number | null;
  sex?: string | null; lifespan?: TreeLifespan; age?: number | string;
  hasChildren: boolean;    // whether to draw spouse connector
}

interface SiblingInfo {
  id: number; name: string; photoMediaId: number | null;
  focalX?: number; focalY?: number; focalRadius?: number | null;
  sex?: string | null; lifespan?: TreeLifespan; age?: number | string;
  connectingParentId: number;  // which parent to draw the sibling edge from
}

// Focus mode only — a TAGGED UNION on `stage`:
//   Stage 'A': focus has no parents → CENTER rooted at the focus person, no side trees.
//   Stage 'D': at least one parent → CENTER rooted at the father (or mother if no
//              father); mother is his spouse; focus + siblings are d3 children.
type FocusTrees =
  | { stage: 'A'; center: TreeNode; focusPersonId: number }
  | {
      stage: 'D';
      left: TreeNode | null;          // paternal ancestor chain terminating at the father (leaf)
      right: TreeNode | null;         // maternal ancestor chain terminating at the mother (leaf)
      center: TreeNode;
      focusPersonId: number;
      leftParentId: number | null;    // father's id (anchor for LEFT side tree)
      rightParentId: number | null;   // mother's id (anchor for RIGHT side tree)
    };
```

### API Response (`/api/tree`)

```typescript
interface TreeData {
  tree: TreeNode;                             // root with full hierarchy
  roots: { id: number; name: string }[];      // people with no parents
  currentRootId: number;
  currentMode: 'descendants' | 'ancestors' | 'focus';
  suggestedMode: 'descendants' | 'ancestors' | 'focus';
  parents: { id: number; name: string }[];    // parents of current root (nav links)
  allPeople: {
    id: number; name: string;
    isRoot: boolean; isLeaf: boolean;
    hasAncestors: boolean; hasDescendants: boolean; isIsolated: boolean;
  }[];
  focusTrees?: FocusTrees;                    // populated only when mode === 'focus'
}
```

---

## Data Flow

```
User picks root / mode
        ↓
page.tsx: fetch /api/tree?id=<rootId>&mode=<mode>&treeId=<activeTreeId>
        ↓
route.ts:
  1. Auth + tree-access check
  2. Load all people, families, FamilyPerson, primary photos into maps
  3. Build TreeNode recursively via buildNode() or buildAncestorNode()
     — tracks visited IDs to prevent cycles
     — attaches spouses, children/parents, siblings (ancestor mode)
     — computes age, lifespan years, photoMediaId (media id, not URL), focal points
  4. Return TreeData
        ↓
page.tsx: setTreeData(response)
        ↓
TreeVisualization renders
        ↓
useTreeLayoutMode(mode, {tree, focusTrees}) → registry → computeStandardLayout / computeFocusLayout → computeColumnLayout:
  1. d3.hierarchy() on TreeNode
  2. Compute each node's total width (person + all spouses × card+gap)
  3. Assign branch colors: only a multi-spouse parent's direct children are coloured (by
     their other parent); grandchildren revert to the plain edge (#462, ADR 0032); global
     color offsets prevent reuse
  4. d3.tree().nodeSize(...).separation(...) positions nodes
  5. Ancestor mode: invert Y so ancestors are above
  6. Emit FlowNodes (PersonNode) + FlowEdges (BranchEdge, SpouseEdge)
        ↓
React Flow renders nodes and edges
```

---

## Tree Modes

### Descendants (default)
- Root at **top**, children flow **downward**
- Parent-navigation buttons shown above tree
- Auto-suggested when root person has children

### Ancestors
- Root at **bottom**, parents flow **upward** (Y-coordinates inverted)
- Siblings of root shown at same generation level
- Auto-suggested when root person has parents but no children (is a leaf)

### Focus
- Shows the focus person's **full ancestry on both sides** (paternal left, maternal right) with their **own descendants in the center**
- Three independent d3 subtrees are computed and joined on a single canvas — see [Focus Layout Algorithm](#focus-layout-algorithm-usefocustreelayoutts) below
- Auto-suggested when the focus person has both parents and children

### Orientation (vertical ⇄ horizontal) — *not a mode*
Orientation is an **orthogonal layout input**, not a registry mode. It applies to
**descendants and ancestors** only; it renders the compact `PersonBarNode` (188×44)
laid out left-to-right instead of the portrait `PersonNode`.

- Threaded as `orientation` through `TreeLayoutInput` → `useTreeLayoutMode` →
  `computeStandardLayout`. Horizontal runs the same column engine with
  `HORIZONTAL_BAR_GEOMETRY`, then `transposeToHorizontal()` swaps `(x,y)→(y,x)`
  (spouses stack vertically) and retypes nodes to `personBar`. Root sits on the
  **left** in both directions (ancestors reflect the generation axis so they flow
  rightward); the layout anchor uses `placement: 'left'` so wide trees pin the
  root to the viewport's left edge.
- **Edge handles are chosen by the endpoints' final X**, not a fixed rule — normal
  parent→child edges route source-right → target-left, but ancestor-mode SIBLING
  edges run parent→sibling with the parent on the RIGHT, so they route
  `left-source` → `right-target`. `PersonBarNode` therefore carries a four-sided
  handle set (source+target on left/right, plus top/bottom for spouses).
- **Zoomed-out bars** mirror `PersonNode`: below the zoom threshold the bar drops
  the date and lets the name wrap to two lines at a scaled size
  (`getZoomedOutFontSize`, shared via `personCardModel`). Threshold + date color
  are dev-tunable via a `Debug · bar` block in `TreeDisplayControls` (dev-only).
- **Focus is vertical-only (Phase 1).** Its layout is axis-committed to horizontal
  (left=paternal / right=maternal, Pass 3/3b corrects along X), so the toggle is
  disabled in focus and `computeFocusLayout` never receives `orientation`.
  Entering focus adopts `'vertical'` as the **session** orientation (effect in
  `useTreeData`) rather than only overriding it at render time. It deliberately
  does NOT persist — focus is often entered via the server's `suggestedMode`, so
  writing `localStorage` there would silently rewrite a horizontal user's saved
  preference; a reload restores whatever they actually chose. Previously the
  session value survived focus untouched, so leaving focus via a direction toggle
  snapped the canvas back to bars — which read as "the Root View toggle forced
  horizontal layout" (Review 6, tranche 6). A direction toggle must never change
  the orientation you are looking at. `page.tsx` keeps `effectiveOrientation` as a
  same-render guard so the canvas cannot flash bars before that effect lands.
- UI: a Vertical/Horizontal segmented control in `TreeDisplayControls`, between
  Direction and Depth. The desktop rail (`TreeLeftRail`, lg and up) renders it, and
  below lg the header's Display button opens the same component in a bottom sheet
  (`Sheet below="lg"`, #936), so every display setting is reachable at every width. State lives in `useTreeData`, persisted to
  `localStorage['tree:orientation']`. The buttons' active/`aria-pressed` state
  tracks `orientation` even while disabled in focus, so the control always
  reports the layout actually on screen.

### Auto-Suggestion Logic (`route.ts`)
- Leaf + not root → ancestors
- Root + not leaf → descendants
- Leaf + root + spouse has connections → ancestors
- Person with both parents and descendants → focus
- Otherwise → keep current mode

---

## Layout Algorithm (`lib/tree/layout/columnEngine.ts` via `standardLayout.ts`)

One engine pass (`computeColumnLayout`) does, in order:

1. Build `d3.hierarchy` from `TreeNode`
2. Sort children at every level by `birthYear` (ascending; descending for mirrored trees; unknown years last; stable)
3. (Focus mode only) mark the lineage path and splice the lineage child to the requested edge of its sibling group
4. Attach `_width` to each node: `personCardWidth + spouses.length × (cardWidth + SPOUSE_GAP)`
5. Assign global color offsets and `_branchColor` (per-branch):
   - Multi-spouse parent assigns a distinct color to each child group by `otherParentId`
   - Only those direct children carry it; grandchildren are plain (#462, ADR 0032)
   - Spouse connectors are plain too, even a coloured child's line to their own spouse
     (#1180); only a multi-spouse parent's own lanes are coloured, one per partner
6. `d3.tree().separation()` uses `columnSeparation()` (`_width` values + sibling/branch gaps; sibling vs cousin argument order and mirror handling live in that one exported function)
7. Emit person + spouse cards and spouse/parent-child edges; orientation `'up'` (ancestors) inverts Y and flips edge handles
8. Optional mirror (`mirrorLeftEdge`) and anchor shift

`computeStandardLayout` then injects ancestor-mode sibling nodes + dashed sibling edges on top of the engine output.

---

## Focus Layout Algorithm (`lib/tree/layout/focusLayout.ts`)

The focus view builds three d3 subtrees (Stage D architecture), positions them on a shared canvas, then deduplicates nodes that appear in multiple trees.

### Three subtrees (Stage D)

| Subtree | Root | Mirror | Anchor person | Anchor canvas position |
|---------|------|--------|---------------|------------------------|
| Center | Father (focus's father) | No | Focus person | `(CENTER_X, FOCUS_Y) = (-48, 0)` |
| Left (paternal) | Topmost paternal ancestor | Yes (X-flipped) | Father (leaf) | Father's position in CENTER `≈ (CENTER_X - sibling_offset, -220)` |
| Right (maternal) | Topmost maternal ancestor | No | Mother (leaf) | Mother's position in CENTER `≈ (CENTER_X + 116, -220)` |

CENTER is a normal d3 descendants tree rooted at the **father**; the mother is the father's spouse; their children (focus + siblings) are d3 children. Focus + siblings + descendants all live in CENTER. With `lineageOrder='last'`, the focus child is sorted last in d3 so siblings land to the LEFT of the focus card.

LEFT and RIGHT are **pure ancestor chains** terminating at each parent. They contain no focus person and no siblings. Each side tree's parent-leaf is deduplicated against CENTER (CENTER wins), so only the ancestor portion above the parent stays visible.

**Trade-off:** Both parents end up on the side of focus where siblings landed in d3's natural sort, so the strict paternal-left / maternal-right symmetry is partially lost. With no siblings the parents flank focus normally as a couple at `y = -220`.

### Layout passes

**Pass 1 — Center tree (`lineageOrder='last'`)**
Run `computeColumnLayout` on CENTER. The shift anchor is the focus person, so focus lands at `(CENTER_X, FOCUS_Y)`. The father — being one d3 generation above focus — lands at `(some x, FOCUS_Y - VERTICAL_SPACING) = (?, -220)`. Mother lands one card-width + spouse-gap to the right of the father.

**Pass 2 — Side trees anchored at parent positions**
After CENTER is laid out, find each parent's canvas position inside CENTER. Run `computeColumnLayout` on LEFT/RIGHT with the parent as the anchor person and the parent's CENTER position as the target. The parent-leaf overlaps its CENTER duplicate exactly, ready for dedup. Ancestors above each parent fan further up the canvas at `y = -220 - (depth-1) * VERTICAL_SPACING`.

**Pass 3 — Per-y-level overlap correction**
For each side-tree node that shares a y-level with CENTER nodes, ensure ≥`MIN_BRANCH_GAP` horizontal separation; otherwise shift the offending side tree outward by the worst-case overlap. Side-tree nodes whose canonical ID already exists in CENTER (the parent leaves) are skipped — they are removed by dedup and counting them produces a false overlap.

**Pass 3b — LEFT ↔ RIGHT separation**
Pass 3 only separates each side tree from CENTER; on rows where CENTER has no nodes (typically the grandparent rows) the two side trees could still overlap each other, because the Stage D anchors (the two parents, adjacent as a couple) sit only one card apart. Pass 3b enforces `MIN_BRANCH_GAP` between LEFT and RIGHT per shared y-level, splitting the correction evenly (LEFT shifts further left, RIGHT further right — both directions can only widen the CENTER gaps enforced by Pass 3).

### Deduplication

Priority: **CENTER > LEFT > RIGHT**. The father (leaf of LEFT) and mother (leaf of RIGHT) are both in CENTER, so CENTER's copies win and the side-tree leaves are removed.

### Mirror / spouse handles

The left tree is x-flipped so it fans leftward. After the flip, spouse cards end up to the **right** of their main node, same as the non-mirrored trees. Spouse edges therefore always use `sourceHandle: 'right'` → `targetHandle: 'left'` regardless of which subtree they come from.

### Lineage child ordering (`lineageOrder` parameter)

`computeColumnLayout` accepts `lineageOrder: 'first' | 'last'`:

- `'first'` (default; LEFT/RIGHT side trees): the child on the path to the focus person is sorted **first** — d3 places it at the innermost (toward canvas center) x-position. After the mirror flip on the left tree, innermost = rightmost on canvas = closest to center. Side trees in Stage D don't actually contain the focus person, so this is a no-op for them.
- `'last'` (Stage D CENTER): the focus child is sorted **last** so siblings land in the LEFT of focus in d3's x ordering. This keeps the focus person's spouses (e.g. Susan adjacent to Linda) close to the focus card rather than separated by the sibling group.

### `stage` discriminant

`FocusTrees.stage: 'A' | 'D'` — set by the API. `'D'` (at least one parent exists): CENTER is rooted at the father, side trees anchor at parent positions, `lineageOrder='last'`. `'A'` (no parents): CENTER is rooted at the focus person and `computeFocusLayout` returns after Pass 1 — no side trees, no dedup.

---

## Multi-Spouse Rendering

- **BranchEdge**: drawn for each child; color = `_branchColor`; in colorblind mode a shape marker is drawn at the midpoint cycling square→circle→triangle→diamond
- **SpouseEdge**: horizontal connector; each additional spouse offset vertically by `LANE_STEP = 14px` and rendered with a fade-to-dark gradient so lanes are visually distinct. A multi-spouse parent's lanes take one branch colour per partner; every other spouse connector is the plain `--color-tree-edge` (#1180)

---

## Display Preferences (localStorage)

| Key | Effect |
|-----|--------|
| `treeColorblindMode` | Shape markers on branch edges |
| `treeShowAgeIndicator` | "Show ages" in the Display controls (rail and phone Display sheet, #271): the age beside each card's status mark |
| `tree:orientation` | `vertical` (portrait cards) or `horizontal` (bar cards); descendants/ancestors only. Unlike the others, this is a **layout input**, not a post-layout decoration. |

Node names use each person's **primary name** (the `NameVariant` marked
`IsPrimary`, else `FirstName`), resolved server-side in `GET /api/tree` via
`EffectiveFirstName` and rendered through `displayFullName` (`lib/utils/names.ts`).
The shared `personCardModel` only abbreviates long middle names; the older
quoted-nickname preference (`treeQuotedNames`) was removed.

The debug-only `treeRoundedPhotos` and `treeGreyscaleMode` prefs were removed (#271);
`useTreeDisplayPrefs` clears their stale keys.

---

## Card anatomy: status mark and age (#736)

Option B7, "split on a fade". Both cards render `StatusMark` with `size="tree"`: one
14px size in every state, ages on or off, status symbols on or off (14px is the
smallest size where `†` stays legible, so the Accessibility option adds the glyph
without growing the mark). Living is a plain dot; with symbols on, deceased carries
`†` and unknown `?`. Status comes from the payload's `isDeceased` via
`personCardModel` (`true` deceased, `false` living, anything else unknown), and the
mark is labelled with the `common.living` / `deceased` / `unknown` word.

- **Portrait card (`PersonNode`)**: the mark sits bottom-right inside the 64px photo
  area (`.status-tree`: 6px in from the right and up from the seam, so its centre is
  13px above the photo/name divider and its 2px card-colour ring clears it). With
  ages on, a 24px fade rises from the photo's foot (transparent to
  `rgba(28,25,23,.7)`) and the age sits at the left in white 11px bold tabular
  figures, level with the mark. Ages off: no fade, just the mark.
- **Bar card (`PersonBarNode`)**: the mark at the right end, with the age (12px bold,
  secondary text) just before it when ages are on.
- No age for an unknown status at 70+, so only the mark shows.
- The mark shows at every zoom; below the zoom threshold it reads as a coloured dot.
- Export JPEG renders the canvas, so the mark is included.

---

## Default root (#1055)

`GET /api/tree` uses the requested `id` when that person is in the tree. Otherwise
(no saved root after a first import, or a remembered `selectedRootPerson` from
another tree) `pickDefaultRoot` (`lib/tree/defaultRoot.ts`) opens at the ancestor
(no recorded parents) with the most generations of descendants; a tie goes to the
first in the file (lowest id). There is no home person setting: each device keeps
remembering where the tree last opened.

---

## Sidebar Flow

1. Click `PersonNode` → `onPersonClick(id)` → `setSelectedPersonId(id)` in page.tsx
2. `PersonSidebar` mounts and fetches `GET /api/people/:id`. The panel slides in from the **right** edge (`right-0`, `translate-x-full` → `translate-x-0`); close button sits top-left.
3. User edits fields; `isDirty` tracks unsaved changes. `SidebarContent` covers
   first/last name, **gender** (F / M / X non-binary / unknown toggle group, the
   same four buckets as the person form), birth date + place,
   living status, death date + place when deceased, and notes.
4. Save → `PUT /api/people/:id` → `onDataChanged()` → **silent reload** (viewport preserved, `fitViewVersion` not incremented)
5. "Focus Person" → `setSelectedRootId(id)` re-roots the whole tree
6. Read-only when `activePermission === 'view'`
7. **Double-click** a `PersonNode` → `onPersonDoubleClick(id)` → `handleFocusPerson(id)` — re-roots the tree on that person directly, the same as the sidebar's "Focus Person" action (shortcut that skips opening the sidebar). The callback threads through `TreeVisualization` into each node's `FlowNodeData.onPersonDoubleClick`.

The loading overlay is debounced: it only appears after 300ms of loading to avoid a flicker on fast responses.

---

## Load pipeline & instant-revisit cache

`loadTree` (page.tsx) is the single entry point for fetching tree data. Behaviour:

- **Chrome-first loading boundary.** `TreeHeader` and `TreeLeftRail` render on the
  first frame, whatever the fetch is doing; only the canvas region inside the
  container waits. That interior renders one of four states — error message,
  "no tree" card (`phase === 'ready'` with no data), a full-bleed `skeleton`
  block while loading, or `TreeVisualization`. The page no longer early-returns a
  full-page loading/error/empty screen (Review 6, tranche 6), so switching root or
  direction never blanks the controls you just used. `PersonSidebar` mounts only
  once `treeData` exists. Both chrome components take a `ready` prop (`treeData
  !== null`): before data lands the direction buttons, search field and export are
  **disabled** rather than clickable-but-inert (`handleModeChange` needs a root),
  and the rail suppresses its `· n/a` sub-label — it cannot yet know whether a
  direction is unavailable.
- **Flash-free "no tree" state.** `useLoadPhase(loading)`
  (`app/components/useLoadPhase.ts`) gates the empty-state card so a fast load can
  never flash "no tree" before data lands; the skeleton covers `pending` and
  `loading` alike.
- **Read-through cache (instant revisit).** Each successful fetch is stored in the
  shared module-level `dataCache` (`lib/data/cache.ts`) under
  `tree:owner=${ownerId}:root=${rootId}:mode=${mode}`. When a load is requested with
  both root **and** an explicit mode known up front, a cache hit paints the tree
  synchronously (no loading screen) and revalidates in the background
  (stale-while-revalidate). The suggested-mode branch can't use the cache key (its
  key is only known from the response). Silent reloads (sidebar saves) always fetch
  fresh. Writes anywhere clear `dataCache` via the `withCacheInvalidation` decorator
  on `getDataClient()`, so edits invalidate the cached tree.
- **Mode persistence.** Alongside `selectedRootPerson`, the resolved mode is saved to
  `selectedRootMode` in localStorage. A bare `/tree` visit (e.g. the navbar link)
  restores both and passes the mode explicitly — reaching the cache and skipping the
  suggested-mode double-fetch, while rendering the identical resolved view.

---

## TreeVisualization rendering details

### ZoomIndicator
A `Panel` component rendered top-right inside the React Flow canvas. Reads `transform[2]` from the React Flow store via `useStore` and displays the current zoom as a percentage with a brief scale-pop animation (`zoom-tick` keyframe in `globals.css`) each time the value changes.

### fitViewWithAnchor
Replaces the default `fitView` on initial load and on explicit reloads (`fitViewVersion` increments). Logic:

1. Use `bounds` from the layout's `LayoutOutput` (the renderer does not recompute bounding boxes) to derive the "natural" zoom that would fit the whole tree.
2. If `naturalZoom >= READABLE_ZOOM` (0.7): fall back to regular `fitView` (the whole tree fits with readable names).
3. Otherwise: open at `READABLE_ZOOM` and set the viewport per the layout-declared `anchor: { nodeId, placement }`. The minimap and the Controls fit-to-view button still show the whole tree (FL-1, 2026-09-23 UX sweep):
   - **Descendants** declares the root card with `placement: 'top'` (60 px padding).
   - **Ancestors** declares the root person's card with `placement: 'bottom'` (Y is inverted, so it sits on the bottom row).
   - **Focus** declares the focus card with `placement: 'center'` (`person-<id>` post-dedup; `center-person-<id>` in Stage A).
   The renderer never re-derives per-mode anchor policy — each layout knows its own anchor.
4. Container dimensions are read from a `containerDivRef` DOM ref at call time (not from the React Flow store) to avoid stale-closure races.

### Post-layout decoration
Layout output is pure geometry + identity. Interaction state — `isSidebarSelected`, `onPersonClick`/`onPersonDoubleClick`, and the display preferences — is injected into node `data` by an effect in `TreeVisualization` AFTER layout. Clicking a card (opening the sidebar) therefore re-runs only that decoration map, never d3 layout.

### Canvas hide/show (isPositioned)
The container div starts at `opacity: 0`. After `fitViewWithAnchor` runs and one `requestAnimationFrame` tick has passed, `isPositioned` is set to `true` and the canvas fades in (`opacity 0.15s ease`). On subsequent silent reloads (sidebar saves), `fitViewVersion` is not incremented so the canvas stays visible. On explicit reloads (mode change, new root), the canvas is briefly hidden again while the new layout settles.

---

## JPEG Export (`useTreeExport.ts`)

1. Save current viewport
2. Calculate bounding box of all nodes
3. Expand container to fit tree + 100px padding
4. Set viewport to zoom=1 at bounding box origin
5. Wait 500ms for render to settle
6. `html-to-image toJpeg()` — excludes controls, minimap, attribution
7. Restore viewport with smooth animation
8. Download as `family_tree_<rootId>.jpg`

---

## D3 Usage

- Package: **`d3-hierarchy`** (npm), not full D3 via CDN
- Functions used: `hierarchy()`, `tree()`, `.nodeSize()`, `.separation()`
- React Flow handles all DOM rendering — D3 is only for position calculation

---

## Focus Tree Debug Script (`scripts/debug/test-focus-tree.ts`)

Run against a live database to validate focus-mode layout for a specific person:

```bash
npx tsx --env-file=.env.local scripts/debug/test-focus-tree.ts [personId]
```

What it prints:
1. **Tree structures** — left (paternal), right (maternal), center (focus + descendants) with spouses and `otherParentId` annotations
2. **Center tree edge routing** — for each child node, which source node its edge comes from (main node vs. which spouse), and flags genuine mismatches where `otherParentId` is not found in the parent's spouse list
3. **Tree statistics** — depth and node count per subtree
4. **Trimming analysis** — how many nodes are removed from the right tree to eliminate left-tree duplicates
5. **Layout output** — Pass 1/2 columns computed by the REAL `computeColumnLayout`, a Pass 3 per-y-level overlap report, per-y-level node position tables, gap checks between all three trees, and the final composed `computeFocusLayout` node/edge counts + focus position

## Layout regression tests

- `__tests__/unit/tree-layout-parity.test.ts` — golden snapshots of `useTreeLayoutMode` output (nodes, positions, edges, colors, handles) on fixture trees covering multi-spouse colors, birth-year sorting, the matrilineal edge-source rule, ancestor inversion + sibling injection, and Stage A/D focus composition — plus assertions on the declared `anchor`/`bounds` and the unknown-mode fallback. **Any intentional layout change must update these snapshots deliberately** (`vitest -u`) — an unexpected diff means behavior drifted.
- `__tests__/unit/focus-tree-layout.test.ts` — geometry invariants driven through the real exported `columnSeparation()` / `mirrorLeftEdge()` (not replicas), plus Pass 3b LEFT↔RIGHT separation regression tests against `computeFocusLayout`.
- `__tests__/unit/tree-node-keys.test.ts` — NodeKey codec round-trips and the historical canonical-ID semantics.

---

## Debug Tools

### `DebugOverlay` (`app/components/tree/DebugOverlay.tsx`)

Dev-only SVG overlay that renders positioning diagnostics on the tree canvas. **Only active when `NODE_ENV=development`.**

**Toggle:** Press `D` on the tree page (no-op inside text inputs).

**What it renders (per node):**
- Green bounding box (96×145px card footprint)
- Red center dot (React Flow edge anchor point)
- Cyan label above card: `#<personId>  (<cx>, <cy>)` in canvas coordinates
- Yellow `[S1]`/`[S2]` badge at bottom of spouse cards

**Between adjacent nodes on the same Y level:**
- Orange bracket + pixel gap label: `64px`
- Red bracket + negative value on overlap: `-8px`

**Per edge:**
- Dark pill label at edge midpoint: `42→67` (or `42s0` for spouse nodes)

All labels stay constant pixel size across zoom levels (values divided by zoom). Useful for describing node-overlap and wrong-edge problems to Claude with exact numbers.

---

## Related API Endpoints

| Endpoint | Method | Used by |
|----------|--------|---------|
| `/api/tree` | GET | Main tree page |
| `/api/people/:id` | GET, PUT | PersonSidebar |
| `/api/media?personId=` | GET | PersonSidebar (photo) |
| `/api/relationship?person1=&person2=` | GET | `app/relationship/page.tsx` (Relationship Calculator) |
