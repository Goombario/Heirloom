import type { Audited, PlacesClient, PlaceSummary, PlaceDetail, ResolvedPlace, PlaceCoords, PinChainRow, PlaceGazetteerNode, PlaceMovedRecord, PlaceOtherNameDraft, PlaceRenameOptions } from '../types';
import {
  listPlacesService, getPlaceDetailService, getPlaceCoordsService, upsertPlaceGeocodeService,
  updatePlaceCoordinatesService,
  upsertPlaceHierarchyService, getPlaceDependentCountService, movePlaceRecordsService, deletePlaceService, renamePlaceService, savePlaceNamesService,
  getPlacePinChainsService,
  type HierarchyLevelInput,
} from '@/lib/services/places';
import { ensureLocalUser } from '../local-user';
import type { PlaceKey } from '@/lib/places/place-key';

/** A place key as the service's `name` or `placeId` parameter. */
const byKey = (place: PlaceKey) => (typeof place === 'number' ? { placeId: place } : { name: place });

const batch = (places: PlaceKey[]) => ({
  names: places.filter((p): p is string => typeof p === 'string'),
  ids: places.filter((p): p is number => typeof p === 'number'),
});

/**
 * Places methods backed by in-browser PGlite.
 * Tree scope passes through as `requestedTreeId` (the local build is multi-tree);
 * `requestedOwnerId` stays null (sharing is a hosted-only concept).
 */
export class LocalPlacesClient implements PlacesClient {
  async list(treeId?: number | null): Promise<{ places: PlaceSummary[]; count: number; gazetteer: PlaceGazetteerNode[] }> {
    const currentUserId = await ensureLocalUser();
    return listPlacesService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async detail(place: PlaceKey, treeId?: number | null): Promise<PlaceDetail> {
    const currentUserId = await ensureLocalUser();
    return getPlaceDetailService({ ...(typeof place === 'number' ? { id: place } : { name: place }), requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async coords(places: PlaceKey[], treeId?: number | null): Promise<PlaceCoords> {
    const currentUserId = await ensureLocalUser();
    return getPlaceCoordsService({ ...batch(places), requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async pinChains(places: PlaceKey[], treeId?: number | null): Promise<Record<string, PinChainRow[]>> {
    const currentUserId = await ensureLocalUser();
    return getPlacePinChainsService({ ...batch(places), requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async geocodeUpsert(place: ResolvedPlace, treeId?: number | null): Promise<void> {
    const currentUserId = await ensureLocalUser();
    return upsertPlaceGeocodeService({ ...place, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async updateCoordinates(place: PlaceKey, latitude: number, longitude: number, treeId?: number | null): Promise<void> {
    const currentUserId = await ensureLocalUser();
    return updatePlaceCoordinatesService({ ...byKey(place), latitude, longitude, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async geocodeUpsertHierarchy(levels: HierarchyLevelInput[], treeId?: number | null, options?: { reparent?: boolean; leafId?: number | null }): Promise<void> {
    const currentUserId = await ensureLocalUser();
    return upsertPlaceHierarchyService({ levels, reparent: options?.reparent, leafId: options?.leafId, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async dependentCount(place: PlaceKey, treeId?: number | null): Promise<number> {
    const currentUserId = await ensureLocalUser();
    return getPlaceDependentCountService({ ...byKey(place), requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async rename(from: PlaceKey, to: string, treeId?: number | null, options?: PlaceRenameOptions): Promise<Audited<{ renamed: number; wasMerge: boolean; to: string }>> {
    const currentUserId = await ensureLocalUser();
    return renamePlaceService({ ...(typeof from === 'number' ? { fromId: from } : { from }), to, ...options, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async saveOtherNames(placeId: number, names: PlaceOtherNameDraft[], treeId?: number | null): Promise<Audited<{ added: number; changed: number; removed: number }>> {
    const currentUserId = await ensureLocalUser();
    return savePlaceNamesService({ placeId, names, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async moveRecords(fromId: number, toId: number, records?: PlaceMovedRecord[], treeId?: number | null): Promise<Audited<{ moved: number }>> {
    const currentUserId = await ensureLocalUser();
    return movePlaceRecordsService({ fromId, toId, records, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async remove(placeId: number, treeId?: number | null): Promise<Audited<{ deleted: true }>> {
    const currentUserId = await ensureLocalUser();
    return deletePlaceService({ placeId, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }
}
