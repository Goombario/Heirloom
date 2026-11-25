import { describe, test, expect } from 'vitest';
import { shiftPick, parseRelateParam, relateRoles, sharedAncestor, wholePathRoot, drawnPeople, NO_PAIR } from '@/lib/tree/relate';
import { computeStandardLayout } from '@/lib/tree/layout/standardLayout';
import type { TreeNode, Spouse } from '@/app/components/tree/types';

// #256: Shift-click two people on the tree.
describe('Shift-click rules', () => {
  test('the person open in the panel is person 1, so one Shift-click is enough', () => {
    expect(shiftPick(NO_PAIR, 7, 3)).toEqual({ first: 3, second: 7 });
  });
  test('with no panel open, the first Shift-click picks person 1', () => {
    expect(shiftPick(NO_PAIR, 7, null)).toEqual({ first: 7, second: null });
    expect(shiftPick(NO_PAIR, 7, 7)).toEqual({ first: 7, second: null });
  });
  test('person 2 again takes them off; a third person replaces person 2', () => {
    expect(shiftPick({ first: 3, second: 7 }, 7, 3)).toEqual({ first: 3, second: null });
    expect(shiftPick({ first: 3, second: 7 }, 9, 3)).toEqual({ first: 3, second: 9 });
    expect(shiftPick({ first: 3, second: 7 }, 3, 3)).toEqual({ first: 3, second: 7 });
  });
  test('relate=a,b from the Relationship tool', () => {
    expect(parseRelateParam('12,34')).toEqual({ first: 12, second: 34 });
    expect(parseRelateParam('12,12')).toEqual(NO_PAIR);
    expect(parseRelateParam('x')).toEqual(NO_PAIR);
    expect(parseRelateParam(null)).toEqual(NO_PAIR);
  });
});

const p = (id: number, extra: Partial<TreeNode> = {}): TreeNode => ({ id, name: `P${id}`, photoMediaId: null, spouses: [], birthYear: 1800 + id, ...extra });
const sp = (id: number): Spouse => ({ id, name: `S${id}`, photoMediaId: null, hasChildren: true });
const step = (id: number, relationship: string) => ({ id, name: `P${id}`, relationship });

describe('drawing the path', () => {
  // Grandfather 1 (wife 2) has sons 3 and 4; 3's child is 5, 4's child is 6: 5 and 6 are first cousins.
  const tree = p(1, { spouses: [sp(2)], children: [p(3, { otherParentId: 2, children: [p(5)] }), p(4, { otherParentId: 2, children: [p(6)] })] });
  const path = [5, 3, 1, 4, 6];

  test('the two people, the path between, everyone else faded; only path lines light up', () => {
    const out = computeStandardLayout(tree, 'descendants');
    const r = relateRoles(out.nodes, out.edges, { first: 5, second: 6 }, path);
    expect(r.node.get('person-5')).toBe('first');
    expect(r.node.get('person-6')).toBe('second');
    expect(r.node.get('person-1')).toBe('on');
    expect(r.node.get('person-2-spouse0-of1')).toBe('dim');
    const on = [...r.edge].filter(([, v]) => v === 'on').map(([k]) => k).sort();
    // Lines from the couple (drawn from the wife's card) still carry the grandfather's steps.
    expect(on).toHaveLength(4);
    expect(r.edge.get(out.edges.find((e) => e.type === 'spouse')!.id)).toBe('dim');
  });

  test('a couple card stays lit when one half is on the path', () => {
    const out = computeStandardLayout(tree, 'descendants', 'vertical', false, 'normal', 'compact', 'couple');
    const r = relateRoles(out.nodes, out.edges, { first: 5, second: 6 }, path);
    expect(r.node.get('person-1')).toBe('on');
    expect([...r.edge.values()].filter((v) => v === 'on')).toHaveLength(4);
  });

  test('before person 2 is picked nothing fades', () => {
    const out = computeStandardLayout(tree, 'descendants');
    const r = relateRoles(out.nodes, out.edges, { first: 5, second: null }, []);
    expect(r.node.get('person-5')).toBe('first');
    expect(r.node.size).toBe(1);
    expect(r.edge.size).toBe(0);
  });

  test('who is drawn, the shared ancestor and where to show the whole path from', () => {
    expect([...drawnPeople(tree)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    const cousins = [step(5, 'Start'), step(3, 'child'), step(1, 'child'), step(4, 'parent'), step(6, 'parent')];
    expect(sharedAncestor(cousins)).toBe(1);
    expect(wholePathRoot(cousins)).toBe(1);
    expect(wholePathRoot([step(5, 'Start'), step(3, 'child'), step(1, 'child')])).toBe(1);
    expect(wholePathRoot([step(1, 'Start'), step(3, 'parent')])).toBe(1);
  });
});
