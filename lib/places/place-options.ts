import type { PlaceGazetteerNode, PlaceSummary } from '@/lib/data/types';
import { foldForSearch } from '@/lib/utils/search-fold';

/**
 * The place field's "In your tree" list (#1186): the tree's places and their other
 * names, as a typed place is matched. Pure, so the matching rules are tested without
 * a render.
 */

/** One row the place field can offer: a place, or another name of one. */
export interface PlaceOption {
    placeId: number;
    /** What the record will say: the place's name, or the other name. */
    text: string;
    /** The place's own name. Differs from `text` for another name. */
    placeName: string;
    /** The place it is part of, to tell same-name places apart. */
    parentName: string | null;
    /** The map's name for it, when there is no parent to name. */
    displayName: string | null;
    /** Records that point at the place. */
    count: number;
    /** The place has coordinates of its own. */
    pinned: boolean;
    isOtherName: boolean;
}

/** Every place and other name in a tree, from the places list. */
export function buildPlaceOptions(places: readonly PlaceSummary[], gazetteer: readonly PlaceGazetteerNode[]): PlaceOption[] {
    const counts = new Map<number, number>();
    for (const p of places) if (p.id != null) counts.set(p.id, p.count);
    const names = new Map(gazetteer.map((g) => [g.id, g.name]));
    const options: PlaceOption[] = [];
    for (const g of gazetteer) {
        const base = {
            placeId: g.id,
            placeName: g.name,
            parentName: g.parentId != null ? names.get(g.parentId) ?? null : null,
            displayName: g.displayName,
            count: counts.get(g.id) ?? 0,
            pinned: g.latitude != null && g.longitude != null,
        };
        options.push({ ...base, text: g.name, isOtherName: false });
        for (const other of g.otherNames ?? []) options.push({ ...base, text: other, isOtherName: true });
    }
    return options;
}

/** Most records first, then the older place, as "PlaceIdByName" picks. */
function byUse(a: PlaceOption, b: PlaceOption): number {
    return b.count - a.count || a.placeId - b.placeId;
}

/** Edit distance, for close spellings ("Lvov" for "Lviv"). */
function distance(a: string, b: string): number {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) {
            row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = row;
    }
    return prev[b.length];
}

/** Spellings this far apart still count as close. */
const CLOSE_SPELLING = 2;

/** A matched row; `close` when only its spelling is near the typed text. */
export interface PlaceMatch extends PlaceOption {
    close: boolean;
}

/**
 * The rows for typed text: names containing it (accents and case aside), exact
 * matches first, then the most-used. With none, the close spellings of the first
 * part (one or two letters off). With no text, the tree's most-used places.
 */
export function matchPlaceOptions(options: readonly PlaceOption[], typed: string, limit = 8): PlaceMatch[] {
    const q = foldForSearch(typed.trim());
    if (!q) return options.filter((o) => !o.isOtherName).sort(byUse).slice(0, limit).map((o) => ({ ...o, close: false }));
    const contains = options.filter((o) => foldForSearch(o.text).includes(q));
    if (contains.length > 0) {
        const exact = (o: PlaceOption) => Number(foldForSearch(o.text) === q);
        return contains.sort((a, b) => exact(b) - exact(a) || byUse(a, b)).slice(0, limit).map((o) => ({ ...o, close: false }));
    }
    if (q.length < 3) return [];
    const head = (s: string) => foldForSearch(s.split(',')[0] ?? s).trim();
    const typedHead = head(typed);
    return options
        .filter((o) => {
            // The same first part is not a spelling ("Paris" for "Paris, Texas").
            const d = distance(head(o.text), typedHead);
            return d > 0 && d <= CLOSE_SPELLING;
        })
        .sort(byUse)
        .slice(0, limit)
        .map((o) => ({ ...o, close: true }));
}

/**
 * What text the user left in the field links to, as the server will link it: the
 * most-used place of exactly that name, else the place it is exactly another name
 * of, else nothing (a new place).
 */
export function settlePlaceText(options: readonly PlaceOption[], typed: string): PlaceOption | null {
    const text = typed.trim();
    if (!text) return null;
    const own = options.filter((o) => !o.isOtherName && o.text === text).sort(byUse)[0];
    return own ?? options.find((o) => o.isOtherName && o.text === text) ?? null;
}

/** How many places share `option`'s own name; above one, the field offers "Not this …?". */
export function sameNamePlaces(options: readonly PlaceOption[], option: PlaceOption): number {
    return options.filter((o) => !o.isOtherName && o.placeName === option.placeName).length;
}
