// How a caller names a gazetteer place (#1186): by its id, which is exact, or by
// a name it is called, which the server resolves the way a typed place is matched
// (its own name, then its other names).

export type PlaceKey = number | string;

/**
 * The key a batched lookup (coords, pin chains) reports a place under: an id as
 * `#12`, a name as itself. Callers index the result with the same function.
 */
export function placeKeyString(key: PlaceKey): string {
    return typeof key === 'number' ? `#${key}` : key;
}

/** The place page for a place: by id when known, else by name. */
export function placeHref(place: { id?: number | null; name: string }): string {
    return place.id != null
        ? `/places/view?id=${place.id}`
        : `/places/view?name=${encodeURIComponent(place.name)}`;
}

/**
 * A fact's place as a lookup key: its place id when it has one, since two places
 * may share a name, else its text. Null for a fact with no place.
 */
export function factPlaceKey(place: string | null | undefined, placeId?: number | null): PlaceKey | null {
    if (!place) return null;
    return placeId ?? place;
}

/** A fact's entry in a batched lookup asked for with `factPlaceKey`. */
export function factPlaceEntry<T>(map: Record<string, T>, place: string | null | undefined, placeId?: number | null): T | undefined {
    const key = factPlaceKey(place, placeId);
    return key == null ? undefined : map[placeKeyString(key)];
}

/** The distinct keys among `keys`, dropping nulls. */
export function uniquePlaceKeys(keys: Array<PlaceKey | null>): PlaceKey[] {
    const byString = new Map<string, PlaceKey>();
    for (const key of keys) if (key != null) byString.set(placeKeyString(key), key);
    return [...byString.values()];
}
