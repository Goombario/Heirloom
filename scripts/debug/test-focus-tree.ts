/**
 * test-focus-tree.ts
 *
 * Validates focus-mode tree building logic against live DB data.
 * Prints LEFT (paternal), RIGHT (maternal), and CENTER (focus+descendants) trees.
 * Layout passes run through the REAL production engine
 * (lib/tree/layout/columnEngine.ts + focusLayout.ts) — not a simulation — so
 * this script cannot drift from what the app actually renders.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/debug/test-focus-tree.ts [personId]
 *
 * Example:
 *   npx tsx --env-file=.env.local scripts/debug/test-focus-tree.ts 4318
 */

import { Pool } from 'pg';
import {
  PERSON_CARD_WIDTH,
  PERSON_CARD_HEIGHT,
  SPOUSE_GAP,
  MIN_BRANCH_GAP,
  FOCUS_Y,
  CENTER_X,
  INNER_GAP,
} from '../../lib/tree/geometry';
import { computeColumnLayout } from '../../lib/tree/layout/columnEngine';
import { computeFocusLayout } from '../../lib/tree/layout/focusLayout';
import type { TreeNode, FocusTrees } from '../../app/components/tree/types';

const TARGET_ID = parseInt(process.argv[2] ?? '4319', 10);

// Stage A fallback anchors (Stage D anchors side trees at parent positions).
const LEFT_X  = CENTER_X - INNER_GAP;                  // -108
const RIGHT_X = CENTER_X + PERSON_CARD_WIDTH + INNER_GAP; // +108

interface Person { Id: number; FirstName: string | null; LastName: string | null; Sex: string | null; }
interface Family { Id: number; HusbandId: number | null; WifeId: number | null; }
interface FP     { FamiliesAsChildId: number; ChildrenId: number; }
interface PersonWithFamilies extends Person {
  familiesAsHusband: (Family & { children: Person[] })[];
  familiesAsWife:    (Family & { children: Person[] })[];
}

function personName(p: Person): string {
  return `${p.FirstName ?? ''} ${p.LastName ?? ''}`.trim() || `(id=${p.Id})`;
}

function printTree(node: TreeNode, indent = 0, label = ''): void {
  const pad = '  '.repeat(indent);
  const sp  = node.spouses.length
    ? ' + [' + node.spouses.map(s => `${s.name}${s.hasChildren ? '*' : ''}`).join(', ') + ']'
    : '';
  const otherPart = node.otherParentId !== undefined ? ` [otherParent=${node.otherParentId}]` : '';
  console.log(`${pad}${label}${node.name} (id=${node.id})${sp}${otherPart}`);
  for (const c of node.children ?? []) printTree(c, indent + 1);
}

function containsId(node: TreeNode, id: number): boolean {
  if (node.id === id) return true;
  if (node.spouses.some(s => s.id === id)) return true;
  return (node.children ?? []).some(c => containsId(c, id));
}

function treeDepth(node: TreeNode): number {
  if (!node.children?.length) return 0;
  return 1 + Math.max(...node.children.map(treeDepth));
}

function countNodes(node: TreeNode): number {
  return 1 + node.spouses.length + (node.children ?? []).reduce((s, c) => s + countNodes(c), 0);
}

// ── Run one column layout through the REAL engine ────────────────────────────
interface NodePos { x: number; y: number; id: number; name: string; isFocus: boolean; isSpouse: boolean; }
interface BBox { minX: number; maxX: number; minY: number; maxY: number; focusX: number; nodeCount: number; nodes: NodePos[]; }

function runColumnLayout(
  rootNode: TreeNode,
  focusId: number,
  mirrorX: boolean,
  targetX: number,
  anchorId?: number,
  targetY?: number,
  lineageOrder: 'first' | 'last' = 'first',
): BBox {
  const { nodes } = computeColumnLayout(rootNode, {
    mirrorX,
    focusPersonId: focusId,
    shift: { targetX, targetY, anchorPersonId: anchorId },
    lineageOrder,
  });

  const positioned: NodePos[] = nodes.map(n => {
    const p = n.data.person as { id: number; name: string };
    return {
      x: n.position.x,
      y: n.position.y,
      id: p.id,
      name: p.name,
      isFocus: p.id === focusId,
      isSpouse: !!n.data.isSpouse,
    };
  });

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of positioned) {
    if (p.x < minX) minX = p.x;
    if (p.x + PERSON_CARD_WIDTH > maxX) maxX = p.x + PERSON_CARD_WIDTH;
    if (p.y < minY) minY = p.y;
    if (p.y + PERSON_CARD_HEIGHT > maxY) maxY = p.y + PERSON_CARD_HEIGHT;
  }

  const focus = positioned.find(p => p.isFocus && !p.isSpouse);
  return { minX, maxX, minY, maxY, focusX: focus?.x ?? 0, nodeCount: positioned.length, nodes: positioned };
}

