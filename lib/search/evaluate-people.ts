/**
 * Runs an advanced-search query (#247) over a tree's search index. Each
 * condition becomes the set of people it matches; a group joins its sets with
 * AND (all) or OR (any), and the groups join with OR.
 *
 * Dates match by range (lib/date-intervals.ts): "about 1940" counts for
 * "is between 1939 and 1945" because the readings overlap.
 *
 * Pure: no DB, no DOM.
 */

import { dateInterval, daysFromCivil, type DateInterval } from '@/lib/date-intervals';
import { parseUserDateInput } from '@/lib/date-utils';
import { livingStatus } from '@/lib/living';
import { foldForSearch } from '@/lib/utils/search-fold';
import type { SearchPersonRow } from '@/lib/db/queries/advanced-search';
import { activeQuery, type FieldId, type SearchCondition, type SearchQuery } from './people-query';

export interface PeopleSearchIndex {
    people: SearchPersonRow[];
    /** Other names per person. */
    names?: Map<number, string[]>;
    families?: Array<{ Id: number; Partner1Id: number | null; Partner2Id: number | null; MarriageDate: string | null }>;
    children?: Array<{ FamilyId: number; ChildId: number }>;
    /** Event types per person, their own and their families'. */
    events?: Array<{ PersonId: number | null; FamilyId: number | null; Type: string }>;
    places?: Array<{ Id: number; Name: string; ParentId: number | null }>;
    citations?: Array<{ PersonId: number; SourceId: number }>;
    cases?: Array<{ PersonId: number; CaseId: number }>;
    notes?: Array<{ PersonId: number; Text: string }>;
    /** Open data-check problems: person id → rule ids. */
    problems?: Map<number, Set<string>>;
}

/** Which slices of the index a query needs, so the service loads no more. */
export function neededSlices(q: SearchQuery): Set<keyof PeopleSearchIndex> {
    const need = new Set<keyof PeopleSearchIndex>(['people']);
    const by: Partial<Record<FieldId, Array<keyof PeopleSearchIndex>>> = {
        anyname: ['names'],
        birth_place: ['places'], death_place: ['places'],
        event_type: ['events', 'families'],
        relationship: ['families', 'children'], parents: ['families', 'children'], children: ['families', 'children'],
        sources: ['citations'], cases: ['cases'], notes: ['notes'], data_checks: ['problems'],
    };
    for (const g of q.groups) for (const c of g.conds) for (const s of by[c.field] ?? []) need.add(s);
    return need;
}

const fold = (s: string | null | undefined) => foldForSearch((s ?? '').trim()).replace(/\s+/g, ' ');

/** A typed date ("1939", "1 Sep 1939", "about 1940") as the days it could mean. */
function valueInterval(v: string | undefined): DateInterval | null {
    if (!v?.trim()) return null;
    return dateInterval(parseUserDateInput(v) ?? v.trim());
}

const overlaps = (a: DateInterval, b: DateInterval) => a.earliest <= b.latest && b.earliest <= a.latest;

