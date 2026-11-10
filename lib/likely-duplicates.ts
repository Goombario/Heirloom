import { foldForSearch } from '@/lib/utils/search-fold';

/**
 * Likely duplicate people (#794, retuned in #822). Pure: the query layer
 * loads the candidates, this pairs them.
 *
 * Two people are a likely pair when they share a folded surname and a folded
 * given name (or given names one edit apart, when both are at least four
 * letters and the sexes don't conflict), and:
 *   - both birth years are known and within two years, and they don't each
 *     have known parents with no parent in common; or
 *   - a birth year is unknown, and they share a parent or a partner, or one of
 *     them has no family links at all. An unknown year never matches alone.
 * Someone is never paired with their own parent, child or partner, so a father
 * and son who share a name are not a pair, whatever their years.
 */
export interface DuplicateCandidate {
    Id: number;
    FirstName: string | null;
    LastName: string | null;
    Sex: string | null;
    /** "SortableYear" of the birth date, or null when unknown. */
    year: number | null;
    /** Parent person ids, from every family the person is a child of. */
    parents: number[];
    /** Partner person ids, from every family the person is a partner in. */
    partners: number[];
    /** Whether the person is in any family, as a child or a partner. */
    linked: boolean;
}

export interface LikelyDuplicates {
    /** Each pair once, lower id first. */
    pairs: [number, number][];
    /**
     * People joined by pairs, one group per run of matches, each ordered by
     * birth year (unknown last). Groups are ordered by surname, given name,
     * then earliest year, so a review list shows each match beside its pair.
     */
    groups: number[][];
}

const YEAR_WINDOW = 2;
const FUZZY_MIN_LENGTH = 4;

interface Entry extends DuplicateCandidate {
    given: string;
    surname: string;
    parentSet: Set<number>;
    partnerSet: Set<number>;
}

const fold = (s: string | null) => foldForSearch(s ?? '').trim().replace(/\s+/g, ' ');

/** True when a and b are equal or one insertion, deletion, substitution or adjacent swap apart. */
function withinOneEdit(a: string, b: string): boolean {
    if (a === b) return true;
    const la = a.length;
    const lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0;
    while (i < la && i < lb && a[i] === b[i]) i++;
    if (la === lb) {
        if (a.slice(i + 1) === b.slice(i + 1)) return true;
        return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
    }
    return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

function givenMatch(a: Entry, b: Entry): boolean {
    if (a.given === b.given) return true;
    if (a.given.length < FUZZY_MIN_LENGTH || b.given.length < FUZZY_MIN_LENGTH) return false;
    const sa = a.Sex?.toUpperCase();
    const sb = b.Sex?.toUpperCase();
    // One letter apart across sexes is often a different name (Aurèle, Aurélie).
    if ((sa === 'M' || sa === 'F') && (sb === 'M' || sb === 'F') && sa !== sb) return false;
    return withinOneEdit(a.given, b.given);
}

const shares = (x: Set<number>, y: Set<number>) => {
    for (const v of x) if (y.has(v)) return true;
    return false;
};

function familyAllows(a: Entry, b: Entry): boolean {
    // Never a person and their own parent, child or partner.
    if (a.parentSet.has(b.Id) || b.parentSet.has(a.Id) || a.partnerSet.has(b.Id)) return false;
    if (a.year !== null && b.year !== null) {
        // Different, known parents: cousins named for a shared grandparent.
        return a.parentSet.size === 0 || b.parentSet.size === 0 || shares(a.parentSet, b.parentSet);
    }
    return !a.linked || !b.linked || shares(a.parentSet, b.parentSet) || shares(a.partnerSet, b.partnerSet);
}

export function findLikelyDuplicates(candidates: DuplicateCandidate[]): LikelyDuplicates {
    const bySurname = new Map<string, Entry[]>();
    for (const c of candidates) {
        const given = fold(c.FirstName);
        const surname = fold(c.LastName);
        // Both halves are required: a bare "Smith" is a placeholder, not a match.
        if (!given || !surname) continue;
        const entry: Entry = { ...c, given, surname, parentSet: new Set(c.parents), partnerSet: new Set(c.partners) };
        const list = bySurname.get(surname);
        if (list) list.push(entry);
        else bySurname.set(surname, [entry]);
    }

    const pairs: [number, number][] = [];
    const entries = new Map<number, Entry>();
    const consider = (a: Entry, b: Entry) => {
        if (givenMatch(a, b) && familyAllows(a, b)) pairs.push(a.Id < b.Id ? [a.Id, b.Id] : [b.Id, a.Id]);
    };
    for (const list of bySurname.values()) {
        if (list.length < 2) continue;
        for (const e of list) entries.set(e.Id, e);
        const dated = list.filter(e => e.year !== null).sort((a, b) => a.year! - b.year! || a.Id - b.Id);
        const undated = list.filter(e => e.year === null);
        // Known years: a sliding window, so a big surname stays cheap.
        for (let i = 0; i < dated.length; i++) {
            for (let j = i + 1; j < dated.length && dated[j].year! - dated[i].year! <= YEAR_WINDOW; j++) {
                consider(dated[i], dated[j]);
            }
        }
        // Unknown years can match anyone with the name, so family context decides.
        for (let i = 0; i < undated.length; i++) {
            for (let j = i + 1; j < undated.length; j++) consider(undated[i], undated[j]);
            for (const d of dated) consider(undated[i], d);
        }
    }

    // Union-find over the pairs, so each run of matches lists together.
    const root = new Map<number, number>();
    const find = (x: number): number => {
        let r = x;
        while (root.get(r) !== r) r = root.get(r)!;
        while (x !== r) { const next = root.get(x)!; root.set(x, r); x = next; }
        return r;
    };
    for (const [a, b] of pairs) {
        if (!root.has(a)) root.set(a, a);
        if (!root.has(b)) root.set(b, b);
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) root.set(Math.max(ra, rb), Math.min(ra, rb));
    }
    const members = new Map<number, Entry[]>();
    for (const id of root.keys()) {
        const r = find(id);
        const list = members.get(r);
        if (list) list.push(entries.get(id)!);
        else members.set(r, [entries.get(id)!]);
    }
    const byYear = (a: Entry, b: Entry) => {
        if (a.year !== b.year) return a.year === null ? 1 : b.year === null ? -1 : a.year - b.year;
        return a.Id - b.Id;
    };
    const groups = [...members.values()].map(g => g.sort(byYear));
    groups.sort((a, b) => a[0].surname.localeCompare(b[0].surname) || a[0].given.localeCompare(b[0].given) || byYear(a[0], b[0]));

    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return { pairs, groups: groups.map(g => g.map(e => e.Id)) };
}
