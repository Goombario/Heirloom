'use client';

import { useMemo } from 'react';
import { getDataClient } from '@/lib/data';
import { useCachedResource } from '@/app/components/useCachedResource';
import { EVENT_TYPES } from '@/lib/db/schema';
import { FAMILY_EVENT_TYPES } from '@/app/components/familyEventTypes';
import { customEventTypes } from '@/lib/events/custom-types';

export interface SearchLookups {
    sources: Array<{ id: number; title: string }>;
    cases: Array<{ id: number; title: string }>;
    /** Standard event types first, then the tree's own labels. */
    eventTypes: string[];
}

/**
 * The records advanced search's pickers choose from (#247): the tree's sources,
 * research cases and event types. Loaded only once something needs them: the panel
 * is open, or the query names a source or case.
 */
export function useSearchLookups(treeId: number | null, enabled: boolean): SearchLookups {
    const tree = treeId ?? 'default';
    const sources = useCachedResource(enabled ? `search:sources:tree=${tree}` : null, async () => (await (await getDataClient()).sources.list({ treeId })).sources);
    const cases = useCachedResource(enabled ? `search:cases:tree=${tree}` : null, async () => (await (await getDataClient()).cases.list({ treeId })).cases);
    const types = useCachedResource(enabled ? `search:event-types:tree=${tree}` : null, async () => (await getDataClient()).events.listTypeCounts(treeId));
    return useMemo(() => {
        const standard = [...Object.keys(EVENT_TYPES), 'MARR', ...FAMILY_EVENT_TYPES.map((f) => f.value)];
        return {
            sources: (sources.data ?? []).map((s) => ({ id: s.Id, title: s.Title?.trim() || '' })),
            cases: (cases.data ?? []).map((c) => ({ id: c.Id, title: c.Title })),
            eventTypes: [...new Set(standard), ...customEventTypes(types.data ?? []).map((c) => c.type).filter((x) => !standard.includes(x))],
        };
    }, [sources.data, cases.data, types.data]);
}