/** A timestamp as its day number. */
function dayOf(ts: string | Date | null): number | null {
    if (ts == null) return null;
    const d = ts instanceof Date ? ts : new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    return daysFromCivil(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function sexBucket(sex: string | null): string {
    const v = (sex ?? '').trim().toUpperCase();
    return v === 'M' || v === 'F' ? v : v === '' || v === 'U' ? 'U' : 'X';
}

/** Text conditions over one or more names of a person. */
function textMatches(values: string[], op: string, v: string | undefined): boolean {
    const want = fold(v);
    const have = values.map(fold).filter(Boolean);
    switch (op) {
        case 'is': return have.some((h) => h === want);
        case 'is_not': return !have.some((h) => h === want);
        case 'contains': return have.some((h) => h.includes(want));
        case 'starts_with': return have.some((h) => h.startsWith(want) || h.split(' ').some((w) => w.startsWith(want)));
        case 'is_empty': return have.length === 0;
        default: return false;
    }
}

function dateMatches(stored: string | null, c: SearchCondition): boolean {
    const iv = dateInterval(stored);
    if (c.op === 'unknown') return iv === null;
    if (!iv) return false;
    const a = valueInterval(c.v);
    if (!a) return false;
    switch (c.op) {
        case 'is': return overlaps(iv, a);
        case 'before': return iv.earliest < a.earliest;
        case 'after': return iv.latest > a.latest;
        case 'between': {
            const b = valueInterval(c.v2);
            return !!b && overlaps(iv, { earliest: Math.min(a.earliest, b.earliest), latest: Math.max(a.latest, b.latest) });
        }
        default: return false;
    }
}

function stampMatches(ts: string | Date | null, c: SearchCondition): boolean {
    const day = dayOf(ts);
    const a = valueInterval(c.v);
    if (day === null || !a) return false;
    if (c.op === 'before') return day < a.earliest;
    if (c.op === 'after') return day > a.latest;
    const b = valueInterval(c.v2);
    return !!b && day >= Math.min(a.earliest, b.earliest) && day <= Math.max(a.latest, b.latest);
}

const YEAR_DAYS = 365.2425;

/** The ages a person could have died at, from every reading of the two dates. */
function deathAges(p: SearchPersonRow): [number, number] | null {
    const b = dateInterval(p.BirthDate);
    const d = dateInterval(p.DeathDate);
    if (!b || !d || ![b.earliest, b.latest, d.earliest, d.latest].every(Number.isFinite)) return null;
    const lo = Math.max(0, Math.floor((d.earliest - b.latest) / YEAR_DAYS));
    const hi = Math.max(0, Math.floor((d.latest - b.earliest) / YEAR_DAYS));
    return [lo, hi];
}

function groupBy<T, K, V>(rows: readonly T[] | undefined, key: (r: T) => K | null, val: (r: T) => V): Map<K, V[]> {
    const out = new Map<K, V[]>();
    for (const r of rows ?? []) {
        const k = key(r);
        if (k == null) continue;
        const list = out.get(k);
        if (list) list.push(val(r)); else out.set(k, [val(r)]);
    }
    return out;
}

/** The index's derived lookups, built once per run and only as needed. */
class Lookups {
    constructor(private ix: PeopleSearchIndex) {}
    private memo = new Map<string, unknown>();
    private once<T>(key: string, make: () => T): T {
        if (!this.memo.has(key)) this.memo.set(key, make());
        return this.memo.get(key) as T;
    }

    get partnersOfFamily() {
        return this.once('pf', () => new Map((this.ix.families ?? []).map((f) => [f.Id, [f.Partner1Id, f.Partner2Id].filter((x): x is number => x != null)])));
    }
    get childrenOfFamily() { return this.once('cf', () => groupBy(this.ix.children, (r) => r.FamilyId, (r) => r.ChildId)); }
    get familiesAsChild() { return this.once('fc', () => groupBy(this.ix.children, (r) => r.ChildId, (r) => r.FamilyId)); }
    get familiesAsPartner() {
        return this.once('fp', () => {
            const out = new Map<number, number[]>();
            for (const f of this.ix.families ?? []) for (const p of [f.Partner1Id, f.Partner2Id]) {
                if (p == null) continue;
                const list = out.get(p);
                if (list) list.push(f.Id); else out.set(p, [f.Id]);
            }
            return out;
        });
    }
    parents(id: number): number[] { return (this.familiesAsChild.get(id) ?? []).flatMap((f) => this.partnersOfFamily.get(f) ?? []); }
    children(id: number): number[] { return (this.familiesAsPartner.get(id) ?? []).flatMap((f) => this.childrenOfFamily.get(f) ?? []); }
    partners(id: number): number[] { return (this.familiesAsPartner.get(id) ?? []).flatMap((f) => this.partnersOfFamily.get(f) ?? []).filter((x) => x !== id); }
    siblings(id: number): number[] {
        return (this.familiesAsChild.get(id) ?? []).flatMap((f) => this.childrenOfFamily.get(f) ?? []).filter((x) => x !== id);
    }

    get names() { return this.ix.names ?? new Map<number, string[]>(); }
    get eventTypes() {
        return this.once('ev', () => {
            const out = new Map<number, Set<string>>();
            const add = (id: number, type: string) => {
                const s = out.get(id);
                if (s) s.add(type); else out.set(id, new Set([type]));
            };
            const partners = this.partnersOfFamily;
            for (const e of this.ix.events ?? []) {
                if (e.PersonId != null) add(e.PersonId, e.Type);
                else if (e.FamilyId != null) for (const p of partners.get(e.FamilyId) ?? []) add(p, e.Type);
            }
            // A marriage lives on the family row, not an event.
            for (const f of this.ix.families ?? []) if (f.MarriageDate) for (const p of partners.get(f.Id) ?? []) add(p, 'MARR');
            return out;
        });
    }
    get places() { return this.once('pl', () => new Map((this.ix.places ?? []).map((p) => [p.Id, p]))); }
    /** A place and every place it sits inside, folded. */
    placeChain(id: number | null): string[] {
        const out: string[] = [];
        const seen = new Set<number>();
        for (let cur = id; cur != null && !seen.has(cur); ) {
            seen.add(cur);
            const p = this.places.get(cur);
            if (!p) break;
            out.push(fold(p.Name));
            cur = p.ParentId;
        }
        return out;
    }
    get sources() { return this.once('src', () => groupBy(this.ix.citations, (r) => r.PersonId, (r) => r.SourceId)); }
    get cases() { return this.once('cs', () => groupBy(this.ix.cases, (r) => r.PersonId, (r) => r.CaseId)); }
    get notes() { return this.once('nt', () => groupBy(this.ix.notes, (r) => r.PersonId, (r) => fold(r.Text))); }
}

/** People within `steps` links of `from`, as the relationship condition counts them. */
function relatives(lk: Lookups, c: SearchCondition): Set<number> {
    const from = c.id!;
    const steps = c.steps ?? 6;
    const out = new Set<number>();
    const walk = (next: (id: number) => number[]) => {
        let frontier = [from];
        const seen = new Set([from]);
        for (let d = 0; d < steps && frontier.length; d++) {
            const nextFrontier: number[] = [];
            for (const id of frontier) for (const n of next(id)) {
                if (seen.has(n)) continue;
                seen.add(n);
                out.add(n);
                nextFrontier.push(n);
            }
            frontier = nextFrontier;
        }
    };
    switch (c.rel) {
        case 'ancestor': walk((id) => lk.parents(id)); break;
        case 'descendant': walk((id) => lk.children(id)); break;
        case 'close':
            for (const id of [...lk.partners(from), ...lk.children(from), ...lk.siblings(from)]) out.add(id);
            break;
        default:
            if (c.marriage !== false) {
                walk((id) => [...lk.parents(id), ...lk.children(id), ...lk.partners(id)]);
            } else {
                // Blood: a shared ancestor, up to it and down from it, within the steps.
                const up = new Map<number, number>([[from, 0]]);
                let frontier = [from];
                for (let d = 1; d <= steps && frontier.length; d++) {
                    const next: number[] = [];
                    for (const id of frontier) for (const p of lk.parents(id)) if (!up.has(p)) { up.set(p, d); next.push(p); }
                    frontier = next;
                }
                const best = new Map<number, number>(up);
                const queue = [...up.entries()].sort((a, b) => a[1] - b[1]);
                for (let i = 0; i < queue.length; i++) {
                    const [id, d] = queue[i];
                    if (d >= steps || best.get(id)! < d) continue;
                    for (const ch of lk.children(id)) {
                        if ((best.get(ch) ?? Infinity) <= d + 1) continue;
                        best.set(ch, d + 1);
                        queue.push([ch, d + 1]);
                    }
                }
                for (const id of best.keys()) if (id !== from) out.add(id);
            }
    }
    out.delete(from);
    return out;
}

/** The people one condition matches. */
function conditionSet(ix: PeopleSearchIndex, lk: Lookups, c: SearchCondition): Set<number> {
    if (c.field === 'relationship') return relatives(lk, c);
    const has = (b: boolean) => (c.op === 'has_none' ? !b : b);
    const test = (p: SearchPersonRow): boolean => {
        switch (c.field) {
            case 'given': return textMatches([p.FirstName ?? ''], c.op, c.v);
            case 'surname': return textMatches([p.LastName ?? ''], c.op, c.v);
            case 'anyname': return textMatches([p.FirstName ?? '', p.LastName ?? '', `${p.FirstName ?? ''} ${p.LastName ?? ''}`, ...(lk.names.get(p.Id) ?? [])], c.op, c.v);
            case 'sex': return (sexBucket(p.Sex) === c.v) === (c.op === 'is');
            case 'living': return (livingStatus(p) === c.v) === (c.op === 'is');
            case 'birth_date': return dateMatches(p.BirthDate, c);
            case 'death_date': return dateMatches(p.DeathDate, c);
            case 'birth_place':
            case 'death_place': {
                const birth = c.field === 'birth_place';
                const text = birth ? p.BirthPlace : p.DeathPlace;
                const id = birth ? p.BirthPlaceId : p.DeathPlaceId;
                if (c.op === 'is_empty') return !text?.trim() && id == null;
                const want = fold(c.v);
                if (c.op === 'contains') return fold(text).includes(want);
                // "is in": the place or one it sits inside, else a part of the text.
                return lk.placeChain(id).includes(want) || fold(text).split(',').map((s) => s.trim()).includes(want);
            }
            case 'age_at_death': {
                const ages = deathAges(p);
                const n = Number(c.v);
                if (!ages) return false;
                if (c.op === 'less') return ages[0] < n;
                if (c.op === 'more') return ages[1] > n;
                const m = Number(c.v2);
                return ages[0] <= Math.max(n, m) && ages[1] >= Math.min(n, m);
            }
            case 'event_type': {
                const types = lk.eventTypes.get(p.Id);
                const own = c.v === 'BIRT' ? !!(p.BirthDate || p.BirthPlace) : c.v === 'DEAT' ? !!(p.DeathDate || p.DeathPlace) : false;
                return has(own || !!types?.has(c.v ?? ''));
            }
            case 'parents': return has(lk.parents(p.Id).length > 0);
            case 'children': return has(lk.children(p.Id).length > 0);
            case 'sources': {
                const s = lk.sources.get(p.Id);
                return c.op === 'cites' ? !!s?.includes(c.id!) : has(!!s?.length);
            }
            case 'media': return has(p.HasPhoto);
            case 'cases': {
                const s = lk.cases.get(p.Id);
                return c.op === 'in_case' ? !!s?.includes(c.id!) : has(!!s?.length);
            }
            case 'data_checks': {
                const rules = ix.problems?.get(p.Id);
                return c.op === 'has_type' ? !!rules?.has(c.v ?? '') : has(!!rules?.size);
            }
            case 'notes': {
                const texts = lk.notes.get(p.Id);
                return c.op === 'contains' ? !!texts?.some((t) => t.includes(fold(c.v))) : has(!!texts?.length);
            }
            case 'created': return stampMatches(p.CreatedAt, c);
            case 'edited': return stampMatches(p.UpdatedAt, c);
            default: return false;
        }
    };
    return new Set(ix.people.filter(test).map((p) => p.Id));
}

function combine(sets: Set<number>[], match: 'all' | 'any'): Set<number> {
    if (sets.length === 0) return new Set();
    if (match === 'any') return new Set(sets.flatMap((s) => [...s]));
    const [first, ...rest] = [...sets].sort((a, b) => a.size - b.size);
    return new Set([...first].filter((id) => rest.every((s) => s.has(id))));
}

export interface PeopleSearchResult {
    /** The matching people, or null when the query has no conditions (everyone). */
    ids: number[] | null;
    /**
     * With nothing matching: how many would match without each condition, in the
     * order of `activeQuery(query)` (groups, then conditions), so the empty state can offer
     * the removal that brings people back.
     */
    without?: number[];
}

export function evaluatePeopleSearch(index: PeopleSearchIndex, raw: SearchQuery, explain = false): PeopleSearchResult {
    const q = activeQuery(raw);
    if (q.groups.length === 0) return { ids: null };
    const lk = new Lookups(index);
    const people = new Set(index.people.map((p) => p.Id));
    const sets = q.groups.map((g) => g.conds.map((c) => {
        const s = conditionSet(index, lk, c);
        // Relatives are found by link, so keep only people in this tree's list.
        return c.field === 'relationship' ? new Set([...s].filter((id) => people.has(id))) : s;
    }));
    const run = (skip: [number, number] | null) => combine(
        sets.map((g, gi) => ({ match: q.groups[gi].match, conds: g.filter((_, ci) => !skip || skip[0] !== gi || skip[1] !== ci) }))
            .filter((g) => g.conds.length > 0)
            .map((g) => combine(g.conds, g.match)),
        'any',
    );
    const all = run(null);
    const result: PeopleSearchResult = { ids: [...all] };
    if (explain && all.size === 0) {
        result.without = sets.flatMap((g, gi) => g.map((_, ci) => {
            // Without the only condition of the only group, everyone shows.
            const left = sets.reduce((n, gg, k) => n + gg.length - (k === gi ? 1 : 0), 0);
            return left === 0 ? people.size : run([gi, ci]).size;
        }));
    }
    return result;
}
