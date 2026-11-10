import { query, getClient } from '@/lib/db/connection';
import { safeRollback } from '@/lib/db/rollback';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { primaryPhotoJoin } from '@/lib/db/queries/media-tags';
import {
  getChildPlaces, getGeocodedPlaceDescendants, getNearestPlaceAncestorWithCoords, getPlaceAncestors, getPlaceFactLinks, movePlaceRecords, renamePlace, deleteUnusedPlace, placeUses,
  upsertPlaceCoordinates, upsertPlaceGeocode, upsertPlaceHierarchy, type PlaceEditChange, type PlaceUsage,
} from '@/lib/db/queries/places';
import { effectiveFirstName, primaryNickname } from '@/lib/db/queries/people';
import { savePlaceOtherNames, getPlaceNameUse, type PlaceOtherNameInput } from '@/lib/db/queries/place-names';
import { auditPlaceDelete, auditPlaceEdit, auditPlaceMove, auditPlaceNames, auditPlaceRename, withAuditIds, type Audited, type PlaceEditKind, type Queryable } from '@/lib/db/queries/audit-capture';
import { ValidationError, validateNameField } from '@/lib/validation';
import { AccessError } from '@/lib/data/errors';
import type { PlaceSummary, PlaceDetail, PlacePersonEntry, PlaceCoords, PlaceGazetteerNode } from '@/lib/data/types';
import { liveEventSql } from '@/lib/db/queries/live-owner';
import type { PlaceKey } from '@/lib/places/place-key';

/**
 * SQL CTE `requested(key, place_id)`: each requested place paired with its id in
 * tree `$1`. Names come in `$2` (text[]) and are keyed as themselves, matched as
 * a typed place is ("PlaceIdByName": the most-used place of that name, else the
 * place it is another name of; #1167, #1186); ids come in `$3` (int[])
 * and are keyed `#<id>` (`placeKeyString`, #1186). A key that names no place is
 * left out.
 */
const REQUESTED_PLACES_CTE = `requested AS (
       SELECT n.name AS key, "PlaceIdByName"($1, n.name) AS place_id
         FROM (SELECT DISTINCT unnest($2::text[]) AS name) n
       UNION ALL
       SELECT '#' || pl."Id", pl."Id" FROM "Places" pl WHERE pl."TreeId" = $1 AND pl."Id" = ANY($3::int[])
     )`;

/** The `$2` names and `$3` ids REQUESTED_PLACES_CTE reads, from a list of keys. */
function requestedPlaces(keys: readonly PlaceKey[]): [string[], number[]] {
  const names = new Set<string>();
  const ids = new Set<number>();
  for (const k of keys) {
    if (typeof k === 'number') { if (Number.isInteger(k) && k > 0) ids.add(k); }
    else if (typeof k === 'string' && k.trim() !== '') names.add(k);
  }
  return [[...names], [...ids]];
}

/**
 * The place a write or lookup names: `placeId` when the caller has it (#1186), else
 * `name`, which lands on the place it names.
 */
function placeTarget(name: string | null | undefined, placeId: number | null | undefined): PlaceKey {
  if (placeId != null) {
    if (!Number.isInteger(placeId) || placeId <= 0) throw new ValidationError('placeId must be a positive integer');
    return placeId;
  }
  if (typeof name !== 'string' || !name.trim()) throw new ValidationError('name is required');
  return name.trim();
}

