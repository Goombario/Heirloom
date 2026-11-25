/**
 * Advanced search on the People list (#247): a query is groups of conditions,
 * AND (or ANY) inside a group and OR between groups, one level deep. Each
 * condition is field + condition + value, in plain words on screen and never in
 * GEDCOM tokens.
 *
 * Pure: no DB, no DOM. The page builds and shows queries with it, the URL keeps
 * one (`?q=`), and the service validates what it is sent with `normalizeQuery`.
 */

export type GroupMatch = 'all' | 'any';

export interface SearchCondition {
    field: FieldId;
    op: OpId;
    /** Text, a date as typed, a number, or a choice's code. */
    v?: string;
    /** The second value of "is between". */
    v2?: string;
    /** A record picked for the value: a person, source or case. */
    id?: number;
    /** Relationship: how a relative counts. */
    rel?: RelationKind;
    /** Relationship: false counts blood relatives only. */
    marriage?: boolean;
    /** Relationship: the step limit. */
    steps?: number;
}

export interface SearchGroup {
    match: GroupMatch;
    conds: SearchCondition[];
}

export interface SearchQuery {
    groups: SearchGroup[];
}

export type RelationKind = 'related' | 'ancestor' | 'descendant' | 'close';

export const FIELD_IDS = [
    'given', 'surname', 'anyname',
    'sex', 'living', 'birth_date', 'birth_place', 'death_date', 'death_place', 'age_at_death', 'event_type',
    'relationship', 'parents', 'children',
    'sources', 'media', 'cases', 'data_checks', 'notes', 'created', 'edited',
] as const;
export type FieldId = (typeof FIELD_IDS)[number];

export const OP_IDS = [
    'is', 'is_not', 'contains', 'starts_with', 'is_empty',
    'before', 'after', 'between', 'unknown',
    'is_in',
    'less', 'more',
    'has', 'has_none', 'cites', 'in_case', 'has_type',
    'related',
] as const;
export type OpId = (typeof OP_IDS)[number];

/** What a condition's value is, which picks its editor. */
export type ValueKind = 'text' | 'date' | 'number' | 'sex' | 'living' | 'place' | 'event_type' | 'person' | 'source' | 'case' | 'rule' | 'none';

export type FieldGroup = 'names' | 'life' | 'family' | 'records';

interface FieldDef {
    group: FieldGroup;
    ops: readonly OpId[];
    /** The value each condition takes; a condition missing from here takes none. */
    value: Partial<Record<OpId, ValueKind>>;
}

const TEXT_OPS = ['is', 'is_not', 'contains', 'starts_with', 'is_empty'] as const;
const TEXT_VALUE = { is: 'text', is_not: 'text', contains: 'text', starts_with: 'text' } as const;
const DATE_OPS = ['is', 'before', 'after', 'between', 'unknown'] as const;
const DATE_VALUE = { is: 'date', before: 'date', after: 'date', between: 'date' } as const;
const PLACE_OPS = ['is_in', 'contains', 'is_empty'] as const;
const PLACE_VALUE = { is_in: 'place', contains: 'text' } as const;

export const FIELDS: Record<FieldId, FieldDef> = {
    given: { group: 'names', ops: TEXT_OPS, value: TEXT_VALUE },
    surname: { group: 'names', ops: TEXT_OPS, value: TEXT_VALUE },
    anyname: { group: 'names', ops: TEXT_OPS, value: TEXT_VALUE },
    sex: { group: 'life', ops: ['is', 'is_not'], value: { is: 'sex', is_not: 'sex' } },
    living: { group: 'life', ops: ['is', 'is_not'], value: { is: 'living', is_not: 'living' } },
    birth_date: { group: 'life', ops: DATE_OPS, value: DATE_VALUE },
    birth_place: { group: 'life', ops: PLACE_OPS, value: PLACE_VALUE },
    death_date: { group: 'life', ops: DATE_OPS, value: DATE_VALUE },
    death_place: { group: 'life', ops: PLACE_OPS, value: PLACE_VALUE },
    age_at_death: { group: 'life', ops: ['less', 'more', 'between'], value: { less: 'number', more: 'number', between: 'number' } },
    event_type: { group: 'life', ops: ['has', 'has_none'], value: { has: 'event_type', has_none: 'event_type' } },
    relationship: { group: 'family', ops: ['related'], value: { related: 'person' } },
    parents: { group: 'family', ops: ['has', 'has_none'], value: {} },
    children: { group: 'family', ops: ['has', 'has_none'], value: {} },
    sources: { group: 'records', ops: ['has', 'has_none', 'cites'], value: { cites: 'source' } },
    media: { group: 'records', ops: ['has', 'has_none'], value: {} },
    cases: { group: 'records', ops: ['has', 'has_none', 'in_case'], value: { in_case: 'case' } },
    data_checks: { group: 'records', ops: ['has', 'has_none', 'has_type'], value: { has_type: 'rule' } },
    notes: { group: 'records', ops: ['has', 'has_none', 'contains'], value: { contains: 'text' } },
    created: { group: 'records', ops: ['before', 'after', 'between'], value: { before: 'date', after: 'date', between: 'date' } },
    edited: { group: 'records', ops: ['before', 'after', 'between'], value: { before: 'date', after: 'date', between: 'date' } },
};