// ── Pre-trim right tree: remove subtrees that are already in the left tree ────
function collectIds(node: TreeNode | null): Set<number> {
  const ids = new Set<number>();
  function walk(n: TreeNode) {
    ids.add(n.id);
    n.spouses?.forEach(s => ids.add(s.id));
    n.children?.forEach(walk);
  }
  if (node) walk(node);
  return ids;
}

function trimSharedNodes(node: TreeNode, sharedIds: Set<number>, focusId: number): TreeNode {
  const trimmedChildren = (node.children ?? [])
    .filter(c => c.id === focusId || !sharedIds.has(c.id))
    .map(c => trimSharedNodes(c, sharedIds, focusId));
  return { ...node, children: trimmedChildren.length > 0 ? trimmedChildren : undefined };
}

// ── Pass 3 per-y-level overlap check (formula matches focusLayout.ts Pass 3;
//    kept local because the script reports the worst offending node, which the
//    composed computeFocusLayout doesn't expose) ────────────────────────────────
interface PerYExtent { minX: number; maxX: number; }

function buildByY(nodes: NodePos[]): Map<number, PerYExtent> {
  const map = new Map<number, PerYExtent>();
  for (const n of nodes) {
    const y = Math.round(n.y);
    const prev = map.get(y) ?? { minX: Infinity, maxX: -Infinity };
    map.set(y, {
      minX: Math.min(prev.minX, n.x),
      maxX: Math.max(prev.maxX, n.x + PERSON_CARD_WIDTH),
    });
  }
  return map;
}

function computePass3Overlap(
  sideNodes: NodePos[],
  centerByY: Map<number, PerYExtent>,
  centerIds: Set<number>,
  side: 'left' | 'right',
): { overlap: number; worstY: number; worstNode: string } {
  let overlap = 0;
  let worstY = 0;
  let worstNode = '';
  for (const n of sideNodes) {
    if (centerIds.has(n.id)) continue; // deduped (CENTER wins), skip
    const y = Math.round(n.y);
    const c = centerByY.get(y);
    if (!c) continue;
    const candidate = side === 'left'
      ? n.x + PERSON_CARD_WIDTH + MIN_BRANCH_GAP - c.minX
      : c.maxX + MIN_BRANCH_GAP - n.x;
    if (candidate > overlap) {
      overlap = candidate;
      worstY = y;
      worstNode = `${n.name} (id=${n.id}) at x=${n.x.toFixed(0)}`;
    }
  }
  return { overlap, worstY, worstNode };
}