export interface ListPlacesParams {
  /** Optional so pre-existing direct-service-call test fixtures (that predate
   *  the treeId param) keep type-checking; `resolveTreeScope` treats a missing
   *  value the same as an explicit `null` (falls back to legacy ownerId, then
   *  the caller's own default tree). Routes always pass this explicitly. */
  requestedTreeId?: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/places logic: aggregate distinct place strings across People, Families, Events. */
export async function listPlacesService(
  params: ListPlacesParams
): Promise<{ places: PlaceSummary[]; count: number; gazetteer: PlaceGazetteerNode[] }> {
  const { requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);

  const [countResult, personPlaceResult, gazetteerResult, otherNamesResult] = await Promise.all([
    query(
      // Grouped by the place each fact points at (#1167, ADR 0037), so a fact
      // recorded under another of a place's names counts for that place.
      `SELECT g."Name" AS place, COUNT(*) AS count, g."Id", g."ParentId", g."Latitude", g."Longitude", g."DisplayName"
         FROM (
          SELECT "BirthPlaceId" AS place_id FROM "People" WHERE "TreeId" = $1 AND "BirthPlaceId" IS NOT NULL
          UNION ALL
          SELECT "DeathPlaceId" FROM "People" WHERE "TreeId" = $1 AND "DeathPlaceId" IS NOT NULL
          UNION ALL
          SELECT "MarriagePlaceId" FROM "Families" WHERE "TreeId" = $1 AND "MarriagePlaceId" IS NOT NULL
          UNION ALL
          SELECT e."PlaceId" FROM "Events" e WHERE e."TreeId" = $1 AND e."PlaceId" IS NOT NULL AND ${liveEventSql('e')}
        ) AS ap
        JOIN "Places" g ON g."TreeId" = $1 AND g."Id" = ap.place_id
        GROUP BY g."Name", g."Id", g."ParentId", g."Latitude", g."Longitude", g."DisplayName"
        ORDER BY count DESC, g."Name" ASC`,
      [scope.treeId]
    ),
    // Distinct (place, personId) pairs — UNION (not UNION ALL) dedupes a person
    // linked to the same place via more than one fact (e.g. born and died in the
    // same town). Grouped/sampled in TypeScript below rather than a single mega
    // join, per this codebase's "resolve relationships in TS" convention.
    query(
      `SELECT DISTINCT g."Name" AS place, g."Id", dp."PersonId" FROM (
        SELECT "BirthPlaceId" AS place_id, "Id" AS "PersonId" FROM "People" WHERE "TreeId" = $1 AND "BirthPlaceId" IS NOT NULL
        UNION
        SELECT "DeathPlaceId", "Id" FROM "People" WHERE "TreeId" = $1 AND "DeathPlaceId" IS NOT NULL
        UNION
        SELECT "MarriagePlaceId", COALESCE("Partner1Id", "HusbandId") FROM "Families" WHERE "TreeId" = $1 AND "MarriagePlaceId" IS NOT NULL AND COALESCE("Partner1Id", "HusbandId") IS NOT NULL
        UNION
        SELECT "MarriagePlaceId", COALESCE("Partner2Id", "WifeId") FROM "Families" WHERE "TreeId" = $1 AND "MarriagePlaceId" IS NOT NULL AND COALESCE("Partner2Id", "WifeId") IS NOT NULL
        UNION
        SELECT e."PlaceId", e."PersonId" FROM "Events" e WHERE e."TreeId" = $1 AND e."PlaceId" IS NOT NULL AND ${liveEventSql('e')} AND e."PersonId" IS NOT NULL
      ) dp
      JOIN "Places" g ON g."TreeId" = $1 AND g."Id" = dp.place_id`,
      [scope.treeId]
    ),
    query(
      `SELECT "Id", "Name", "ParentId", "Latitude", "Longitude", "DisplayName", "PinSuppressed"
         FROM "Places" WHERE "TreeId" = $1`,
      [scope.treeId]
    ),
    // A place's other names, so the places filter matches any of them (#1167).
    query(
      `SELECT "PlaceId", "Name" FROM "PlaceName" WHERE "TreeId" = $1 ORDER BY "PlaceId", "Name"`,
      [scope.treeId]
    ),
  ]);
  const otherNamesById = new Map<number, string[]>();
  for (const r of otherNamesResult.rows as { PlaceId: number; Name: string }[]) {
    const names = otherNamesById.get(r.PlaceId) ?? [];
    names.push(r.Name);
    otherNamesById.set(r.PlaceId, names);
  }

  // Group distinct person ids by place; take up to 4 (sorted, deterministic) as
  // the face-stack sample, count all of them for `peopleCount`. Keyed by the place's
  // id: two places may share a name (#1186). An unlinked fact keys by its string.
  const placeKey = (r: { place: string; Id: number | null }) => (r.Id != null ? `#${r.Id}` : r.place);
  const personIdsByPlace = new Map<string, number[]>();
  for (const r of personPlaceResult.rows as { place: string; Id: number | null; PersonId: number }[]) {
    const key = placeKey(r);
    const arr = personIdsByPlace.get(key) ?? [];
    arr.push(r.PersonId);
    personIdsByPlace.set(key, arr);
  }
  const sampleIds = new Set<number>();
  const sampleIdsByPlace = new Map<string, number[]>();
  for (const [place, ids] of personIdsByPlace) {
    const sorted = [...ids].sort((a, b) => a - b).slice(0, 4);
    sampleIdsByPlace.set(place, sorted);
    sorted.forEach((id) => sampleIds.add(id));
  }

  // Batch-fetch face data for only the sampled ids (not every linked person),
  // reusing the same primary-photo resolution the People list already uses.
  const faceRows = sampleIds.size > 0
    ? ((await query(
        `SELECT p."Id", p."FirstName", p."LastName",
                ${effectiveFirstName('p')} AS "EffectiveFirstName",
                ${primaryNickname('p')} AS "Nickname",
                p."Sex",
                photo."Id" AS "PrimaryMediaId", photo."FocalX", photo."FocalY", photo."FocalRadius"
         FROM "People" p
         ${primaryPhotoJoin('p', 'p."TreeId"', 'photo')}
         WHERE p."TreeId" = $1 AND p."Id" = ANY($2)`,
        [scope.treeId, [...sampleIds]]
      )).rows as {
        Id: number; FirstName: string | null; LastName: string | null;
        EffectiveFirstName: string | null; Nickname: string | null; Sex: string | null;
        PrimaryMediaId: number | null; FocalX: number | null; FocalY: number | null; FocalRadius: number | null;
      }[])
    : [];
  const faceById = new Map(faceRows.map((r) => [r.Id, r]));

  const places = countResult.rows.map((r: { place: string; count: string; Id: number | null; ParentId: number | null; Latitude: number | null; Longitude: number | null; DisplayName: string | null }) => {
    const sampleForPlace = sampleIdsByPlace.get(placeKey(r)) ?? [];
    return {
      name: r.place,
      count: parseInt(r.count, 10),
      id: r.Id,
      parentId: r.ParentId,
      latitude: r.Latitude,
      longitude: r.Longitude,
      displayName: r.DisplayName,
      ...(r.Id != null && otherNamesById.has(r.Id) ? { otherNames: otherNamesById.get(r.Id) } : {}),
      peopleCount: personIdsByPlace.get(placeKey(r))?.length ?? 0,
      faces: sampleForPlace
        .map((id) => faceById.get(id))
        .filter((f): f is NonNullable<typeof f> => f != null)
        .map((f) => ({
          id: f.Id,
          firstName: f.FirstName,
          lastName: f.LastName,
          effectiveFirstName: f.EffectiveFirstName,
          nickname: f.Nickname,
          sex: f.Sex,
          primaryMediaId: f.PrimaryMediaId,
          focalX: f.FocalX,
          focalY: f.FocalY,
          focalRadius: f.FocalRadius,
        })),
    };
  });
  const gazetteer: PlaceGazetteerNode[] = (gazetteerResult.rows as { Id: number; Name: string; ParentId: number | null; Latitude: number | null; Longitude: number | null; DisplayName: string | null; PinSuppressed: boolean }[])
    .map((r) => ({
      id: r.Id, name: r.Name, parentId: r.ParentId, latitude: r.Latitude, longitude: r.Longitude, displayName: r.DisplayName, pinSuppressed: r.PinSuppressed,
      ...(otherNamesById.has(r.Id) ? { otherNames: otherNamesById.get(r.Id) } : {}),
    }));
  return { places, count: places.length, gazetteer };
}

export interface GetPlaceDetailParams {
  /** A name the place is called; ignored when `id` is given. */
  name?: string;
  /** The place's id (#1186): exact, where a name may be shared. */
  id?: number | null;
  /** Optional so pre-existing direct-service-call test fixtures (that predate
   *  the treeId param) keep type-checking; `resolveTreeScope` treats a missing
   *  value the same as an explicit `null` (falls back to legacy ownerId, then
   *  the caller's own default tree). Routes always pass this explicitly. */
  requestedTreeId?: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/places/detail logic: people born/died + events + families at the named place. */
export async function getPlaceDetailService(
  params: GetPlaceDetailParams
): Promise<PlaceDetail> {
  const { id, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const target = placeTarget(params.name, id);
  const name = typeof target === 'string' ? target : '';
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);

  // The place's own gazetteer row — fetched first because the people/events roll-up
  // needs its Id to gather descendants.
  const geo = await query(
    // OsmType/OsmId ride along with DisplayName: they are the machine-readable half of
    // the same geocoder provenance (ADR 0017), and the edit form has to send them back
    // on save or the single-row upsert's unconditional `= EXCLUDED` overwrites them
    // with NULL — silently discarding a match the row already had.
    // A fact's string may be another of the place's names (#1167); it opens that place.
    typeof target === 'number'
      ? `SELECT "Id", "Name", "Latitude", "Longitude", "DisplayName", "OsmType", "OsmId", "ParentId", "Form" FROM "Places"
          WHERE "TreeId" = $1 AND "Id" = $2`
      : `SELECT "Id", "Name", "Latitude", "Longitude", "DisplayName", "OsmType", "OsmId", "ParentId", "Form" FROM "Places"
          WHERE "TreeId" = $1 AND "Id" = "PlaceIdByName"($1, $2)`,
    [scope.treeId, target]
  );
  const geoRow = (geo.rows[0] as { Id: number; Name: string; Latitude: number | null; Longitude: number | null; DisplayName: string | null; OsmType: string | null; OsmId: string | number | null; ParentId: number | null; Form: string | null } | undefined);

  // Roll-up set: the place itself + every descendant place (walking `ParentId`), so a
  // jurisdiction's detail aggregates the people/events/marriages of everything inside it
  // (England includes Kent, Dover, London…). Facts are matched by the place they point at
  // (#1167); every fact's string has a gazetteer row, so a name with none has no records.
  // depth-capped + DISTINCT for ParentId-cycle safety.
  let placeIds: number[] = [];
  if (geoRow) {
    const desc = await query(
      `WITH RECURSIVE d AS (
         SELECT "Id", 0 AS depth FROM "Places" WHERE "TreeId" = $1 AND "Id" = $2
         UNION ALL
         SELECT c."Id", d.depth + 1 FROM "Places" c JOIN d ON c."ParentId" = d."Id"
           WHERE c."TreeId" = $1 AND d.depth < 20
       )
       SELECT DISTINCT "Id" FROM d`,
      [scope.treeId, geoRow.Id]
    );
    placeIds = (desc.rows as { Id: number }[]).map((r) => r.Id);
  }

  // A place with no pin of its own maps its geocoded descendants (#923), the same
  // rule as Explore; the nearest geocoded ancestor is the fallback when none is.
  const unpinned = geoRow != null && (geoRow.Latitude == null || geoRow.Longitude == null);
  const inheritedFromPromise = unpinned
    ? getNearestPlaceAncestorWithCoords(geoRow.Id, scope.treeId)
    : Promise.resolve(null);
  const descendantPinsPromise = unpinned
    ? getGeocodedPlaceDescendants(geoRow.Id, scope.treeId)
    : Promise.resolve([]);

  const [peopleResult, eventsResult, familiesResult, ancestors, childRows, factLinks, inheritedFromRow, descendantRows, nameUse] = await Promise.all([
    query(
      `SELECT p."Id", p."FirstName", p."LastName",
              ${effectiveFirstName('p')} AS "EffectiveFirstName",
              ${primaryNickname('p')} AS "Nickname",
              p."Sex", p."BirthDate", p."DeathDate",
              m."Id" AS "PrimaryMediaId", m."FocalX", m."FocalY", m."FocalRadius",
              CASE
                WHEN p."BirthPlaceId" = ANY($2) AND p."DeathPlaceId" = ANY($2) THEN 'born & died'
                WHEN p."BirthPlaceId" = ANY($2) THEN 'born'
                ELSE 'died'
              END AS "PlaceRole"
       FROM "People" p
       ${primaryPhotoJoin('p', 'p."TreeId"', 'm')}
       WHERE p."TreeId" = $1
         AND (p."BirthPlaceId" = ANY($2) OR p."DeathPlaceId" = ANY($2))
       ORDER BY p."LastName", p."FirstName"`,
      [scope.treeId, placeIds]
    ),
    // The detail rail only shows per-type tallies, so aggregate server-side
    // instead of shipping every event row (with a wasted People join) — audit #10.
    query(
      `SELECT e."Type", COUNT(*)::int AS "count"
       FROM "Events" e
       WHERE e."TreeId" = $1 AND e."PlaceId" = ANY($2) AND ${liveEventSql('e')}
       GROUP BY e."Type"
       ORDER BY "count" DESC, e."Type" ASC`,
      [scope.treeId, placeIds]
    ),
    query(
      `SELECT COUNT(*)::int AS "count"
       FROM "Families" f
       WHERE f."TreeId" = $1 AND f."MarriagePlaceId" = ANY($2)`,
      [scope.treeId, placeIds]
    ),
    geoRow ? getPlaceAncestors(geoRow.Id, scope.treeId) : Promise.resolve([] as { Id: number; Name: string }[]),
    geoRow ? getChildPlaces(geoRow.Id, scope.treeId) : Promise.resolve([]),
    // One row per fact that names this place (or any place inside it), each
    // carrying its own reason — births and deaths alone left marriages and
    // residences invisible on a place's page.
    getPlaceFactLinks(placeIds, scope.treeId),
    inheritedFromPromise,
    descendantPinsPromise,
    geoRow ? getPlaceNameUse(geoRow.Id, scope.treeId) : Promise.resolve({ otherNames: [], ownNameRecords: 0 }),
  ]);
  const uses = geoRow ? await placeUses({ query }, scope.treeId, geoRow.Id) : null;

  // Jurisdiction hierarchy (only when the place is a gazetteer row with an Id).
  const parents = ancestors.map((a) => ({ id: a.Id, name: a.Name }));
  const children = childRows.map((c) => ({ id: c.Id, name: c.Name }));

  const eventCounts = (eventsResult.rows as { Type: string; count: number | string }[])
    .map((r) => ({ type: r.Type, count: Number(r.count) }));
  const eventCount = eventCounts.reduce((sum, e) => sum + e.count, 0);
  const familyCount = Number((familiesResult.rows[0] as { count: number | string } | undefined)?.count ?? 0);

  return {
    name: geoRow?.Name ?? name,
    people: peopleResult.rows as PlacePersonEntry[],
    factLinks,
    eventCounts,
    eventCount,
    familyCount,
    latitude: geoRow?.Latitude ?? null,
    longitude: geoRow?.Longitude ?? null,
    displayName: geoRow?.DisplayName ?? null,
    osmType: geoRow?.OsmType ?? null,
    // BIGINT arrives from pg as a string. Coerced so the declared `number | null`
    // is true at runtime; OSM ids are ~1e10 at most, far inside Number's safe range.
    osmId: geoRow?.OsmId != null ? Number(geoRow.OsmId) : null,
    id: geoRow?.Id ?? null,
    form: geoRow?.Form ?? null,
    descendantPins: descendantRows.map((r) => ({ id: r.Id, name: r.Name, lat: r.Latitude, lng: r.Longitude })),
    inheritedFrom: inheritedFromRow && descendantRows.length === 0
      ? { id: inheritedFromRow.Id, name: inheritedFromRow.Name, lat: inheritedFromRow.Latitude, lng: inheritedFromRow.Longitude }
      : null,
    parents,
    children,
    otherNames: nameUse.otherNames,
    ownNameRecords: nameUse.ownNameRecords,
    uses,
  };
}

export interface GetPlaceCoordsParams {
  /** Names places are called, each reported under itself. */
  names?: string[];
  /** Place ids (#1186), each reported under `placeKeyString(id)`. */
  ids?: number[];
  /** Optional so pre-existing direct-service-call test fixtures (that predate
   *  the treeId param) keep type-checking; `resolveTreeScope` treats a missing
   *  value the same as an explicit `null` (falls back to legacy ownerId, then
   *  the caller's own default tree). Routes always pass this explicitly. */
  requestedTreeId?: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/**
 * POST /api/places/coords logic: resolve a set of place names to coordinates in
 * a single indexed query. Only places with both coordinates present are
 * returned. Replaces the person profile's former per-place `/api/places/detail`
 * fan-out (audit #4) — that endpoint runs six queries and returns full
 * people/events/families just to read lat/lng.
 */
export async function getPlaceCoordsService(
  params: GetPlaceCoordsParams
): Promise<PlaceCoords> {
  const { names, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);

  const [unique, ids] = requestedPlaces([...(names ?? []), ...(params.ids ?? [])]);
  if (unique.length === 0 && ids.length === 0) return {};

  // Walk up the place hierarchy to the nearest ancestor that actually has a pin,
  // mirroring `resolvePin` (lib/geocode/photon.ts) — suppression anywhere on the way
  // up kills the pin, otherwise the shallowest coordinate wins.
  //
  // Reading only the leaf's own columns meant a place recorded loosely ("my home")
  // and geotagged by way of its parent ("Paris, Ontario, Canada") resolved to
  // nothing, so the person timeline showed no map for it at all.
  const result = await query(
    // Each requested name starts at the place it names, its own or another of its
    // names (#1167), and is reported under the name as requested.
    `WITH RECURSIVE ${REQUESTED_PLACES_CTE},
     chain AS (
       SELECT pl."Id", r.key AS root_name, pl."ParentId", pl."Latitude", pl."Longitude",
              pl."PinSuppressed", 0 AS depth
         FROM requested r JOIN "Places" pl ON pl."Id" = r.place_id
       UNION ALL
       SELECT p."Id", c.root_name, p."ParentId", p."Latitude", p."Longitude",
              p."PinSuppressed", c.depth + 1
         FROM chain c
         JOIN "Places" p ON p."Id" = c."ParentId" AND p."TreeId" = $1
        WHERE NOT c."PinSuppressed"
          AND (c."Latitude" IS NULL OR c."Longitude" IS NULL)
     )
     SELECT DISTINCT ON (root_name) root_name AS "Name", "Latitude", "Longitude"
       FROM chain
      WHERE NOT "PinSuppressed"
        AND "Latitude" IS NOT NULL AND "Longitude" IS NOT NULL
      ORDER BY root_name, depth ASC`,
    [scope.treeId, unique, ids]
  );

  const coords: PlaceCoords = {};
  for (const r of result.rows as { Name: string; Latitude: number; Longitude: number }[]) {
    coords[r.Name] = { lat: r.Latitude, lng: r.Longitude };
  }
  return coords;
}

/** One raw ancestry row for a resolved place chain (root → leaf). Uninterpreted:
 *  suppression is NOT applied and the effective pin is NOT chosen here — the
 *  client's `resolvePin` does both (design spec §4b). */
export interface PinChainRow {
  name: string;
  latitude: number | null;
  longitude: number | null;
  pinSuppressed: boolean;
  displayName: string | null;
}

export interface GetPlacePinChainsParams {
  /** Names places are called, each reported under itself. */
  names?: string[];
  /** Place ids (#1186), each reported under `placeKeyString(id)`. */
  ids?: number[];
  /** Optional so pre-existing direct-service-call test fixtures (that predate
   *  the treeId param) keep type-checking; `resolveTreeScope` treats a missing
   *  value the same as an explicit `null` (falls back to legacy ownerId, then
   *  the caller's own default tree). Routes always pass this explicitly. */
  requestedTreeId?: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/**
 * POST /api/places/pin-chains logic (design spec §4b): for each requested place
 * name, return the raw `Places` ancestry chain (root → leaf) by walking `ParentId`
 * upward in one `WITH RECURSIVE` query. The rows are returned uninterpreted — the
 * client feeds them to the same `resolvePin` used during live typing, so the
 * reopened badge can never disagree with the live one. `depth < 12` bounds a
 * possible `ParentId` cycle (rename/merge can re-point children; spec §7 risk 2).
 */
export async function getPlacePinChainsService(
  params: GetPlacePinChainsParams
): Promise<Record<string, PinChainRow[]>> {
  const { names, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);

  const [unique, ids] = requestedPlaces([...(names ?? []), ...(params.ids ?? [])]);
  if (unique.length === 0 && ids.length === 0) return {};

  const result = await query(
    `WITH RECURSIVE ${REQUESTED_PLACES_CTE},
     chain AS (
       SELECT p."Id", p."Name", p."Latitude", p."Longitude", p."PinSuppressed", p."DisplayName", p."ParentId",
              r.key AS "rootName", 0 AS depth
         FROM requested r JOIN "Places" p ON p."Id" = r.place_id
       UNION ALL
       SELECT parent."Id", parent."Name", parent."Latitude", parent."Longitude", parent."PinSuppressed", parent."DisplayName", parent."ParentId",
              c."rootName", c.depth + 1
         FROM chain c
         JOIN "Places" parent ON parent."Id" = c."ParentId" AND parent."TreeId" = $1
        WHERE c.depth < 12
     )
     SELECT "rootName", "Name", "Latitude", "Longitude", "PinSuppressed", "DisplayName"
       FROM chain
      ORDER BY "rootName", depth DESC`,
    [scope.treeId, unique, ids]
  );

  const chains: Record<string, PinChainRow[]> = {};
  for (const r of result.rows as {
    rootName: string; Name: string; Latitude: number | null; Longitude: number | null;
    PinSuppressed: boolean; DisplayName: string | null;
  }[]) {
    (chains[r.rootName] ??= []).push({
      name: r.Name,
      latitude: r.Latitude,
      longitude: r.Longitude,
      pinSuppressed: r.PinSuppressed,
      displayName: r.DisplayName,
    });
  }
  return chains;
}

/**
 * Run a place write and its audit entry in one transaction (#924), so an edit
 * is never saved without its log entry and a failed audit write rolls it back.
 */
async function inPlaceEditTransaction(
  treeId: number,
  ownerId: number,
  userId: number,
  kind: PlaceEditKind,
  write: (client: Queryable) => Promise<PlaceEditChange[]>,
): Promise<void> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const changes = await write(client);
    await auditPlaceEdit({ kind, changes, treeOwnerId: ownerId, userId, treeId, exec: client });
    await client.query('COMMIT');
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

export interface UpsertPlaceGeocodeParams {
  /** A name the place is called; ignored when `placeId` is given. */
  name?: string;
  /** The place's id (#1186). */
  placeId?: number | null;
  latitude: number | null;
  longitude: number | null;
  displayName?: string | null;
  osmType?: string | null;
  osmId?: number | null;
  pinSuppressed?: boolean;
  /** Optional so pre-existing direct-service-call test fixtures (that predate
   *  the treeId param) keep type-checking; `resolveTreeScope` treats a missing
   *  value the same as an explicit `null` (falls back to legacy ownerId, then
   *  the caller's own default tree). Routes always pass this explicitly. */
  requestedTreeId?: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** POST /api/places/geocode logic: cache a place string's coordinates, or
 *  explicitly suppress its pin (Remove pin — design spec §7). */
export async function upsertPlaceGeocodeService(params: UpsertPlaceGeocodeParams): Promise<void> {
  const { latitude, longitude, displayName, osmType, osmId, pinSuppressed, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const target = placeTarget(params.name, params.placeId);
  // Number.isFinite: a string or NaN passes both comparisons and failed later in SQL (#867).
  if (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) throw new ValidationError('latitude out of range');
  if (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) throw new ValidationError('longitude out of range');

  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  const kind: PlaceEditKind = pinSuppressed ? 'pin_hidden' : latitude != null ? 'geocode' : 'pin_cleared';
  await inPlaceEditTransaction(scope.treeId, scope.ownerId, currentUserId, kind, async (client) => [
    await upsertPlaceGeocode(client, {
      ownerId: scope.ownerId, treeId: scope.treeId, target,
      latitude: latitude ?? null, longitude: longitude ?? null, displayName: displayName ?? null,
      osmType: osmType ?? null, osmId: osmId ?? null, pinSuppressed: pinSuppressed ?? false,
    }),
  ]);
}

export interface UpdatePlaceCoordinatesParams {
  /** A name the place is called; ignored when `placeId` is given. */
  name?: string;
  /** The place's id (#1186). */
  placeId?: number | null;
  latitude: number;
  longitude: number;
  requestedTreeId?: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** Persist a manual coordinate adjustment without changing geocoder provenance. */
export async function updatePlaceCoordinatesService(params: UpdatePlaceCoordinatesParams): Promise<void> {
  const { latitude, longitude, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const target = placeTarget(params.name, params.placeId);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new ValidationError('latitude out of range');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new ValidationError('longitude out of range');
  }

  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  await inPlaceEditTransaction(scope.treeId, scope.ownerId, currentUserId, 'coordinates', async (client) => [
    await upsertPlaceCoordinates(client, { ownerId: scope.ownerId, treeId: scope.treeId, target, latitude, longitude }),
  ]);
}

export interface HierarchyLevelInput {
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  /** The geocoder's canonical name for this level's own pin (design spec §3). */
  displayName?: string | null;
  osmType?: 'node' | 'way' | 'relation' | null;
  osmId?: number | null;
}

export interface UpsertPlaceHierarchyParams {
  /** Ordered root → leaf, e.g. [United Kingdom, England, Kent, Dover, <leaf>]. */
  levels: HierarchyLevelInput[];
  /** An explicit re-match may replace a stale parent chain. */
  reparent?: boolean;
  /** The leaf level's place id (#1186), so the chain lands on that place. */
  leafId?: number | null;
  /** Optional so pre-existing direct-service-call test fixtures (that predate
   *  the treeId param) keep type-checking; `resolveTreeScope` treats a missing
   *  value the same as an explicit `null` (falls back to legacy ownerId, then
   *  the caller's own default tree). Routes always pass this explicitly. */
  requestedTreeId?: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/**
 * POST /api/places/geocode-hierarchy logic: persist a resolved jurisdiction chain
 * as linked Places rows (docs/superpowers/specs/2026-07-09-places-precision-
 * hierarchy-design.md §5). One transaction; each level is INSERT ... ON CONFLICT
 * ("UserId","Name") DO UPDATE, so a level shared with an earlier save (e.g. "Kent")
 * is reused, not duplicated — only its Latitude/Longitude/UpdatedAt are touched,
 * mirroring upsertPlaceGeocodeService's existing single-row upsert. ParentId links
 * each level to the previously-resolved level's Id. The matched level also stores
 * its OSM identity with its coordinates in the same transaction. A level that receives a real
 * coordinate in this write also clears its own PinSuppressed flag (design spec §7:
 * a confidence-passing geocode un-suppresses a previously-removed pin) — a purely
 * structural ancestor level (no coordinate in this write) leaves its existing
 * PinSuppressed value untouched, so an ancestor explicitly suppressed on its own
 * still stops resolvePin's walk-up per §3.
 */
export async function upsertPlaceHierarchyService(params: UpsertPlaceHierarchyParams): Promise<void> {
  const { levels, reparent = false, leafId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  if (leafId != null && (!Number.isInteger(leafId) || leafId <= 0)) throw new ValidationError('leafId must be a positive integer');
  if (!Array.isArray(levels) || levels.length === 0) throw new ValidationError('levels must be a non-empty array');
  if (typeof reparent !== 'boolean') throw new ValidationError('reparent must be a boolean');
  const names = new Set<string>();
  for (const level of levels) {
    if (typeof level?.name !== 'string' || !level.name.trim()) throw new ValidationError('every level requires a name');
    const key = level.name.trim().toLowerCase();
    if (names.has(key)) throw new ValidationError('hierarchy levels must have distinct names');
    names.add(key);
    if ((level.latitude == null) !== (level.longitude == null)) throw new ValidationError('coordinates must be a pair');
    if (level.latitude != null && (!Number.isFinite(level.latitude) || level.latitude < -90 || level.latitude > 90)) throw new ValidationError('latitude out of range');
    if (level.longitude != null && (!Number.isFinite(level.longitude) || level.longitude < -180 || level.longitude > 180)) throw new ValidationError('longitude out of range');
  }

  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  await inPlaceEditTransaction(scope.treeId, scope.ownerId, currentUserId, 'hierarchy', (client) => upsertPlaceHierarchy(client, {
    ownerId: scope.ownerId,
    treeId: scope.treeId,
    reparent,
    leafId: leafId ?? null,
    levels: levels.map((level) => ({
      name: level.name.trim(),
      latitude: level.latitude ?? null,
      longitude: level.longitude ?? null,
      displayName: level.displayName ?? null,
      osmType: level.osmType ?? null,
      osmId: level.osmId ?? null,
    })),
  }));
}

export interface GetPlaceDependentCountParams {
  /** A name the place is called; ignored when `placeId` is given. */
  name?: string;
  /** The place's id (#1186). */
  placeId?: number | null;
  /** Optional so pre-existing direct-service-call test fixtures (that predate
   *  the treeId param) keep type-checking; `resolveTreeScope` treats a missing
   *  value the same as an explicit `null` (falls back to legacy ownerId, then
   *  the caller's own default tree). Routes always pass this explicitly. */
  requestedTreeId?: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/**
 * GET /api/places/geocode/dependents logic — the blast-radius check for the Edit
 * popover (design spec §6.2 step 2): how many other Places rows currently inherit
 * their pin from this one via ParentId. One query, no fan-out.
 */
export async function getPlaceDependentCountService(params: GetPlaceDependentCountParams): Promise<number> {
  const { requestedTreeId, requestedOwnerId, currentUserId } = params;
  const target = placeTarget(params.name, params.placeId);
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);

  const result = await query(
    `WITH ${REQUESTED_PLACES_CTE}
     SELECT COUNT(*)::int AS "count" FROM "Places" c
       JOIN requested r ON c."ParentId" = r.place_id
      WHERE c."TreeId" = $1`,
    [scope.treeId, ...requestedPlaces([target])]
  );
  return (result.rows[0] as { count: number }).count;
}

export interface RenamePlaceParams {
  /** The name to rename; ignored when `fromId` is given. */
  from?: string;
  /** The place to rename, by id (#1186). */
  fromId?: number | null;
  to: string;
  /** Keep the old name as another name, so its records stay as written (#1185). */
  keepOldName?: boolean;
  /** `to` is another place's name too: rename without merging (#1185, ADR 0036). */
  separate?: boolean;
  /** Optional so pre-existing direct-service-call test fixtures (that predate
   *  the treeId param) keep type-checking; `resolveTreeScope` treats a missing
   *  value the same as an explicit `null` (falls back to legacy ownerId, then
   *  the caller's own default tree). Routes always pass this explicitly. */
  requestedTreeId?: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/**
 * POST /api/places/rename logic (CRUD §1.2): rename a place, or MERGE it into an
 * existing one, by rewriting the free-text fact columns and folding the gazetteer
 * row — all in a single transaction with one revertable audit entry. Returns how
 * many records were rewritten and whether it was a merge.
 */
export async function renamePlaceService(
  params: RenamePlaceParams,
): Promise<Audited<{ renamed: number; wasMerge: boolean; to: string }>> {
  // `from` names stored text, which may predate the normalizer, so it is matched
  // as written. `to` is new text and is normalized like every other place write
  // (#884). The geocode and hierarchy services below take `name` as a lookup key
  // too, so they leave it as written for the same reason.
  const from = params.fromId != null ? placeTarget(null, params.fromId) : (params.from ?? '').trim();
  const to = validateNameField(params.to ?? '', 'to', 500) ?? '';
  if (!from) throw new ValidationError('from is required');
  if (!to) throw new ValidationError('to is required');
  if (from === to) throw new ValidationError('The new name is the same as the current one');

  const scope = await resolveTreeScope(
    { treeId: params.requestedTreeId, ownerId: params.requestedOwnerId },
    params.currentUserId
  );
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await renamePlace(client, scope.treeId, from, to, { keepOldName: params.keepOldName === true, separate: params.separate === true });
    if (!result.changed) {
      // Nothing references `from` and it has no gazetteer row — treat as not found
      // rather than silently writing an empty audit entry.
      throw new ValidationError(`No place named "${from}" was found`);
    }
    const auditId = await auditPlaceRename(scope.ownerId, params.currentUserId, result.snapshot, result.survivingId, client, scope.treeId);
    await client.query('COMMIT');
    return withAuditIds({ renamed: result.snapshot.affected.length, wasMerge: result.snapshot.wasMerge, to }, [auditId]);
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

export interface SavePlaceNamesParams {
  placeId: number;
  /** The place's other names as they should be: `{ id?, name, language, fromDate, toDate }`. */
  names: unknown;
  requestedTreeId?: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** One optional short text field of a name, trimmed; blank is null. */
function optionalText(value: unknown, field: string, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  const v = value.trim();
  if (v.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer`);
  return v || null;
}

/** A `names` list as sent, or a ValidationError naming what is wrong with it. */
function parsePlaceNames(value: unknown): PlaceOtherNameInput[] {
  if (!Array.isArray(value)) throw new ValidationError('names must be a list');
  if (value.length > 200) throw new ValidationError('A place can have at most 200 other names');
  return value.map((raw) => {
    const n = (raw ?? {}) as Record<string, unknown>;
    const id = n.id;
    if (id != null && (!Number.isSafeInteger(id) || (id as number) <= 0)) throw new ValidationError('A name id must be a positive integer');
    const name = validateNameField(n.name ?? '', 'name', 500);
    if (!name) throw new ValidationError('Each other name needs a name');
    return {
      id: (id as number | null | undefined) ?? null,
      name,
      language: optionalText(n.language, 'language', 100),
      fromDate: optionalText(n.fromDate, 'fromDate', 100),
      toDate: optionalText(n.toDate, 'toDate', 100),
    };
  });
}

/**
 * Save a place's other names (#1185) as one audited change: the list replaces the
 * names the place has. Undo reverts its one audit entry. Saving the list unchanged
 * writes nothing and returns no audit id.
 */
export async function savePlaceNamesService(params: SavePlaceNamesParams): Promise<Audited<{ added: number; changed: number; removed: number }>> {
  if (!Number.isSafeInteger(params.placeId) || params.placeId <= 0) throw new ValidationError('placeId must be a positive integer');
  const names = parsePlaceNames(params.names);
  const scope = await resolveTreeScope(
    { treeId: params.requestedTreeId, ownerId: params.requestedOwnerId },
    params.currentUserId
  );
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const snapshot = await savePlaceOtherNames(client, scope.treeId, scope.ownerId, params.placeId, names);
    const auditId = snapshot ? await auditPlaceNames(scope.ownerId, params.currentUserId, snapshot, client, scope.treeId) : null;
    await client.query('COMMIT');
    return withAuditIds(
      { added: snapshot?.added.length ?? 0, changed: snapshot?.changed.length ?? 0, removed: snapshot?.removed.length ?? 0 },
      auditId != null ? [auditId] : [],
    );
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

export interface MovePlaceRecordsParams {
  fromId: number;
  toId: number;
  /** The facts to move; all of the place's facts when absent. */
  records?: unknown;
  requestedTreeId?: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

const FACT_KINDS: readonly PlaceUsage['kind'][] = ['birth', 'death', 'marriage', 'event'];

/** A `records` list as sent, or a ValidationError naming what is wrong with it. */
function parseMovedRecords(value: unknown): { kind: PlaceUsage['kind']; recordId: number }[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw new ValidationError('records must be a non-empty list');
  return value.map((r) => {
    const kind = (r as { kind?: unknown })?.kind;
    const recordId = (r as { recordId?: unknown })?.recordId;
    if (!FACT_KINDS.includes(kind as PlaceUsage['kind']) || !Number.isSafeInteger(recordId) || (recordId as number) <= 0) {
      throw new ValidationError('Each record needs a kind (birth, death, marriage or event) and a recordId');
    }
    return { kind: kind as PlaceUsage['kind'], recordId: recordId as number };
  });
}

/**
 * POST /api/places/move logic (#1186): point facts of one place at another, with
 * one revertable audit entry. For a record linked to the wrong one of two places
 * that share a name, and for folding a duplicate into the place it repeats.
 */
export async function movePlaceRecordsService(params: MovePlaceRecordsParams): Promise<Audited<{ moved: number }>> {
  const records = parseMovedRecords(params.records);
  const scope = await resolveTreeScope(
    { treeId: params.requestedTreeId, ownerId: params.requestedOwnerId },
    params.currentUserId
  );
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const snapshot = await movePlaceRecords(client, scope.treeId, params.fromId, params.toId, records);
    const auditId = await auditPlaceMove(scope.ownerId, params.currentUserId, snapshot, client, scope.treeId);
    await client.query('COMMIT');
    return withAuditIds({ moved: snapshot.affected.length }, [auditId]);
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

export interface DeletePlaceParams {
  placeId: number;
  requestedTreeId?: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/**
 * DELETE /api/places/detail logic (#1229): delete a place nothing uses, with one
 * revertable audit entry. Deleting is for Edit access, like other deletes; a place
 * in use is refused and its records go to another place with Move records first.
 */
export async function deletePlaceService(params: DeletePlaceParams): Promise<Audited<{ deleted: true }>> {
  const scope = await resolveTreeScope(
    { treeId: params.requestedTreeId, ownerId: params.requestedOwnerId },
    params.currentUserId
  );
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to delete places in this tree');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const snapshot = await deleteUnusedPlace(client, scope.treeId, params.placeId);
    const auditId = await auditPlaceDelete(scope.ownerId, params.currentUserId, snapshot, client, scope.treeId);
    await client.query('COMMIT');
    return withAuditIds({ deleted: true as const }, [auditId]);
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Returns a place-name → {lat, lng} map of every geocoded place for a tree.
 * Used by the GEDCOM exporter to emit PLAC.MAP sub-structures. Only rows with
 * both coordinates present are included.
 */
export async function getPlaceCoordsForUser(
  treeId: number
): Promise<Map<string, { lat: number; lng: number }>> {
  const result = await query(
    `SELECT "Id","Name","Latitude","Longitude" FROM "Places"
       WHERE "TreeId" = $1 AND "Latitude" IS NOT NULL AND "Longitude" IS NOT NULL
       ORDER BY "Id" DESC`,
    [treeId]
  );
  // Keyed by `#<id>` and by name: two places may share a name (#1186), so a fact with a
  // place id looks it up by id. Rows come newest first, so a shared name keeps the oldest.
  const coords = new Map<string, { lat: number; lng: number }>();
  for (const r of result.rows as { Id: number; Name: string; Latitude: number; Longitude: number }[]) {
    const at = { lat: r.Latitude, lng: r.Longitude };
    coords.set(`#${r.Id}`, at);
    coords.set(r.Name, at);
  }
  return coords;
}
