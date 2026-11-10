import { useCallback } from 'react';
import { useTree } from '@/app/contexts/TreeContext';
import { getDataClient } from '@/lib/data';
import { dataCache } from '@/lib/data/cache';
import type { PlaceDetail } from '@/lib/data/types';
import { placeKeyString, type PlaceKey } from '@/lib/places/place-key';

/** Tree-scoped place-detail cache key — the single source of truth (shared with PlaceDetailView). */
export const placeDetailKey = (treeId: number | null, place: PlaceKey) => `places:detail:${treeId ?? 'default'}:${placeKeyString(place)}`;

const inFlight = new Set<string>();

/** Best-effort: warm the SWR dataCache with a place's detail so a click paints instantly. */
export async function prefetchPlaceDetail(place: PlaceKey, treeId?: number | null): Promise<void> {
  if (place === '') return;
  const tid = treeId ?? null;
  const key = placeDetailKey(tid, place);
  if (dataCache.get<PlaceDetail>(key) || inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const client = await getDataClient();
    const data = await client.places.detail(place, tid);
    dataCache.set(key, data);
  } catch {
    /* prefetch is best-effort — a failure just means the click does a normal fetch */
  } finally {
    inFlight.delete(key);
  }
}

export function usePrefetchPlaceDetail() {
  const { activeTreeId } = useTree();
  return useCallback((place: PlaceKey) => { void prefetchPlaceDetail(place, activeTreeId); }, [activeTreeId]);
}
