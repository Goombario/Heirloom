/*
 * The merge dialog's model (#28, ADR 0052): which side is kept, which value each
 * differing field keeps, and what the request sends. Pure: no React, no DOM.
 */

import type { MergeField, MergeSide, MergeTake } from '@/lib/data/types';

export type Side = 'a' | 'b';

export interface MergeChoice {
  /** The record that stays. */
  keep: Side;
  /** Per differing field, whose value stays. */
  picks: Partial<Record<MergeField, Side>>;
}

/** Picking the record to keep resets every field to that record's value (the locked board). */
export function chooseKeep(keep: Side, differing: readonly MergeField[]): MergeChoice {
  return { keep, picks: Object.fromEntries(differing.map((f) => [f, keep])) };
}


/** The POST body: kept and other ids, and `take` only for fields that keep the other value. */
export function mergeRequest(a: MergeSide, b: MergeSide, choice: MergeChoice): { keptId: number; otherId: number; take: MergeTake } {
  const kept = choice.keep === 'a' ? a : b;
  const other = choice.keep === 'a' ? b : a;
  const take: MergeTake = {};
  for (const [field, side] of Object.entries(choice.picks) as [MergeField, Side][]) {
    if (side !== choice.keep) take[field] = 'other';
  }
  return { keptId: kept.Id, otherId: other.Id, take };
}

/** "Anna Maria Lindqvist": the stored given name and surname. */
export function sideName(side: Pick<MergeSide, 'FirstName' | 'LastName'>): string {
  return [side.FirstName, side.LastName].map((v) => v?.trim()).filter(Boolean).join(' ');
}

/** The "Also moves" counts, in the board's order, without the zeros. */
const MOVE_KEYS = ['events', 'citations', 'notes', 'photos', 'cases', 'familyLinks'] as const;
type MoveKey = (typeof MOVE_KEYS)[number];

export function movedCounts(side: MergeSide): { key: MoveKey; count: number }[] {
  return MOVE_KEYS.map((key) => ({ key, count: side.Counts[key] })).filter((m) => m.count > 0);
}

/** How the living flag reads in the dialog: deceased, living or not set. */
export function livingValue(side: Pick<MergeSide, 'IsDeceased'>): 'deceased' | 'living' | 'unknown' {
  if (side.IsDeceased === 1) return 'deceased';
  return side.IsDeceased === 0 ? 'living' : 'unknown';
}

/** M, F, X or not set. */
export function sexValue(side: Pick<MergeSide, 'Sex'>): 'M' | 'F' | 'X' | 'unknown' {
  return side.Sex === 'M' || side.Sex === 'F' || side.Sex === 'X' ? side.Sex : 'unknown';
}

/** The name the kept record ends with, and the one that becomes an alternate name. */
export function resultNames(a: MergeSide, b: MergeSide, choice: MergeChoice): { kept: string; other: string } {
  const nameSide = choice.picks.name ?? choice.keep;
  const kept = nameSide === 'a' ? a : b;
  const other = nameSide === 'a' ? b : a;
  return { kept: sideName(kept), other: sideName(other) };
}

/**
 * The people the picker lists as likely duplicates of `personId`: the others in
 * any likely-match group it belongs to, in the groups' order, each once.
 */
export function duplicatesOf(personId: number, groups: number[][]): number[] {
  const out: number[] = [];
  for (const group of groups) {
    if (!group.includes(personId)) continue;
    for (const id of group) if (id !== personId && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The merge entry's log, as the Audit page reads it from `Changes.merge`. */
export interface MergeLogView {
  keptId: number;
  mergedId: number;
  keptName: string;
  mergedName: string;
  notKept: Partial<Record<MergeField, Record<string, unknown>>>;
  alternateName: string | null;
  moved: Record<string, number>;
  combined: Record<string, number>;
}

/** The merge log of an audit entry, or null for any other entry. */
export function mergeLogOf(changes: unknown): MergeLogView | null {
  const c = changes as { summary?: { kind?: unknown }; merge?: Partial<MergeLogView> } | null;
  if (c?.summary?.kind !== 'person_merge' || !c.merge || typeof c.merge !== 'object') return null;
  const m = c.merge;
  if (typeof m.keptId !== 'number' || typeof m.mergedId !== 'number') return null;
  return {
    keptId: m.keptId,
    mergedId: m.mergedId,
    keptName: typeof m.keptName === 'string' ? m.keptName : '',
    mergedName: typeof m.mergedName === 'string' ? m.mergedName : '',
    notKept: (m.notKept && typeof m.notKept === 'object' ? m.notKept : {}) as MergeLogView['notKept'],
    alternateName: typeof m.alternateName === 'string' ? m.alternateName : null,
    moved: (m.moved && typeof m.moved === 'object' ? m.moved : {}) as Record<string, number>,
    combined: (m.combined && typeof m.combined === 'object' ? m.combined : {}) as Record<string, number>,
  };
}

/** The trail a merge's revert leaves: shown, never reverted itself. */
export function isMergeRevertTrail(changes: unknown): boolean {
  return (changes as { summary?: { kind?: unknown } } | null)?.summary?.kind === 'person_merge_revert';
}
