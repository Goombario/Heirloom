/**
 * test-separation.ts — diagnoses the ghost-spouse-gap in focus tree layout.
 *
 * Prints raw d3 positions before and after mirroring, grouped by depth,
 * and reports gaps between adjacent siblings at the same depth.
 *
 * Usage:  npx tsx scripts/test-separation.ts
 */

import { hierarchy, tree as d3tree } from 'd3-hierarchy';

const PERSON_CARD_WIDTH = 96;
const SPOUSE_GAP = 20;
const VERTICAL_SPACING = 220;
const MIN_SIBLING_GAP = 60;

interface Node { id: string; width: number; children?: Node[] }
type SepFormula = 'max' | 'directional';

interface PositionedNode {
  id: string;
  depth: number;
  d3X: number;          // raw d3 center x (before mirroring)
  canvasLeft: number;   // left edge of main card in canvas coords
  groupLeft: number;    // leftmost edge including spouses
  groupRight: number;   // rightmost edge including spouses
  width: number;
}

function runLayout(root: Node, mirrorX: boolean, formula: SepFormula): PositionedNode[] {
  const hier = hierarchy<Node>(root, d => d.children);

  const layout = d3tree<Node>()
    .nodeSize([1, VERTICAL_SPACING])
    .separation((a, b) => {
      const aW = a.data.width;
      const bW = b.data.width;
      const g = MIN_SIBLING_GAP;
      if (formula === 'max') return Math.max(aW, bW) + g;
      return (mirrorX ? aW : bW) + g;
    });
  layout(hier);

  const result: PositionedNode[] = [];
  hier.each(node => {
    const d3X = node.x ?? 0;
    const mainLeftRaw = d3X - PERSON_CARD_WIDTH / 2;  // left edge before mirror

    let canvasLeft: number;
    if (mirrorX) {
      // mirror: new_left = -(old_left + CARD_WIDTH) = -(d3X - 48 + 96) = -d3X - 48
      canvasLeft = -(mainLeftRaw + PERSON_CARD_WIDTH);
    } else {
      canvasLeft = mainLeftRaw;
    }

    // Spouses: before mirror go left (mirrorX) or right (normal).
    // After mirror, spouses end up RIGHT of main card in both cases.
    // group always: [canvasLeft, canvasLeft + width]
    result.push({
      id: node.data.id,
      depth: node.depth,
      d3X,
      canvasLeft,
      groupLeft:  canvasLeft,
      groupRight: canvasLeft + node.data.width,
      width: node.data.width,
    });
  });

  return result;
}

function printDepth(nodes: PositionedNode[], depth: number, label: string) {
  const atDepth = nodes.filter(n => n.depth === depth).sort((a, b) => a.canvasLeft - b.canvasLeft);
  if (!atDepth.length) return;
  console.log(`\n  [${label}] depth=${depth} siblings (canvas left→right):`);
  for (const n of atDepth) {
    console.log(
      `    ${n.id.padEnd(24)} d3X=${String(n.d3X.toFixed(1)).padStart(8)}` +
      `  canvasLeft=${String(n.canvasLeft.toFixed(0)).padStart(6)}` +
      `  groupRight=${String(n.groupRight.toFixed(0)).padStart(6)}` +
      `  w=${n.width}`
    );
  }
  console.log(`\n  [${label}] gaps between adjacent siblings at depth=${depth}:`);
  let ok = true;
  for (let i = 0; i < atDepth.length - 1; i++) {
    const a = atDepth[i], b = atDepth[i + 1];
    // gap between right edge of a's group and left edge of b's main card
    const gap = b.groupLeft - a.groupRight;
    const status = gap < 0 ? '❌ OVERLAP' : gap < MIN_SIBLING_GAP ? '⚠ tight (<60)' : '✓';
    console.log(`    ${a.id} → ${b.id}: gap=${gap.toFixed(0)}px  ${status}`);
    if (gap < 0) ok = false;
  }
  if (ok && atDepth.length > 1) console.log('    All gaps ≥ 0 (no overlaps).');
}

function compare(title: string, root: Node, mirrorX: boolean) {
  console.log('\n' + '='.repeat(64));
  console.log(title);
  console.log('='.repeat(64));

  const maxNodes = runLayout(root, mirrorX, 'max');
  const fixNodes = runLayout(root, mirrorX, 'directional');

  const maxDepths = [...new Set(maxNodes.map(n => n.depth))].filter(d => d > 0).sort();
  for (const d of maxDepths) {
    printDepth(maxNodes, d, 'Math.max (old)');
    printDepth(fixNodes, d, 'mirrorX?bW:aW  ');
  }
}

// ── Case 1: Wendy's children in the LEFT (mirrored) tree ─────────────────────
// In d3 order: Simon(212), Mark(96), Claire(96)  — Simon is first child
compare(
  'CASE 1: LEFT (mirrored) — Wendy\'s children\n  d3 order: Simon(w=212), Mark(w=96), Claire(w=96)',
  {
    id: 'Wendy+Terry', width: PERSON_CARD_WIDTH + SPOUSE_GAP + PERSON_CARD_WIDTH,
    children: [
      { id: 'Simon+Joanna', width: PERSON_CARD_WIDTH + SPOUSE_GAP + PERSON_CARD_WIDTH },
      { id: 'Mark',         width: PERSON_CARD_WIDTH },
      { id: 'Claire',       width: PERSON_CARD_WIDTH },
    ],
  },
  /* mirrorX= */ true,
);

// ── Case 2: Percy's children in the RIGHT (non-mirrored) tree ────────────────
compare(
  'CASE 2: RIGHT (non-mirrored) — Percy\'s children\n  d3 order: Marjorie(96), Dorothy+Percy(212), Ronald(96), Peggy+Dennis(212)',
  {
    id: 'Percy+Florence', width: PERSON_CARD_WIDTH + SPOUSE_GAP + PERSON_CARD_WIDTH,
    children: [
      { id: 'Marjorie',      width: PERSON_CARD_WIDTH },
      { id: 'Dorothy+Percy', width: PERSON_CARD_WIDTH + SPOUSE_GAP + PERSON_CARD_WIDTH },
      { id: 'Ronald',        width: PERSON_CARD_WIDTH },
      { id: 'Peggy+Dennis',  width: PERSON_CARD_WIDTH + SPOUSE_GAP + PERSON_CARD_WIDTH },
    ],
  },
  /* mirrorX= */ false,
);
