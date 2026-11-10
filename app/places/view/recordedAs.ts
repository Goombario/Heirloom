import type { PlaceDetail, PlaceFactLinkEntry } from '@/lib/data/types';

/**
 * A fact at this very place written under another of its names (#1185): the name
 * it was recorded as, or null. A fact at a place within it names that place
 * instead, which is not another spelling.
 */
export function recordedAs(fact: Pick<PlaceFactLinkEntry, 'placeId' | 'placeName'>, detail: Pick<PlaceDetail, 'id' | 'name'>): string | null {
    return detail.id != null && fact.placeId === detail.id && fact.placeName !== detail.name ? fact.placeName : null;
}

/** For each person born or died here, the other name their record says, if any. */
export function recordedAsByPerson(detail: Pick<PlaceDetail, 'id' | 'name' | 'factLinks'>): Map<number, string> {
    const byPerson = new Map<number, string>();
    for (const f of detail.factLinks) {
        if (f.kind !== 'birth' && f.kind !== 'death') continue;
        const as = recordedAs(f, detail);
        if (as && !byPerson.has(f.personId)) byPerson.set(f.personId, as);
    }
    return byPerson;
}