// ── Simulate center tree edge routing ────────────────────────────────────────
function printEdgeRouting(node: TreeNode, parentNode: TreeNode | null, prefix: string, indent = 0): void {
  if (!parentNode) {
    // root — no edge
    for (const c of node.children ?? []) printEdgeRouting(c, node, prefix, indent);
    return;
  }

  const pad = '  '.repeat(indent);
  const parentCBSpouses = parentNode.spouses.filter(s => s.hasChildren);
  const parentMultiSpouse = parentCBSpouses.length > 1;

  let sourceDesc = `${parentNode.name} (id=${parentNode.id}) [main node]`;
  let sourceNodeId = `${prefix}person-${parentNode.id}`;

  if (parentMultiSpouse && node.otherParentId) {
    const spouseIdx = parentNode.spouses.findIndex(s => s.id === node.otherParentId);
    if (spouseIdx !== -1) {
      const sp = parentNode.spouses[spouseIdx];
      sourceDesc = `${sp.name} (id=${sp.id}) [multi-spouse #${spouseIdx}]`;
      sourceNodeId = `${prefix}person-${sp.id}-spouse${spouseIdx}`;
    } else {
      sourceDesc = `?? otherParentId=${node.otherParentId} not found in parent spouses ← BUG`;
    }
  } else if (!parentMultiSpouse && parentNode.spouses.length === 1) {
    const sp = parentNode.spouses[0];
    if (parentNode.sex !== 'F' && sp.sex === 'F') {
      sourceDesc = `${sp.name} (id=${sp.id}) [single female spouse]`;
      sourceNodeId = `${prefix}person-${sp.id}-spouse0`;
    }
  }

  // Flag only genuine mismatches: multi-spouse parent where otherParentId is not
  // found in the spouse list.  Single-spouse female parents correctly route from
  // the main node regardless of otherParentId — not a bug.
  const genuineMismatch =
    parentMultiSpouse &&
    node.otherParentId &&
    !sourceNodeId.includes(`${node.otherParentId}`);
  const mismatch = genuineMismatch ? '  ← BUG: otherParentId=' + node.otherParentId + ' not in parent spouse list' : '';
  console.log(`${pad}child: ${node.name} (id=${node.id}, otherParentId=${node.otherParentId ?? 'none'})`);
  console.log(`${pad}  edge source → ${sourceDesc}${mismatch}`);

  for (const c of node.children ?? []) printEdgeRouting(c, node, prefix, indent + 1);
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error('ERROR: DATABASE_URL not set'); process.exit(1); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const ownerRes = await pool.query<{ UserId: number }>('SELECT "UserId" FROM "People" WHERE "Id" = $1', [TARGET_ID]);
    if (!ownerRes.rows.length) { console.error(`Person ${TARGET_ID} not found`); process.exit(1); }
    const ownerId = ownerRes.rows[0].UserId;

    const [pRes, fRes, fpRes] = await Promise.all([
      pool.query<Person>('SELECT "Id","FirstName","LastName","Sex" FROM "People" WHERE "UserId" = $1', [ownerId]),
      pool.query<Family>('SELECT "Id","HusbandId","WifeId" FROM "Families" WHERE "UserId" = $1', [ownerId]),
      pool.query<FP>(`SELECT fp."FamiliesAsChildId",fp."ChildrenId" FROM "FamilyPerson" fp
                      INNER JOIN "Families" f ON fp."FamiliesAsChildId"=f."Id" WHERE f."UserId"=$1`, [ownerId]),
    ]);

    const allPeople   = pRes.rows;
    const allFamilies = fRes.rows;
    const familyPersons = fpRes.rows;

    const personMap = new Map<number, PersonWithFamilies>();
    for (const p of allPeople) personMap.set(p.Id, { ...p, familiesAsHusband: [], familiesAsWife: [] });
    for (const fam of allFamilies) {
      const children = familyPersons.filter(fp => fp.FamiliesAsChildId === fam.Id)
        .map(fp => personMap.get(fp.ChildrenId)).filter(Boolean) as Person[];
      if (fam.HusbandId && personMap.has(fam.HusbandId))
        personMap.get(fam.HusbandId)!.familiesAsHusband.push({ ...fam, children });
      if (fam.WifeId && personMap.has(fam.WifeId))
        personMap.get(fam.WifeId)!.familiesAsWife.push({ ...fam, children });
    }

    const root = personMap.get(TARGET_ID)!;
    console.log(`\nFocus person: ${personName(root)} (id=${root.Id})  |  owner=${ownerId}`);

    const parentFamilies = allFamilies
      .filter(fam => familyPersons.some(fp => fp.FamiliesAsChildId === fam.Id && fp.ChildrenId === root.Id))
      .sort((a, b) => a.Id - b.Id);

    console.log(`\nParent families (${parentFamilies.length}):`);
    for (const fam of parentFamilies) {
      const h = fam.HusbandId ? personMap.get(fam.HusbandId) : null;
      const w = fam.WifeId    ? personMap.get(fam.WifeId)    : null;
      console.log(`  fam=${fam.Id}: husband=${h ? personName(h) : 'none'}  wife=${w ? personName(w) : 'none'}`);
    }

    const parents: PersonWithFamilies[] = [];
    for (const fam of parentFamilies) {
      for (const id of [fam.HusbandId, fam.WifeId]) {
        if (id && personMap.has(id) && !parents.find(x => x.Id === id)) parents.push(personMap.get(id)!);
        if (parents.length >= 2) break;
      }
      if (parents.length >= 2) break;
    }
    console.log(`\nParents selected: ${parents.map(p => `${personName(p)} (${p.Id})`).join(', ')}`);

    function findFocusRoot(person: PersonWithFamilies): PersonWithFamilies {
      const gpFams = allFamilies
        .filter(fam => familyPersons.some(fp => fp.FamiliesAsChildId === fam.Id && fp.ChildrenId === person.Id))
        .sort((a, b) => a.Id - b.Id);
      const gf = gpFams[0];
      if (gf) {
        const gp = (gf.HusbandId && personMap.has(gf.HusbandId))
          ? personMap.get(gf.HusbandId)!
          : (gf.WifeId && personMap.has(gf.WifeId)) ? personMap.get(gf.WifeId)! : null;
        if (gp) return gp;
      }
      return person;
    }

    function buildNode(
      p: PersonWithFamilies,
      visited: Set<number>,
      otherParentId?: number,
      stopAtId?: number,
      excludeAsSpouse: Set<number> = new Set(),
      excludeChildIds: Set<number> = new Set(),
    ): TreeNode {
      if (visited.has(p.Id)) return { id: p.Id, name: `${personName(p)} [cycle]`, photoMediaId: null, dates: '', spouses: [], otherParentId };
      visited.add(p.Id);
      const children: TreeNode[] = [];
      if (stopAtId === undefined || p.Id !== stopAtId) {
        for (const fam of [...p.familiesAsHusband, ...p.familiesAsWife]) {
          const nextOther = fam.HusbandId === p.Id ? fam.WifeId : fam.HusbandId;
          for (const child of fam.children ?? []) {
            // Skip excluded children unless this child is the focus (preserve the focus leaf).
            if (excludeChildIds.has(child.Id) && child.Id !== stopAtId) continue;
            const cp = personMap.get(child.Id);
            if (cp) children.push(buildNode(cp, visited, nextOther ?? undefined, stopAtId, excludeAsSpouse, excludeChildIds));
          }
        }
      }
      const spouses: TreeNode['spouses'] = [];
      const seenSp = new Set<number>();
      for (const fam of p.familiesAsHusband) {
        const w = personMap.get(fam.WifeId ?? -1);
        if (w && !seenSp.has(w.Id) && !excludeAsSpouse.has(w.Id)) {
          seenSp.add(w.Id);
          spouses.push({ id: w.Id, name: personName(w), photoMediaId: null, dates: '', sex: w.Sex, hasChildren: (fam.children?.length ?? 0) > 0 });
        }
      }
      for (const fam of p.familiesAsWife) {
        const h = personMap.get(fam.HusbandId ?? -1);
        if (h && !seenSp.has(h.Id) && !excludeAsSpouse.has(h.Id)) {
          seenSp.add(h.Id);
          spouses.push({ id: h.Id, name: personName(h), photoMediaId: null, dates: '', sex: h.Sex, hasChildren: (fam.children?.length ?? 0) > 0 });
        }
      }
      return { id: p.Id, name: personName(p), photoMediaId: null, dates: '', sex: p.Sex, spouses, otherParentId, children: children.length ? children : undefined };
    }

    if (parents.length === 0) { console.log('\nNo parents — Focus view not available.'); return; }

    // Collect focus's siblings: every "other" child of focus's parents (across all parent families).
    const focusSiblingIds = new Set<number>();
    for (const fam of parentFamilies) {
      const childIds = familyPersons
        .filter(fp => fp.FamiliesAsChildId === fam.Id)
        .map(fp => fp.ChildrenId);
      for (const cid of childIds) {
        if (cid !== TARGET_ID) focusSiblingIds.add(cid);
      }
    }
    console.log(`\nFocus siblings (${focusSiblingIds.size}): ${[...focusSiblingIds].map(id => personName(personMap.get(id)!)).join(', ') || '(none)'}`);

    const leftExclude  = parents.length > 1 ? new Set([parents[1].Id]) : new Set<number>();
    const rightExclude = parents.length > 1 ? new Set([parents[0].Id]) : new Set<number>();
    const leftRoot     = findFocusRoot(parents[0]);
    const rightRoot    = parents.length > 1 ? findFocusRoot(parents[1]) : null;

    // Stage A (current production) trees — siblings remain inside LEFT/RIGHT subtrees.
    const leftTree   = buildNode(leftRoot,  new Set(), undefined, TARGET_ID, leftExclude);
    const rightTree  = rightRoot ? buildNode(rightRoot, new Set(), undefined, TARGET_ID, rightExclude) : null;
    const centerTree = buildNode(root, new Set());

    // Stage D (proposed) trees — parents move into CENTER as a couple; LEFT and
    // RIGHT collapse to pure ancestor chains terminating at the parent (leaf
    // dedups against CENTER).  Father is CENTER's d3 root; mother is his spouse.
    const fatherId = parents[0].Id;
    const motherId = parents.length > 1 ? parents[1].Id : null;
    const leftTreeD  = buildNode(leftRoot, new Set(), undefined, fatherId, leftExclude);
    const rightTreeD = rightRoot && motherId !== null
      ? buildNode(rightRoot, new Set(), undefined, motherId, rightExclude)
      : null;
    const centerTreeD = buildNode(parents[0], new Set());

    // ── Print trees ──────────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(70));
    console.log(`\nLEFT tree root (paternal): ${personName(leftRoot)} (id=${leftRoot.Id})`);
    printTree(leftTree, 1, '[root] ');
    console.log(`  → Focus person in left tree: ${containsId(leftTree, TARGET_ID) ? 'YES ✓' : 'NO ✗'}`);
    if (parents.length > 1) {
      const dup = JSON.stringify(leftTree).match(new RegExp(`"id":${parents[1].Id}`, 'g'));
      console.log(`  → Other parent (${parents[1].Id}) excluded from left tree: ${!dup ? 'YES ✓' : 'NO ✗'}`);
    }

    if (rightTree && rightRoot) {
      console.log(`\nRIGHT tree root (maternal): ${personName(rightRoot)} (id=${rightRoot.Id})`);
      printTree(rightTree, 1, '[root] ');
      console.log(`  → Focus person in right tree: ${containsId(rightTree, TARGET_ID) ? 'YES ✓' : 'NO ✗'}`);
      const dup = JSON.stringify(rightTree).match(new RegExp(`"id":${parents[0].Id}`, 'g'));
      console.log(`  → Other parent (${parents[0].Id}) excluded from right tree: ${!dup ? 'YES ✓' : 'NO ✗'}`);
    } else {
      console.log('\nRIGHT tree: single-parent — only one side shown.');
    }

    console.log(`\nCENTER tree (focus person + descendants): root=${personName(root)} (id=${root.Id})`);
    printTree(centerTree, 1, '[focus] ');
    console.log(`  → Has descendants: ${centerTree.children?.length ? 'YES ✓' : 'NO (leaf person)'}`);

    // ── Center tree edge routing analysis ────────────────────────────────────
    console.log('\n' + '='.repeat(70));
    console.log('CENTER TREE EDGE ROUTING (which node each child\'s edge comes from)');
    console.log('='.repeat(70));
    printEdgeRouting(centerTree, null, 'center-');

    // ── Tree statistics ───────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(70));
    console.log('TREE STATISTICS');
    console.log('='.repeat(70));
    console.log(`  LEFT  : depth=${treeDepth(leftTree)}  total nodes=${countNodes(leftTree)}`);
    if (rightTree) console.log(`  RIGHT : depth=${treeDepth(rightTree)}  total nodes=${countNodes(rightTree)}`);
    console.log(`  CENTER: depth=${treeDepth(centerTree)}  total nodes=${countNodes(centerTree)}`);

    // ── Trimming analysis ─────────────────────────────────────────────────────
    const leftIds = collectIds(leftTree);
    let trimmedRight: TreeNode | null = null;
    if (rightTree) {
      trimmedRight = trimSharedNodes(rightTree, leftIds, TARGET_ID);
      const removedCount = countNodes(rightTree) - countNodes(trimmedRight);
      console.log(`\n  RIGHT after trimming left-tree nodes: depth=${treeDepth(trimmedRight)}  total nodes=${countNodes(trimmedRight)}  (removed ${removedCount})`);
    }

    // ── Layout simulation ─────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(70));
    console.log('LAYOUT SIMULATION  (replicating useFocusTreeLayout anchor logic)');
    console.log('='.repeat(70));
    console.log(`  Fixed constants:  LEFT_X=${LEFT_X}  CENTER_X=${CENTER_X}  RIGHT_X=${RIGHT_X}  INNER_GAP=${INNER_GAP}`);

    // Pass 1: center
    const centerBBox = runColumnLayout(centerTree, TARGET_ID, false, CENTER_X);
    console.log(`\n  CENTER layout bbox:`);
    console.log(`    x range : [${centerBBox.minX.toFixed(0)}, ${centerBBox.maxX.toFixed(0)}]  (width=${(centerBBox.maxX - centerBBox.minX).toFixed(0)})`);
    console.log(`    y range : [${centerBBox.minY.toFixed(0)}, ${centerBBox.maxY.toFixed(0)}]`);
    console.log(`    focusX  : ${centerBBox.focusX.toFixed(0)}`);

    // Per-depth breakdown
    const centerByY = buildByY(centerBBox.nodes);
    console.log(`\n  CENTER tree nodes per y-level:`);
    const sortedYs = Array.from(centerByY.keys()).sort((a, b) => a - b);
    for (const y of sortedYs) {
      const ext = centerByY.get(y)!;
      const nodesAtY = centerBBox.nodes.filter(n => Math.round(n.y) === y);
      console.log(`    y=${y}: x=[${ext.minX.toFixed(0)}, ${ext.maxX.toFixed(0)}]  nodes: ${nodesAtY.map(n => `${n.name}${n.isSpouse ? '(sp)' : ''}`).join(', ')}`);
    }

    // Side trees use the fixed LEFT_X / RIGHT_X anchors.  Pass 3 below applies
    // any per-y-level overlap correction needed.
    const dynamicLeftX  = LEFT_X;
    const dynamicRightX = RIGHT_X;
    console.log(`\n  Anchors:  LEFT_X=${dynamicLeftX}  RIGHT_X=${dynamicRightX}  (no dynamic adjustment — Pass 3 corrects overlaps)`);

    // Pass 2: side trees (BEFORE and AFTER trimming for right)
    if (rightTree) {
      const rightBBoxBefore = runColumnLayout(rightTree, TARGET_ID, false, dynamicRightX);
      console.log(`\n  RIGHT (BEFORE trim) at dynamicRightX=${dynamicRightX.toFixed(0)}:`);
      console.log(`    x range : [${rightBBoxBefore.minX.toFixed(0)}, ${rightBBoxBefore.maxX.toFixed(0)}]  (width=${(rightBBoxBefore.maxX - rightBBoxBefore.minX).toFixed(0)})`);
    }

    if (trimmedRight) {
      const rightBBox = runColumnLayout(trimmedRight, TARGET_ID, false, dynamicRightX);
      const leftBBox  = runColumnLayout(leftTree,      TARGET_ID, true,  dynamicLeftX);

      // Build set of CENTER canonical IDs — Pass 3 must skip side-tree nodes
      // that will be deduped into their CENTER counterpart (focus person and
      // any of focus's spouses that appear on a side tree).
      const centerIds = new Set(centerBBox.nodes.map(n => n.id));

      console.log(`\n  RIGHT (AFTER trim) at dynamicRightX=${dynamicRightX.toFixed(0)}:`);
      console.log(`    x range : [${rightBBox.minX.toFixed(0)}, ${rightBBox.maxX.toFixed(0)}]  (width=${(rightBBox.maxX - rightBBox.minX).toFixed(0)})`);
      console.log(`    y range : [${rightBBox.minY.toFixed(0)}, ${rightBBox.maxY.toFixed(0)}]`);

      // Per-y-level for right tree
      const rightByY = buildByY(rightBBox.nodes);
      console.log(`\n  RIGHT tree nodes per y-level:`);
      for (const y of Array.from(rightByY.keys()).sort((a, b) => a - b)) {
        const ext = rightByY.get(y)!;
        const nodesAtY = rightBBox.nodes.filter(n => Math.round(n.y) === y);
        console.log(`    y=${y}: x=[${ext.minX.toFixed(0)}, ${ext.maxX.toFixed(0)}]  nodes: ${nodesAtY.map(n => `${n.name}${n.isSpouse ? '(sp)' : ''}`).join(', ')}`);
      }

      console.log(`\n  LEFT at dynamicLeftX=${dynamicLeftX.toFixed(0)}:`);
      console.log(`    x range : [${leftBBox.minX.toFixed(0)}, ${leftBBox.maxX.toFixed(0)}]  (width=${(leftBBox.maxX - leftBBox.minX).toFixed(0)})`);
      console.log(`    y range : [${leftBBox.minY.toFixed(0)}, ${leftBBox.maxY.toFixed(0)}]`);

      // Per-y-level for left tree
      const leftByY = buildByY(leftBBox.nodes);
      console.log(`\n  LEFT tree nodes per y-level:`);
      for (const y of Array.from(leftByY.keys()).sort((a, b) => a - b)) {
        const ext = leftByY.get(y)!;
        const nodesAtY = leftBBox.nodes.filter(n => Math.round(n.y) === y);
        console.log(`    y=${y}: x=[${ext.minX.toFixed(0)}, ${ext.maxX.toFixed(0)}]  nodes: ${nodesAtY.map(n => `${n.name}${n.isSpouse ? '(sp)' : ''}`).join(', ')}`);
      }

      // Pass 3: per-y-level overlap correction
      console.log('\n' + '='.repeat(70));
      console.log('PASS 3 SIMULATION  (per-y-level overlap correction)');
      console.log('='.repeat(70));

      const leftCheck  = computePass3Overlap(leftBBox.nodes,  centerByY, centerIds, 'left');
      const rightCheck = computePass3Overlap(rightBBox.nodes, centerByY, centerIds, 'right');

      if (leftCheck.overlap > 0) {
        console.log(`  LEFT needs correction: shift left by ${leftCheck.overlap.toFixed(0)}px`);
        console.log(`    worst node: ${leftCheck.worstNode} at y=${leftCheck.worstY}`);
      } else {
        console.log(`  LEFT: no overlap with center tree ✓`);
      }

      if (rightCheck.overlap > 0) {
        console.log(`  RIGHT needs correction: shift right by ${rightCheck.overlap.toFixed(0)}px`);
        console.log(`    worst node: ${rightCheck.worstNode} at y=${rightCheck.worstY}`);
      } else {
        console.log(`  RIGHT: no overlap with center tree ✓`);
      }

      // Final canvas summary
      const finalLeftX  = leftBBox.minX  - (leftCheck.overlap  > 0 ? leftCheck.overlap  : 0);
      const finalRightX = rightBBox.maxX + (rightCheck.overlap > 0 ? rightCheck.overlap : 0);
      console.log(`\n  Final canvas estimate after Pass 3:`);
      console.log(`    x range: [${finalLeftX.toFixed(0)}, ${finalRightX.toFixed(0)}]  total width=${(finalRightX - finalLeftX).toFixed(0)}px`);

      // Per-y gap check across all trees
      console.log(`\n  Per-y gap checks between all trees:`);
      const allYs = new Set([...centerByY.keys(), ...leftByY.keys(), ...rightByY.keys()]);
      for (const y of Array.from(allYs).sort((a, b) => a - b)) {
        const c = centerByY.get(y);
        const l = leftByY.get(y);
        const r = rightByY.get(y);
        const parts: string[] = [`y=${y}:`];
        if (l) {
          const lAdj = l.maxX - (leftCheck.overlap > 0 ? leftCheck.overlap : 0);
          const gap  = c ? (c.minX - lAdj).toFixed(0) : 'n/a (no center at this y)';
          const ok   = c ? (c.minX - lAdj >= INNER_GAP ? '✓' : '✗') : '–';
          parts.push(`left.maxX(${lAdj.toFixed(0)}) → center.minX(${c ? c.minX.toFixed(0) : '–'}): gap=${gap}px ${ok}`);
        }
        if (r) {
          const rAdj = r.minX + (rightCheck.overlap > 0 ? rightCheck.overlap : 0);
          const gap  = c ? (rAdj - c.maxX).toFixed(0) : 'n/a';
          const ok   = c ? (rAdj - c.maxX >= INNER_GAP ? '✓' : '✗') : '–';
          parts.push(`center.maxX(${c ? c.maxX.toFixed(0) : '–'}) → right.minX(${rAdj.toFixed(0)}): gap=${gap}px ${ok}`);
        }
        if (parts.length > 1) console.log(`    ${parts.join('  |  ')}`);
      }
    }

    console.log('\n' + '='.repeat(70));

    // ── STAGE D SIMULATION ────────────────────────────────────────────────
    // Parents move into CENTER as a normal d3 couple at the parent row.
    // LEFT and RIGHT collapse to pure ancestor chains terminating at the
    // father / mother (deduped against CENTER).  Each side tree is anchored
    // at the canvas position its leaf-parent occupies in CENTER.
    console.log('\nSTAGE D SIMULATION (parents in CENTER, side trees terminate at parent)');
    console.log('='.repeat(70));

    console.log(`\n  CENTER tree (D, root=father):`);
    printTree(centerTreeD, 1, '[root] ');
    console.log(`\n  LEFT tree (D, terminates at father):`);
    printTree(leftTreeD, 1, '[root] ');
    if (rightTreeD) {
      console.log(`\n  RIGHT tree (D, terminates at mother):`);
      printTree(rightTreeD, 1, '[root] ');
    }

    // Lay out CENTER first.  Use lineageOrder='last' so the focus lands on the
    // RIGHT of its siblings (Bob group LEFT of Linda, matching the screenshot's
    // paternal-on-left orientation).  Focus is anchored at (CENTER_X, FOCUS_Y).
    const centerD = runColumnLayout(centerTreeD, TARGET_ID, false, CENTER_X, undefined, undefined, 'last');

    // Locate the parents inside CENTER.  Father is the d3 root (main node);
    // mother is his spouse (isSpouse=true).
    const fatherInCenter = centerD.nodes.find(n => n.id === fatherId && !n.isSpouse);
    const motherInCenter = motherId !== null
      ? centerD.nodes.find(n => n.id === motherId && n.isSpouse)
      : null;

    if (!fatherInCenter) {
      console.log('\n  ✗ ERROR: father not found in CENTER — cannot anchor LEFT tree');
      console.log('\n' + '='.repeat(70));
      return;
    }

    // Side-tree anchors are the parents' canvas positions in CENTER (not LEFT_X/RIGHT_X).
    // Each side tree's leaf is the parent itself; we anchor on that leaf.
    const leftD = runColumnLayout(
      leftTreeD, TARGET_ID, true,
      fatherInCenter.x, fatherId, fatherInCenter.y,
    );
    const rightD = (rightTreeD && motherInCenter && motherId !== null)
      ? runColumnLayout(rightTreeD, TARGET_ID, false, motherInCenter.x, motherId, motherInCenter.y)
      : null;

    console.log(`\n  Anchors (D):  CENTER focus at (${CENTER_X}, ${FOCUS_Y})  |  LEFT leaf=father at (${fatherInCenter.x.toFixed(0)}, ${fatherInCenter.y.toFixed(0)})${motherInCenter ? `  |  RIGHT leaf=mother at (${motherInCenter.x.toFixed(0)}, ${motherInCenter.y.toFixed(0)})` : ''}`);

    console.log(`\n  CENTER (D):  x range : [${centerD.minX.toFixed(0)}, ${centerD.maxX.toFixed(0)}]`);
    const centerByYD = buildByY(centerD.nodes);
    for (const y of Array.from(centerByYD.keys()).sort((a, b) => a - b)) {
      const ext = centerByYD.get(y)!;
      const at = centerD.nodes.filter(n => Math.round(n.y) === y);
      console.log(`    y=${y}: x=[${ext.minX.toFixed(0)}, ${ext.maxX.toFixed(0)}]  nodes: ${at.map(n => `${n.name}${n.isSpouse ? '(sp)' : ''}`).join(', ')}`);
    }

    console.log(`\n  LEFT (D):  x range : [${leftD.minX.toFixed(0)}, ${leftD.maxX.toFixed(0)}]`);
    const leftByYD = buildByY(leftD.nodes);
    for (const y of Array.from(leftByYD.keys()).sort((a, b) => a - b)) {
      const ext = leftByYD.get(y)!;
      const at = leftD.nodes.filter(n => Math.round(n.y) === y);
      console.log(`    y=${y}: x=[${ext.minX.toFixed(0)}, ${ext.maxX.toFixed(0)}]  nodes: ${at.map(n => `${n.name}${n.isSpouse ? '(sp)' : ''}`).join(', ')}`);
    }
    if (rightD) {
      console.log(`\n  RIGHT (D):  x range : [${rightD.minX.toFixed(0)}, ${rightD.maxX.toFixed(0)}]`);
      const rightByYD = buildByY(rightD.nodes);
      for (const y of Array.from(rightByYD.keys()).sort((a, b) => a - b)) {
        const ext = rightByYD.get(y)!;
        const at = rightD.nodes.filter(n => Math.round(n.y) === y);
        console.log(`    y=${y}: x=[${ext.minX.toFixed(0)}, ${ext.maxX.toFixed(0)}]  nodes: ${at.map(n => `${n.name}${n.isSpouse ? '(sp)' : ''}`).join(', ')}`);
      }
    }

    // Pass 3: skip side-tree nodes whose canonical id is in CENTER (parents themselves).
    const centerIdsD = new Set(centerD.nodes.map(n => n.id));
    const leftCheckD  = computePass3Overlap(leftD.nodes,  centerByYD, centerIdsD, 'left');
    const rightCheckD = rightD ? computePass3Overlap(rightD.nodes, centerByYD, centerIdsD, 'right') : { overlap: 0, worstY: 0, worstNode: '' };

    console.log(`\n  Pass 3 (D):`);
    console.log(`    LEFT  ${leftCheckD.overlap > 0 ? `shifts ${leftCheckD.overlap.toFixed(0)}px (worst: ${leftCheckD.worstNode} at y=${leftCheckD.worstY})` : 'no overlap ✓'}`);
    console.log(`    RIGHT ${rightCheckD.overlap > 0 ? `shifts ${rightCheckD.overlap.toFixed(0)}px (worst: ${rightCheckD.worstNode} at y=${rightCheckD.worstY})` : 'no overlap ✓'}`);

    // Headline gaps.
    const focusD = centerD.nodes.find(n => n.id === TARGET_ID && !n.isSpouse);
    if (focusD) {
      const fLeft  = focusD.x;
      const fRight = focusD.x + PERSON_CARD_WIDTH;

      // Closest neighbours on each side of focus at y=0.  Reports both the
      // immediate-right and immediate-left non-focus card so the user can see
      // both the "spouse" side (John) and the "sibling-group" side (Susan) gaps.
      const y0 = Math.round(focusD.y);
      const right = centerD.nodes
        .filter(n => Math.round(n.y) === y0 && n.id !== TARGET_ID && n.x >= fRight)
        .sort((a, b) => a.x - b.x)[0];
      const left = centerD.nodes
        .filter(n => Math.round(n.y) === y0 && n.id !== TARGET_ID && n.x + PERSON_CARD_WIDTH <= fLeft)
        .sort((a, b) => b.x - a.x)[0];
      if (left)  console.log(`\n  Left  neighbour ↔ Focus: ${left.name}${left.isSpouse ? '(sp)' : ''} right(${(left.x + PERSON_CARD_WIDTH).toFixed(0)}) → focus.left(${fLeft.toFixed(0)}) = ${(fLeft - (left.x + PERSON_CARD_WIDTH)).toFixed(0)}px`);
      if (right) console.log(`  Right neighbour ↔ Focus: focus.right(${fRight.toFixed(0)}) → ${right.name}${right.isSpouse ? '(sp)' : ''} left(${right.x.toFixed(0)}) = ${(right.x - fRight).toFixed(0)}px`);

      // Sibling-of-focus (real d3 sibling — same parent in CENTER).
      const sib = centerD.nodes
        .filter(n => Math.round(n.y) === y0 && !n.isSpouse && focusSiblingIds.has(n.id))
        .sort((a, b) => Math.abs(a.x - fLeft) - Math.abs(b.x - fLeft))[0];
      if (sib) {
        const gap = sib.x > fRight ? sib.x - fRight : fLeft - (sib.x + PERSON_CARD_WIDTH);
        console.log(`  Sibling↔Focus gap: ${sib.name} (id=${sib.id}) at x=${sib.x.toFixed(0)} → focus=[${fLeft.toFixed(0)}, ${fRight.toFixed(0)}]  gap=${gap.toFixed(0)}px`);
      }

      // Father↔Mother gap inside CENTER (should be SPOUSE_GAP = 20).
      if (motherInCenter) {
        const fpRight = fatherInCenter.x + PERSON_CARD_WIDTH;
        const mpLeft  = motherInCenter.x;
        const ppGap   = mpLeft - fpRight;
        console.log(`  Father↔Mother gap: ${personName(parents[0])} right(${fpRight.toFixed(0)}) → ${personName(parents[1])} left(${mpLeft.toFixed(0)}) = ${ppGap.toFixed(0)}px ${Math.abs(ppGap - SPOUSE_GAP) <= 1 ? '✓' : '✗ (expected ' + SPOUSE_GAP + ')'}`);
      }
    }

    // ── Actual composed output (the real computeFocusLayout, end to end) ──
    // The per-pass printouts above run each column through the real engine;
    // this runs the full composition (Pass 3 shifts + dedup + edge remap) so
    // the final node/edge set matches exactly what the app renders.
    const focusTreesD: FocusTrees = {
      stage: 'D',
      center: centerTreeD,
      left: leftTreeD,
      right: rightTreeD,
      focusPersonId: TARGET_ID,
      leftParentId: fatherId,
      rightParentId: motherId,
    };
    const actual = computeFocusLayout(focusTreesD);
    const xsAll = actual.nodes.map(n => n.position.x);
    console.log(`\n  ACTUAL computeFocusLayout: ${actual.nodes.length} nodes, ${actual.edges.length} edges, x=[${Math.min(...xsAll).toFixed(0)}, ${(Math.max(...xsAll) + PERSON_CARD_WIDTH).toFixed(0)}]`);
    const actualFocus = actual.nodes.find(n => n.data.person.id === TARGET_ID && !n.data.isSpouse);
    if (actualFocus) {
      const ok = Math.abs(actualFocus.position.x - CENTER_X) <= 1 && Math.abs(actualFocus.position.y - FOCUS_Y) <= 1;
      console.log(`  ACTUAL focus position: (${actualFocus.position.x.toFixed(0)}, ${actualFocus.position.y.toFixed(0)})  expected (${CENTER_X}, ${FOCUS_Y}) ${ok ? '✓' : '✗'}`);
    }

    console.log('\n' + '='.repeat(70));
  } finally {
    await pool.end();
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
