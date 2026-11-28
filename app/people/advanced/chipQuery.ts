import type { SearchCondition, SearchQuery } from '@/lib/search/people-query';
import type { SexBucket, TriState } from '../peopleFilters';

/**
 * The People list's filter chips as shortcuts into advanced search (#247, P1):
 * each chip is one condition in the first "match all" group, so turning a chip on
 * adds a row to the panel and editing or removing that row changes the chip.
 */

type TriChip = 'parents' | 'children' | 'photo' | 'living';

export interface ChipState {
    sex: SexBucket | null;
    surname: string | null;
    parents: TriState;
    children: TriState;
    photo: TriState;
    living: TriState;
}

type ChipKind = keyof ChipState;

/** The condition a chip stands for in each state, or null when it is off. */
function chipCondition(kind: ChipKind, value: ChipState[ChipKind]): SearchCondition | null {
    if (value === null || value === 'off' || value === '') return null;
    switch (kind) {
        case 'sex': return { field: 'sex', op: 'is', v: value as string };
        case 'surname': return { field: 'surname', op: 'is', v: value as string };
        case 'parents': return { field: 'parents', op: value === 'yes' ? 'has' : 'has_none' };
        case 'children': return { field: 'children', op: value === 'yes' ? 'has' : 'has_none' };
        case 'photo': return { field: 'media', op: value === 'yes' ? 'has' : 'has_none' };
        // Living keeps the chip's old meaning: "living" is anyone not known to be deceased.
        case 'living': return value === 'yes' ? { field: 'living', op: 'is_not', v: 'deceased' } : { field: 'living', op: 'is', v: 'deceased' };
    }
}

/** Which chip a condition is, and in what state, when it is exactly a chip's shape. */
function readChip(c: SearchCondition): { kind: ChipKind; value: ChipState[ChipKind] } | null {
    if (c.field === 'sex' && c.op === 'is' && (c.v === 'M' || c.v === 'F' || c.v === 'X' || c.v === 'U')) return { kind: 'sex', value: c.v };
    if (c.field === 'surname' && c.op === 'is' && c.v?.trim()) return { kind: 'surname', value: c.v };
    const tri = (kind: TriChip) => ({ kind, value: (c.op === 'has' ? 'yes' : 'no') as TriState });
    if (c.field === 'parents' && (c.op === 'has' || c.op === 'has_none')) return tri('parents');
    if (c.field === 'children' && (c.op === 'has' || c.op === 'has_none')) return tri('children');
    if (c.field === 'media' && (c.op === 'has' || c.op === 'has_none')) return tri('photo');
    if (c.field === 'living' && c.op === 'is_not' && c.v === 'deceased') return { kind: 'living', value: 'yes' };
    if (c.field === 'living' && c.op === 'is' && c.v === 'deceased') return { kind: 'living', value: 'no' };
    return null;
}

/** True when every condition is one a chip shows, in one group: the chips say it all, so no summary line. */
export function isChipOnly(q: SearchQuery): boolean {
    return q.groups.length <= 1 && q.groups.every((g) => g.match === 'all' && g.conds.every((c) => readChip(c) !== null));
}

const OFF: ChipState = { sex: null, surname: null, parents: 'off', children: 'off', photo: 'off', living: 'off' };

/** The group the chips read and write: the first "match all" group. */
function chipGroupIndex(q: SearchQuery): number {
    return q.groups.findIndex((g) => g.match === 'all');
}

/** Each chip's state, read from the chip group's conditions (the first of each kind). */
export function chipsFromQuery(q: SearchQuery): ChipState {
    const out: ChipState = { ...OFF };
    const g = q.groups[chipGroupIndex(q)];
    if (!g) return out;
    const seen = new Set<ChipKind>();
    for (const c of g.conds) {
        const chip = readChip(c);
        if (!chip || seen.has(chip.kind)) continue;
        seen.add(chip.kind);
        (out as unknown as Record<ChipKind, unknown>)[chip.kind] = chip.value;
    }
    return out;
}

/** The query with one chip set: its row replaced in place, added, or removed. */
export function setChip<K extends ChipKind>(q: SearchQuery, kind: K, value: ChipState[K]): SearchQuery {
    const next = chipCondition(kind, value);
    let gi = chipGroupIndex(q);
    const groups = q.groups.map((g) => ({ ...g, conds: [...g.conds] }));
    if (gi < 0) {
        if (!next) return q;
        groups.unshift({ match: 'all', conds: [] });
        gi = 0;
    }
    const conds = groups[gi].conds;
    const at = conds.findIndex((c) => readChip(c)?.kind === kind);
    if (at >= 0 && next) conds[at] = next;
    else if (at >= 0) conds.splice(at, 1);
    else if (next) conds.push(next);
    return { groups: groups.filter((g) => g.conds.length > 0) };
}