export const FIELD_GROUPS: readonly FieldGroup[] = ['names', 'life', 'family', 'records'];

export const SEX_VALUES = ['M', 'F', 'X', 'U'] as const;
export const LIVING_VALUES = ['living', 'deceased', 'unknown'] as const;

/** "Related to" defaults (#247 lock): any line, blood and marriage, six steps. */
export const DEFAULT_STEPS = 6;
export const MAX_STEPS = 20;
const MAX_GROUPS = 10;
const MAX_CONDS = 20;
const MAX_TEXT = 200;

export const EMPTY_QUERY: SearchQuery = { groups: [] };

export function valueKind(field: FieldId, op: OpId): ValueKind {
    return FIELDS[field].value[op] ?? 'none';
}

/** A fresh condition for a field: its first condition, an empty value. */
export function newCondition(field: FieldId): SearchCondition {
    const op = FIELDS[field].ops[0];
    return field === 'relationship'
        ? { field, op, rel: 'related', marriage: true, steps: DEFAULT_STEPS }
        : { field, op };
}

/** True when a condition has the value its kind needs, so it takes part in the search. */
export function isComplete(c: SearchCondition): boolean {
    const kind = valueKind(c.field, c.op);
    if (kind === 'none') return true;
    if (kind === 'person' || kind === 'source' || kind === 'case') return typeof c.id === 'number' && c.id > 0;
    const v = c.v?.trim() ?? '';
    if (!v) return false;
    if (c.op === 'between') return (c.v2?.trim() ?? '') !== '';
    if (kind === 'number') return Number.isFinite(Number(v));
    return true;
}

/** The query's conditions that take part, in order; groups with none drop out. */
export function activeQuery(q: SearchQuery): SearchQuery {
    return { groups: q.groups.map((g) => ({ ...g, conds: g.conds.filter(isComplete) })).filter((g) => g.conds.length > 0) };
}

export function conditionCount(q: SearchQuery): number {
    return activeQuery(q).groups.reduce((n, g) => n + g.conds.length, 0);
}

const isField = (v: unknown): v is FieldId => typeof v === 'string' && (FIELD_IDS as readonly string[]).includes(v);
const isOp = (v: unknown): v is OpId => typeof v === 'string' && (OP_IDS as readonly string[]).includes(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : typeof v === 'number' ? String(v) : undefined);

/**
 * A query from untrusted input (the URL, a saved row, a request body): unknown
 * fields and conditions dropped, sizes capped. Never throws.
 */
export function normalizeQuery(input: unknown): SearchQuery {
    const groups = (input && typeof input === 'object' && Array.isArray((input as SearchQuery).groups)) ? (input as SearchQuery).groups : [];
    const out: SearchGroup[] = [];
    for (const g of groups.slice(0, MAX_GROUPS)) {
        if (!g || typeof g !== 'object' || !Array.isArray(g.conds)) continue;
        const conds: SearchCondition[] = [];
        for (const c of g.conds.slice(0, MAX_CONDS)) {
            if (!c || typeof c !== 'object' || !isField(c.field) || !isOp(c.op) || !FIELDS[c.field].ops.includes(c.op)) continue;
            const cond: SearchCondition = { field: c.field, op: c.op };
            const v = text(c.v); if (v !== undefined) cond.v = v;
            const v2 = text(c.v2); if (v2 !== undefined) cond.v2 = v2;
            if (typeof c.id === 'number' && Number.isInteger(c.id) && c.id > 0) cond.id = c.id;
            if (c.field === 'relationship') {
                cond.rel = (['related', 'ancestor', 'descendant', 'close'] as const).includes(c.rel as RelationKind) ? c.rel : 'related';
                cond.marriage = c.marriage !== false;
                const steps = Number(c.steps);
                cond.steps = Number.isInteger(steps) && steps >= 1 ? Math.min(steps, MAX_STEPS) : DEFAULT_STEPS;
            }
            conds.push(cond);
        }
        if (conds.length > 0) out.push({ match: g.match === 'any' ? 'any' : 'all', conds });
    }
    return { groups: out };
}

/** base64url of UTF-8 text, in the browser and on the server. */
function toBase64Url(s: string): string {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

/** The `?q=` value for a query, or null when it has no conditions. */
export function encodeQuery(q: SearchQuery): string | null {
    if (q.groups.every((g) => g.conds.length === 0)) return null;
    return toBase64Url(JSON.stringify(q));
}

/** A query from `?q=`; anything unreadable is an empty query. */
export function decodeQuery(param: string | null | undefined): SearchQuery {
    if (!param) return EMPTY_QUERY;
    try {
        return normalizeQuery(JSON.parse(fromBase64Url(param)));
    } catch {
        return EMPTY_QUERY;
    }
}

/** The same condition, ignoring nothing: used to light a chip whose row is in the builder. */
export function sameCondition(a: SearchCondition, b: SearchCondition): boolean {
    return a.field === b.field && a.op === b.op && (a.v ?? '') === (b.v ?? '') && (a.v2 ?? '') === (b.v2 ?? '') && (a.id ?? 0) === (b.id ?? 0);
}
