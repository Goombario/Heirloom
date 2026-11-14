'use client';

/**
 * Shared cache keys + loaders for the person-detail profile (its four resources),
 * plus an intent-driven prefetch. `usePersonDetail` reads/writes through these, so
 * a prefetch warms the exact same `dataCache` entries the detail page reads
 * synchronously — a prefetched person then paints with no skeleton and no blank.
 *
 * Keys are tree+id scoped (null treeId = default tree). Any write clears the whole cache (withCacheInvalidation),
 * so these always miss and re-fetch fresh right after an edit — no stale profile.
 */
import type { PersonWithRelations, PersonGalleryMedia } from '@/lib/db/schema';
import type { PersonWithParentFamily } from '@/lib/db/queries/people';
import type { Citation, Note } from '@/lib/data/types';
import { getDataClient } from '@/lib/data';
import { dataCache } from '@/lib/data/cache';
import { type NameVariant } from '@/app/components/person-form/NamesPanel';

// null treeId = the current user's default tree — a legit, stable scope of its own.
const scope = (treeId: number | null) => treeId ?? 'default';
export const personKey = (treeId: number | null, id: string | number) => `people:get:${scope(treeId)}:${id}`;
export const mediaKey = (treeId: number | null, id: string | number) => `people:media:${scope(treeId)}:${id}`;
export const citationsKey = (treeId: number | null, id: string | number) => `people:citations:${scope(treeId)}:${id}`;
export const variantsKey = (treeId: number | null, id: string | number) => `people:variants:${scope(treeId)}:${id}`;
/** Notes on a person (`People`) or on one of their events (`Events`), for the desktop Notes section (#65). */
export const notesKey = (treeId: number | null, table: 'People' | 'Events', id: string | number) => `notes:${table}:${scope(treeId)}:${id}`;
/** Lightweight identity summary (from the list/tree) for an instant hero paint (#2). */
const personSummaryKey = (treeId: number | null, id: string | number) => `people:summary:${scope(treeId)}:${id}`;

export type PersonCitationMap = Record<string, Citation[]>;

/** The identity summary the detail hero paints instantly (#2). Superset of what it needs. */
export type PersonSummary = PersonWithParentFamily;

/**
 * Index list/tree rows we already fetched as per-person identity summaries, so an
 * un-prefetched jump to a person paints the hero (name/dates/photo) immediately
 * instead of a blank while the full `people.get` (~200ms) resolves. Cheap — just
 * stores references we already hold.
 */
export function cachePersonSummaries(rows: PersonSummary[], treeId: number | null): void {
    for (const row of rows) dataCache.set(personSummaryKey(treeId, row.Id), row);
}

/** Synchronous read of a person's cached identity summary (or null). */
export function getPersonSummary(id: string | number, treeId: number | null): PersonSummary | null {
    if (!id) return null;
    return dataCache.get<PersonSummary>(personSummaryKey(treeId, id)) ?? null;
}

// One request per resource at a time: a page that mounts while a hover prefetch
// of the same person is still running joins it instead of asking again (#65).
const pending = new Map<string, Promise<unknown>>();
// Keyed by cache generation too: a load that started before a write is never
// joined after it, and none is shared while a write is still running.
function shared<T>(cacheKey: string, load: () => Promise<T>): Promise<T> {
    if (dataCache.writing()) return load();
    const key = `${dataCache.generation()}:${cacheKey}`;
    const running = pending.get(key) as Promise<T> | undefined;
    if (running) return running;
    const promise = load().finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
}

export async function loadPerson(id: number, treeId: number | null): Promise<PersonWithRelations> {
    return shared(personKey(treeId, id), async () => {
        const client = await getDataClient();
        const person = await client.people.get(id, treeId);
        dataCache.set(personKey(treeId, id), person);
        return person;
    });
}

export async function loadPersonMedia(id: number, treeId: number | null): Promise<PersonGalleryMedia[]> {
    return shared(mediaKey(treeId, id), async () => {
        const client = await getDataClient();
        const { media } = await client.media.list<PersonGalleryMedia>({ personId: id, treeId, includeTagged: true });
        dataCache.set(mediaKey(treeId, id), media);
        return media;
    });
}

export async function loadPersonCitations(id: number, treeId: number | null): Promise<PersonCitationMap> {
    return shared(citationsKey(treeId, id), async () => {
        const client = await getDataClient();
        const citationMap = await client.citations.listForPerson(id, treeId);
        const value = citationMap ?? {};
        dataCache.set(citationsKey(treeId, id), value);
        return value;
    });
}

export async function loadPersonVariants(id: number, treeId: number | null): Promise<NameVariant[]> {
    return shared(variantsKey(treeId, id), async () => {
        const client = await getDataClient();
        const variants = await client.people.listNameVariants(id, treeId);
        const mapped = variants.map(v => ({ ...v, Type: v.Type as NameVariant['Type'], IsPrimary: v.IsPrimary ? 1 : 0 }));
        dataCache.set(variantsKey(treeId, id), mapped);
        return mapped;
    });
}

export async function loadOwnerNotes(table: 'People' | 'Events', id: number, treeId: number | null): Promise<Note[]> {
    return shared(notesKey(treeId, table, id), async () => {
        const client = await getDataClient();
        const notes = await client.notes.listForOwner(table, id, treeId) as Note[];
        dataCache.set(notesKey(treeId, table, id), notes);
        return notes;
    });
}

/** A person's notes and their events' notes, warmed once the person record names the events. */
async function loadPersonNotes(person: PersonWithRelations, treeId: number | null): Promise<void> {
    const events = (person.events ?? []).filter((e) => (e.noteCount ?? 0) > 0);
    await Promise.allSettled([
        loadOwnerNotes('People', person.Id, treeId),
        ...events.map((e) => loadOwnerNotes('Events', e.Id, treeId)),
    ]);
}

// Dedupe concurrent prefetches of the same person — hover/focus fire repeatedly.
const inFlight = new Set<string>();

/**
 * Warm the four profile caches, and the notes the desktop page lists, for a person ahead of navigation (hover / focus /
 * idle). No-op when the person record is already cached or a prefetch is already
 * in flight. Fire-and-forget: a failed prefetch is swallowed and the detail page
 * just loads normally.
 */
export function prefetchPerson(id: number | null | undefined, treeId?: number | null): void {
    if (!id) return;
    const tid = treeId ?? null;
    const key = personKey(tid, id);
    if (dataCache.has(key) || inFlight.has(key)) return;
    inFlight.add(key);
    void Promise.allSettled([
        loadPerson(id, tid).then((person) => loadPersonNotes(person, tid)),
        loadPersonMedia(id, tid),
        loadPersonCitations(id, tid),
        loadPersonVariants(id, tid),
    ]).finally(() => inFlight.delete(key));
}
