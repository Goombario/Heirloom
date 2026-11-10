import type { PlaceDetail } from '@/lib/data/types';

/**
 * A place exists when it has a gazetteer row or any fact names it. Anything
 * else is a URL for a place that isn't in the tree: the detail page renders
 * RecordNotFound instead of an editable blank that a save would create (#697).
 */
export function isMissingPlace(placeName: string, detail: PlaceDetail): boolean {
    if (!placeName.trim()) return true;
    return detail.id == null
        && detail.people.length === 0
        && detail.factLinks.length === 0
        && detail.eventCount === 0
        && detail.familyCount === 0;
}
