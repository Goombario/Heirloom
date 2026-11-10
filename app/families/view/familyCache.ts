'use client';

/**
 * Shared cache keys + loaders for the family-detail page (its three resources),
 * plus an intent-driven prefetch. `useFamilyDetail` reads/writes through these, so
 * a prefetch warms the exact same `dataCache` entries the detail page reads
 * synchronously — a prefetched family then paints with no skeleton and no blank.
 *
 * Mirrors `app/people/view/personCache.ts` (see PR #203). Keys are tree+id scoped (null treeId = default tree).
 * Any write clears the whole cache (withCacheInvalidation), so these always miss
 * and re-fetch fresh right after an edit — no stale family shown.
 */
import type { SpouseRelation } from '@/lib/db/schema';
import type { FamilyWithSpouseNames } from '@/lib/db/queries/families';
import { getDataClient } from '@/lib/data';
import { dataCache } from '@/lib/data/cache';
import type { FamilyDetailsResponse, PartnerFamilies, CitationMap } from './useFamilyDetail';

// null treeId = the current user's default tree — a legit, stable scope of its own.
const scope = (treeId: number | null) => treeId ?? 'default';
export const familyKey = (treeId: number | null, id: string | number) => `families:get:${scope(treeId)}:${id}`;
export const partnerFamiliesKey = (treeId: number | null, personId: string | number) => `families:partner:${scope(treeId)}:${personId}`;
export const familyCitationsKey = (treeId: number | null, id: string | number) => `families:citations:${scope(treeId)}:${id}`;
/** Lightweight partnership summary (from the families list) for an instant hero paint. */
const familySummaryKey = (treeId: number | null, id: string | number) => `families:summary:${scope(treeId)}:${id}`;

/** The identity summary the detail hero paints instantly. Superset of what it needs. */
export type FamilySummary = FamilyWithSpouseNames;

/**
 * Index families-list rows we already fetched as per-family partnership summaries,
 * so an un-prefetched jump to a family paints the hero (both partner names/avatars,
 * marriage line) immediately instead of a blank while `families.get` (~200ms)
 * resolves. Cheap — just stores references we already hold.
 */
export function cacheFamilySummaries(rows: FamilySummary[], treeId: number | null): void {
    for (const row of rows) dataCache.set(familySummaryKey(treeId, row.Id), row);
}

/** Synchronous read of a family's cached partnership summary (or null). */
export function getFamilySummary(id: string | number, treeId: number | null): FamilySummary | null {
    if (!id) return null;
    return dataCache.get<FamilySummary>(familySummaryKey(treeId, id)) ?? null;
}

export async function loadFamily(id: number, treeId: number | null): Promise<FamilyDetailsResponse> {
    const client = await getDataClient();
    const data = await client.families.get(id, treeId) as unknown as FamilyDetailsResponse;
    dataCache.set(familyKey(treeId, id), data);
    return data;
}

/**
 * A partner rail is optional. Preserve the successful shape for callers while
 * carrying a failure separately, so `spouses: []` cannot be mistaken for a
 * confirmed empty result. The detail caller decides whether/how to show it.
 */
export type PartnerFamiliesResult = PartnerFamilies & { error?: unknown };

export async function loadPartnerFamilies(personId: number, treeId: number | null): Promise<PartnerFamiliesResult> {
    try {
        const client = await getDataClient();
        const p = await client.people.get(personId, treeId);
        const value: PartnerFamilies = {
            person: p ?? null,
            spouses: (p?.spouses as SpouseRelation[] | undefined) ?? [],
        };
        dataCache.set(partnerFamiliesKey(treeId, personId), value);
        return value;
    } catch (e) {
        // The caller owns authentication and presentation semantics. Carry the
        // rejection separately so a failed read cannot masquerade as zero spouses.
        return { person: null, spouses: [], error: e };
    }
}

export async function loadFamilyCitations(id: number, treeId: number | null): Promise<CitationMap> {
    const client = await getDataClient();
    const value = await client.citations.listForFamily(id, treeId);
    dataCache.set(familyCitationsKey(treeId, id), value);
    return value;
}

// Dedupe concurrent prefetches of the same family — hover/focus fire repeatedly.
const inFlight = new Set<string>();

/**
 * Warm the family-detail caches for a family ahead of navigation (hover / focus).
 * No-op when the family record is already cached or a prefetch is already in flight.
 * Loads the family record first (to learn the partner ids), then warms both
 * partners' families and the family citations in parallel. Fire-and-forget: a
 * failed prefetch is swallowed and the detail page just loads normally.
 */
export function prefetchFamily(id: number | null | undefined, treeId?: number | null): void {
    if (!id) return;
    const tid = treeId ?? null;
    const key = familyKey(tid, id);
    if (dataCache.has(key) || inFlight.has(key)) return;
    inFlight.add(key);
    void (async () => {
        try {
            const data = await loadFamily(id, tid);
            await Promise.allSettled([
                data.family.Partner1Id ? loadPartnerFamilies(data.family.Partner1Id, tid) : Promise.resolve(),
                data.family.Partner2Id ? loadPartnerFamilies(data.family.Partner2Id, tid) : Promise.resolve(),
                loadFamilyCitations(id, tid),
            ]);
        } catch {
            /* fire-and-forget — detail page loads normally on a cold miss */
        } finally {
            inFlight.delete(key);
        }
    })();
}
