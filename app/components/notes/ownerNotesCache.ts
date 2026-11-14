'use client';

import type { Note } from '@/lib/data/types';
import type { LinkOwnerTable } from '@/lib/db/fact-tables';
import { getDataClient } from '@/lib/data';
import { dataCache } from '@/lib/data/cache';
import { sharedLoad } from '@/lib/data/shared-load';

const scope = (treeId: number | null) => treeId ?? 'default';

/** The cache key of one record's notes (#65). Any write clears the cache. */
export const notesKey = (treeId: number | null, table: LinkOwnerTable, id: string | number) => `notes:${table}:${scope(treeId)}:${id}`;

/** One record's notes, cached, and shared with any load of them already running. */
export function loadOwnerNotes(table: LinkOwnerTable, id: number, treeId: number | null): Promise<Note[]> {
    const key = notesKey(treeId, table, id);
    return sharedLoad(key, async () => {
        const client = await getDataClient();
        const notes = await client.notes.listForOwner(table, id, treeId);
        dataCache.set(key, notes);
        return notes;
    });
}
