import type { Audited, PlacesClient, PlaceSummary, PlaceDetail, ResolvedPlace, PlaceCoords, PinChainRow, PlaceGazetteerNode, PlaceMovedRecord, PlaceOtherNameDraft, PlaceRenameOptions } from '../types';
import { ensureAuditIds, throwForStatus, treeQuery } from './shared';
import type { PlaceKey } from '@/lib/places/place-key';

/** A place key as the `name` / `id` query parameter the place routes read. */
function placeParams(place: PlaceKey, treeId?: number | null): URLSearchParams {
  const params = new URLSearchParams(typeof place === 'number' ? { id: String(place) } : { name: place });
  if (treeId != null) params.set('treeId', String(treeId));
  return params;
}

/** Split place keys into the `names` and `ids` a batched lookup takes. */
function placeBatch(places: PlaceKey[]): { names: string[]; ids: number[] } {
  return {
    names: places.filter((p): p is string => typeof p === 'string'),
    ids: places.filter((p): p is number => typeof p === 'number'),
  };
}

export class HttpPlacesClient implements PlacesClient {
  async list(treeId?: number | null): Promise<{ places: PlaceSummary[]; count: number; gazetteer: PlaceGazetteerNode[] }> {
    const res = await fetch(`/api/places${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as { places: PlaceSummary[]; count: number; gazetteer: PlaceGazetteerNode[] };
  }

  async detail(place: PlaceKey, treeId?: number | null): Promise<PlaceDetail> {
    const res = await fetch(`/api/places/detail?${placeParams(place, treeId).toString()}`);
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as PlaceDetail;
  }

  async coords(places: PlaceKey[], treeId?: number | null): Promise<PlaceCoords> {
    if (places.length === 0) return {};
    const res = await fetch(`/api/places/coords${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(placeBatch(places)),
    });
    if (!res.ok) await throwForStatus(res);
    const data = (await res.json()) as { coords: PlaceCoords };
    return data.coords ?? {};
  }

  async pinChains(places: PlaceKey[], treeId?: number | null): Promise<Record<string, PinChainRow[]>> {
    if (places.length === 0) return {};
    const res = await fetch(`/api/places/pin-chains${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(placeBatch(places)),
    });
    if (!res.ok) await throwForStatus(res);
    const data = (await res.json()) as { chains: Record<string, PinChainRow[]> };
    return data.chains ?? {};
  }

  async geocodeUpsert(place: ResolvedPlace, treeId?: number | null): Promise<void> {
    const res = await fetch(`/api/places/geocode${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(place),
    });
    if (!res.ok) await throwForStatus(res);
  }

  async updateCoordinates(place: PlaceKey, latitude: number, longitude: number, treeId?: number | null): Promise<Audited> {
    const res = await fetch(`/api/places/coordinates${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(typeof place === 'number' ? { placeId: place } : { name: place }), latitude, longitude }),
    });
    if (!res.ok) await throwForStatus(res);
    return { auditIds: ((await res.json()) as { auditIds?: number[] }).auditIds ?? [] };
  }

  async geocodeUpsertHierarchy(levels: { name: string; latitude?: number | null; longitude?: number | null; displayName?: string | null; osmType?: 'node' | 'way' | 'relation' | null; osmId?: number | null }[], treeId?: number | null, options?: { reparent?: boolean; leafId?: number | null }): Promise<Audited> {
    const res = await fetch(`/api/places/geocode-hierarchy${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ levels, reparent: options?.reparent ?? false, ...(options?.leafId != null ? { leafId: options.leafId } : {}) }),
    });
    if (!res.ok) await throwForStatus(res);
    return { auditIds: ((await res.json()) as { auditIds?: number[] }).auditIds ?? [] };
  }

  async dependentCount(place: PlaceKey, treeId?: number | null): Promise<number> {
    const res = await fetch(`/api/places/geocode/dependents?${placeParams(place, treeId).toString()}`);
    if (!res.ok) await throwForStatus(res);
    const data = (await res.json()) as { count: number };
    return data.count;
  }

  async rename(from: PlaceKey, to: string, treeId?: number | null, options?: PlaceRenameOptions): Promise<Audited<{ renamed: number; wasMerge: boolean; to: string }>> {
    const res = await fetch(`/api/places/rename${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(typeof from === 'number' ? { fromId: from } : { from }), to, ...options }),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds((await res.json()) as { renamed: number; wasMerge: boolean; to: string });
  }

  async saveOtherNames(placeId: number, names: PlaceOtherNameDraft[], treeId?: number | null): Promise<Audited<{ added: number; changed: number; removed: number }>> {
    const res = await fetch(`/api/places/names${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId, names }),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds((await res.json()) as { added: number; changed: number; removed: number });
  }

  async moveRecords(fromId: number, toId: number, records?: PlaceMovedRecord[], treeId?: number | null): Promise<Audited<{ moved: number }>> {
    const res = await fetch(`/api/places/move${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromId, toId, ...(records ? { records } : {}) }),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds((await res.json()) as { moved: number });
  }

  async remove(placeId: number, treeId?: number | null): Promise<Audited<{ deleted: true }>> {
    const params = new URLSearchParams({ id: String(placeId) });
    if (treeId != null) params.set('treeId', String(treeId));
    const res = await fetch(`/api/places/detail?${params.toString()}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds((await res.json()) as { deleted: true });
  }
}
