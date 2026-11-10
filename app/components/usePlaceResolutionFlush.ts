'use client';

import { useCallback } from 'react';
import { getDataClient } from '@/lib/data';
import type { HierarchyLevel } from '@/lib/geocode/photon';

/**
 * Persist one pending place resolution AFTER its owning record has saved.
 *
 * `LocationField` never writes: it hands the containing form a pending resolution and
 * the form flushes it once its own save has succeeded (design spec §6.1). Every writer
 * of a place field therefore needs this same post-save step, and it had been copied
 * verbatim into the person form and the family form. The tree sidebar would have been
 * the third copy — so it lives here instead.
 *
 * The three-way distinction is the whole point and must not be collapsed:
 *
 * - `undefined` — nothing changed for this field (too-short input, geocoding disabled,
 *   a transient resolve failure). Writes NOTHING. It is not a removal.
 * - `null` — an explicit Remove pin. Writes a `PinSuppressed` suppression.
 * - a chain — a resolved hierarchy. Writes the whole chain.
 *
 * Best-effort by design: a failed place write never blocks or rolls back a save that
 * already succeeded (design spec §9 risk 5). Coordinates are a cache; the place string
 * the user typed is the user content, and that is already saved by the time this runs.
 *
 * `placeId` is the place the saved fact points at (#1186), from the save's response.
 * Two places may share a name, so the pin goes to that place, not to whichever place
 * the name means.
 */
export function usePlaceResolutionFlush(treeId: number | null) {
    return useCallback(async (fieldValue: string, resolution: HierarchyLevel[] | null | undefined, placeId?: number | null) => {
        if (resolution === undefined) return; // nothing changed for this field
        if (!fieldValue.trim()) return; // field is empty, nothing to persist
        try {
            const client = await getDataClient();
            if (resolution === null) {
                await client.places.geocodeUpsert({ name: fieldValue, placeId, latitude: null, longitude: null, pinSuppressed: true }, treeId);
            } else if (resolution.length > 0) {
                if (placeId != null) await client.places.geocodeUpsertHierarchy(resolution, treeId, { leafId: placeId });
                else await client.places.geocodeUpsertHierarchy(resolution, treeId);
            }
        } catch {
            // Non-fatal — see the doc comment above.
        }
    }, [treeId]);
}
