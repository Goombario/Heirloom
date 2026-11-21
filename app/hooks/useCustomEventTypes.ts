'use client';

import { useEffect, useState } from 'react';
import { getDataClient } from '@/lib/data';
import { customEventTypes, type EventTypeCount } from '@/lib/events/custom-types';

/**
 * The custom event labels already used in the tree, most used first (#162). The
 * type pickers offer them as "Used in this tree", so a label is reused instead of
 * retyped. A failed read leaves the group out; the picker still works without it.
 */
export function useCustomEventTypes(treeId: number | null): EventTypeCount[] {
    const [types, setTypes] = useState<EventTypeCount[]>([]);
    useEffect(() => {
        let live = true;
        void (async () => {
            try {
                const client = await getDataClient();
                const counts = await client.events.listTypeCounts(treeId);
                if (live) setTypes(customEventTypes(counts));
            } catch {
                if (live) setTypes([]);
            }
        })();
        return () => { live = false; };
    }, [treeId]);
    return types;
}
