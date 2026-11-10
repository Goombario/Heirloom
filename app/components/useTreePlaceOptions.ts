'use client';

import { useCallback } from 'react';
import { getDataClient } from '@/lib/data';
import { buildPlaceOptions, type PlaceOption } from '@/lib/places/place-options';
import { useCachedResource } from './useCachedResource';

/** One request per tree while several place fields mount at once. */
const inflight = new Map<string, Promise<PlaceOption[]>>();

/**
 * The tree's places and their other names, for the place field's "In your tree"
 * list (#1186). Cached per tree; any write clears the cache, so a place added or
 * renamed elsewhere shows up the next time a field mounts. `enabled: false` waits
 * until the field is used.
 */
export function useTreePlaceOptions(treeId: number | null | undefined, enabled: boolean): PlaceOption[] | undefined {
    const key = enabled ? `place-options:${treeId ?? 'default'}` : null;
    const fetcher = useCallback(() => {
        const id = `place-options:${treeId ?? 'default'}`;
        let pending = inflight.get(id);
        if (!pending) {
            pending = getDataClient()
                .then((client) => client.places.list(treeId))
                .then(({ places, gazetteer }) => buildPlaceOptions(places, gazetteer))
                .finally(() => inflight.delete(id));
            inflight.set(id, pending);
        }
        return pending;
    }, [treeId]);
    return useCachedResource(key, fetcher).data;
}
