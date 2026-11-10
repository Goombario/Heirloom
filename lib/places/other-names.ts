import type { PlaceGazetteerNode, PlaceOtherName, PlaceSummary } from '@/lib/data/types';

/*
 * A place's other names (#1185): how the page orders them and the checks the editor
 * runs before Save. The server runs the same checks; these let the editor say what
 * is wrong while typing and keep Save off until it is right.
 */

const fold = (s: string) => s.trim().toLocaleLowerCase();

/** The year a name's date mentions ("abt 1772" → 1772), for ordering. */
function yearOf(date: string | null | undefined): number | null {
    const m = date?.match(/(\d{3,4})(?!.*\d{3,4})/);
    return m ? Number(m[1]) : null;
}

/** Dated names by year (From, else Until), then undated names A to Z. */
export function sortOtherNames<T extends Pick<PlaceOtherName, 'name' | 'fromDate' | 'toDate'>>(names: readonly T[]): T[] {
    return [...names].sort((a, b) => {
        const ya = yearOf(a.fromDate) ?? yearOf(a.toDate);
        const yb = yearOf(b.fromDate) ?? yearOf(b.toDate);
        if (ya != null && yb != null && ya !== yb) return ya - yb;
        if (ya != null && yb == null) return -1;
        if (ya == null && yb != null) return 1;
        return a.name.localeCompare(b.name);
    });
}

/** What every other place in the tree is called, for the checks. */
export interface PlaceNameIndex {
    /** Another place's other name → that place's name. */
    otherNames: Map<string, { name: string; place: string }>;
    /** Another place's own name → its id and how many records it has. */
    places: Map<string, { id: number; name: string; records: number }>;
}

/** The name index for place `selfId`, from the places list. */
export function buildPlaceNameIndex(
    list: { places: PlaceSummary[]; gazetteer: PlaceGazetteerNode[] },
    selfId: number | null,
): PlaceNameIndex {
    const records = new Map<number, number>();
    for (const p of list.places) if (p.id != null) records.set(p.id, (records.get(p.id) ?? 0) + p.count);
    const index: PlaceNameIndex = { otherNames: new Map(), places: new Map() };
    for (const g of list.gazetteer) {
        if (g.id === selfId) continue;
        for (const n of g.otherNames ?? []) index.otherNames.set(fold(n), { name: n, place: g.name });
        // Of two same-name places, the one with more records is the one a name means.
        const key = fold(g.name), seen = index.places.get(key), count = records.get(g.id) ?? 0;
        if (!seen || count > seen.records) index.places.set(key, { id: g.id, name: g.name, records: count });
    }
    return index;
}

/**
 * Every other place's own name, for the rename field's suggestions and to tell a
 * merge from a rename. The gazetteer counts too: a place with no records of its
 * own (a county above towns) is still a place a rename merges into (#1232).
 */
export function mergeTargetNames(
    list: { places: PlaceSummary[]; gazetteer: PlaceGazetteerNode[] },
    placeName: string,
): string[] {
    const names = new Set<string>();
    for (const p of list.places) names.add(p.name);
    for (const g of list.gazetteer) names.add(g.name);
    names.delete(placeName);
    return [...names];
}

/** Why a name can't be another name of the place, as a message key and its values. */
export type OtherNameProblem =
    | { kind: 'blank' }
    | { kind: 'own' }
    | { kind: 'repeat'; name: string }
    | { kind: 'taken'; name: string; place: string }
    | { kind: 'merge'; name: string; id: number; records: number }
    | { kind: 'empty_place'; name: string };

/**
 * The check a new or changed name goes through, or null when it can be saved.
 * `others` are the place's other names besides this one. Matched without case.
 */
export function checkOtherName(raw: string, placeName: string, others: readonly string[], index: PlaceNameIndex | null): OtherNameProblem | null {
    const v = fold(raw);
    if (!v) return null;
    if (v === fold(placeName)) return { kind: 'own' };
    const dup = others.find((o) => fold(o) === v);
    if (dup) return { kind: 'repeat', name: dup.trim() };
    if (!index) return null;
    const taken = index.otherNames.get(v);
    if (taken) return { kind: 'taken', name: taken.name, place: taken.place };
    const place = index.places.get(v);
    if (place && place.records > 0) return { kind: 'merge', name: place.name, id: place.id, records: place.records };
    if (place) return { kind: 'empty_place', name: place.name };
    return null;
}

/** Same name, ignoring case and spaces at the ends. */
export const sameName = (a: string, b: string) => fold(a) === fold(b);
