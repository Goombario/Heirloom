// places.json sidecar — carries the gazetteer, which the .ged structurally cannot.
//
// GEDCOM 5.5.1 has no PLACE record: the record vocabulary is FAM / INDIVIDUAL /
// MULTIMEDIA / NOTE / REPOSITORY / SOURCE / SUBMISSION / SUBMITTER
// (ged551-2.txt:113-289), and PLACE_STRUCTURE (:659) is only ever a substructure of
// an event. So a place can only appear in a .ged by being REFERENCED by a fact, and
// only the fields that hang off PLAC survive (FORM, MAP's LATI/LONG, NOTE).
//
// Everything else is lost on export and then re-created empty by the importer's
// place-promotion pass:
//   - a row no fact references (e.g. a country kept only as a parent)
//   - the ParentId hierarchy (promotion re-derives one from comma segments, which
//     is a guess, not the user's curation)
//   - geocoder results: DisplayName / OsmType / OsmId
//   - the PinSuppressed map toggle, which is a user decision
//
// Unlike sources.json, this sidecar is PRIMARY for the fields it carries: they have
// no .ged representation to defer to. It is applied BEFORE promotion so promotion
// finds the rows already present and upgrades nothing away.
//
// Two places may share a name (#1186). Each entry then carries an export-local
// `key`, its parent is named by `parentKey`, and `facts` says which of the places a
// record of that name points at, because the .ged only has the name. A bundle
// without these (older, or hand-made) still reads by name.
//
// Additive-only, per ADR 0009 — a malformed or newer bundle warns, never rejects.

const CURRENT_VERSION = 1;

/** Structurally compatible with a Places row. */
export interface SidecarPlaceInput {
  Id: number;
  Name: string;
  Form: string | null;
  Latitude: number | null;
  Longitude: number | null;
  ParentId: number | null;
  DisplayName?: string | null;
  OsmType?: string | null;
  OsmId?: number | string | null;
  OsmKind?: string | null;
  PinSuppressed?: boolean | null;
}

/** Structurally compatible with a PlaceName row. */
export interface SidecarPlaceNameInput {
  PlaceId: number;
  Name: string;
  Language: string | null;
  FromDate: string | null;
  ToDate: string | null;
}

/** Another name of a place (#1167, ADR 0031). The .ged never carries these. */
interface SidecarPlaceName {
  name: string;
  language: string | null;
  fromDate: string | null;
  toDate: string | null;
}

export interface SidecarPlaceEntry {
  /** Export-local id, unique within the file (#1186). Absent in older bundles. */
  key?: string;
  name: string;
  form: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Parent by NAME, not Id — ids are reassigned on every import. */
  parent: string | null;
  /** Parent by `key`, which tells apart two parents of one name (#1186). */
  parentKey?: string | null;
  displayName: string | null;
  osmType: string | null;
  /** String, not number: OsmId is a BIGINT and would lose precision as a JS number. */
  osmId: string | null;
  /** What kind of place the geocoder matched, as OSM's `key/value` (#45, ADR 0050).
   *  Additive: written only when known. */
  osmKind?: string | null;
  pinSuppressed: boolean;
  /** The place's other names. Additive (ADR 0009): written only when there are any. */
  names?: SidecarPlaceName[];
}

/** A fact whose place name more than one place has, and which of them it is (#1186). */
export interface SidecarFactPlace {
  /** The record's xref in the .ged, a person (`@I…@`) or a family (`@F…@`). */
  xref: string;
  fact: FactKind;
  /** An event's type; null for birth, death and marriage. */
  type: string | null;
  date: string | null;
  place: string;
  /** Which of the record's events with the same type, date and place, from 0. */
  n: number;
  /** The `key` of the place. */
  key: string;
}

export interface PlacesSidecar {
  version: number;
  places: SidecarPlaceEntry[];
  facts?: SidecarFactPlace[];
}

type FactKind = 'birth' | 'death' | 'marriage' | 'event';
const FACT_KINDS: readonly FactKind[] = ['birth', 'death', 'marriage', 'event'];

/** A fact's place as the exporter holds it, in the order the .ged writes the facts. */
export interface FactPlaceInput {
  xref: string;
  fact: FactKind;
  type: string | null;
  date: string | null;
  place: string | null;
  placeId: number | null;
}

interface FactRecordInput {
  Id: number;
  events?: Array<{ Type: string; Date: string | null; Place: string | null; PlaceId?: number | null }>;
}

/**
 * Every fact's place in the people and families being exported, keyed by the xref
 * the .ged gives the record. Events keep the order the .ged writes them in.
 */
export function collectFactPlaces(
  people: Array<FactRecordInput & { BirthDate: string | null; BirthPlace: string | null; BirthPlaceId?: number | null; DeathDate: string | null; DeathPlace: string | null; DeathPlaceId?: number | null }>,
  families: Array<FactRecordInput & { MarriageDate: string | null; MarriagePlace: string | null; MarriagePlaceId?: number | null }>,
  personIdToXref: ReadonlyMap<number, string>,
  familyIdToXref: ReadonlyMap<number, string>,
): FactPlaceInput[] {
  const out: FactPlaceInput[] = [];
  const events = (xref: string, record: FactRecordInput) => {
    for (const e of record.events ?? []) {
      out.push({ xref, fact: 'event', type: e.Type, date: e.Date, place: e.Place, placeId: e.PlaceId ?? null });
    }
  };
  for (const p of people) {
    const xref = personIdToXref.get(p.Id);
    if (!xref) continue;
    out.push({ xref, fact: 'birth', type: null, date: p.BirthDate, place: p.BirthPlace, placeId: p.BirthPlaceId ?? null });
    out.push({ xref, fact: 'death', type: null, date: p.DeathDate, place: p.DeathPlace, placeId: p.DeathPlaceId ?? null });
    events(xref, p);
  }
  for (const f of families) {
    const xref = familyIdToXref.get(f.Id);
    if (!xref) continue;
    out.push({ xref, fact: 'marriage', type: null, date: f.MarriageDate, place: f.MarriagePlace, placeId: f.MarriagePlaceId ?? null });
    events(xref, f);
  }
  return out;
}

/** The facts whose place name more than one place has, naming the place by key. */
function ambiguousFacts(places: SidecarPlaceInput[], facts: FactPlaceInput[], keyById: ReadonlyMap<number, string>): SidecarFactPlace[] {
  const countByName = new Map<string, number>();
  for (const p of places) countByName.set(p.Name, (countByName.get(p.Name) ?? 0) + 1);
  const nameById = new Map(places.map((p) => [p.Id, p.Name]));
  const seen = new Map<string, number>();
  const out: SidecarFactPlace[] = [];
  for (const f of facts) {
    if (!f.place) continue;
    const signature = JSON.stringify([f.xref, f.fact, f.type, f.date, f.place]);
    const n = seen.get(signature) ?? 0;
    seen.set(signature, n + 1);
    // Only a fact spelled with its place's own name: an other name is unique.
    if (f.placeId == null || nameById.get(f.placeId) !== f.place) continue;
    if ((countByName.get(f.place) ?? 0) < 2) continue;
    out.push({ xref: f.xref, fact: f.fact, type: f.type, date: f.date, place: f.place, n, key: keyById.get(f.placeId)! });
  }
  return out;
}

/**
 * Builds places.json for export.
 *
 * Exports EVERY row rather than only those with a form/coords/parent. A bare row
 * still carries information the .ged cannot: that the user's gazetteer contains
 * that name at all. Filtering them out would make the round trip lossy in exactly
 * the way this sidecar exists to prevent, and gazetteers are small.
 */
export function buildPlacesSidecar(
  places: SidecarPlaceInput[],
  otherNames: SidecarPlaceNameInput[] = [],
  facts: FactPlaceInput[] = [],
): PlacesSidecar {
  const nameById = new Map<number, string>();
  for (const p of places) nameById.set(p.Id, p.Name);
  const namesById = new Map<number, SidecarPlaceName[]>();
  for (const n of otherNames) {
    const list = namesById.get(n.PlaceId) ?? [];
    list.push({ name: n.Name, language: n.Language ?? null, fromDate: n.FromDate ?? null, toDate: n.ToDate ?? null });
    namesById.set(n.PlaceId, list);
  }

  // Keys by position, not database id, so a re-export of a re-import is identical.
  const keyById = new Map(places.map((p, index) => [p.Id, String(index + 1)]));
  const factPlaces = ambiguousFacts(places, facts, keyById);
  return {
    version: CURRENT_VERSION,
    places: places.map((p) => ({
      key: keyById.get(p.Id)!,
      name: p.Name,
      form: p.Form ?? null,
      latitude: p.Latitude ?? null,
      longitude: p.Longitude ?? null,
      // A dangling ParentId (parent outside this tree, or deleted) degrades to null
      // rather than emitting a name that will not resolve on import.
      parent: p.ParentId === null || p.ParentId === undefined ? null : nameById.get(p.ParentId) ?? null,
      parentKey: p.ParentId != null ? keyById.get(p.ParentId) ?? null : null,
      displayName: p.DisplayName ?? null,
      osmType: p.OsmType ?? null,
      osmId: p.OsmId === null || p.OsmId === undefined ? null : String(p.OsmId),
      ...(p.OsmKind ? { osmKind: p.OsmKind } : {}),
      pinSuppressed: p.PinSuppressed === true,
      ...(namesById.has(p.Id) ? { names: namesById.get(p.Id) } : {}),
    })),
    ...(factPlaces.length > 0 ? { facts: factPlaces } : {}),
  };
}

import { isOsmKind } from '@/lib/places/osm-kind';

const optionalText = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

/** A place's other names, dropping a malformed entry or one that repeats the place's own name. */
function parseNames(raw: unknown[], placeName: string): SidecarPlaceName[] {
  const names: SidecarPlaceName[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.name !== 'string' || !r.name.trim() || r.name === placeName) continue;
    names.push({ name: r.name, language: optionalText(r.language), fromDate: optionalText(r.fromDate), toDate: optionalText(r.toDate) });
  }
  return names;
}

/**
 * Parses and validates a places.json string for import. Throws only on invalid
 * JSON (the caller turns that into a 400). Individual malformed entries are
 * dropped defensively rather than failing the import — ADR 0009's warn-never-reject
 * rule, the same as every other sidecar.
 */
export function parsePlacesSidecar(raw: string): { places: SidecarPlaceEntry[]; facts: SidecarFactPlace[] } {
  const data = JSON.parse(raw) as unknown; // throws on invalid JSON
  const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};

  const places: SidecarPlaceEntry[] = [];
  if (Array.isArray(obj.places)) {
    for (const item of obj.places) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      if (typeof r.name !== 'string' || !r.name.trim()) continue;
      places.push({
        ...(typeof r.key === 'string' && r.key ? { key: r.key } : {}),
        name: r.name,
        form: typeof r.form === 'string' ? r.form : null,
        latitude: typeof r.latitude === 'number' && Number.isFinite(r.latitude) ? r.latitude : null,
        longitude: typeof r.longitude === 'number' && Number.isFinite(r.longitude) ? r.longitude : null,
        parent: typeof r.parent === 'string' && r.parent.trim() ? r.parent : null,
        parentKey: typeof r.parentKey === 'string' && r.parentKey ? r.parentKey : null,
        displayName: typeof r.displayName === 'string' ? r.displayName : null,
        osmType: typeof r.osmType === 'string' ? r.osmType : null,
        // Accept the string we write and the number a hand-edited bundle might carry.
        osmId: typeof r.osmId === 'string' ? r.osmId
          : typeof r.osmId === 'number' ? String(r.osmId) : null,
        ...(typeof r.osmKind === 'string' && isOsmKind(r.osmKind) ? { osmKind: r.osmKind } : {}),
        pinSuppressed: r.pinSuppressed === true || r.pinSuppressed === 1,
        ...(Array.isArray(r.names) ? { names: parseNames(r.names, r.name) } : {}),
      });
    }
  }

  // A key two entries share names neither: the facts and children of it fall back to names.
  const keyCounts = new Map<string, number>();
  for (const p of places) if (p.key) keyCounts.set(p.key, (keyCounts.get(p.key) ?? 0) + 1);
  for (const p of places) if (p.key && keyCounts.get(p.key)! > 1) delete p.key;
  const keys = new Set(places.map((p) => p.key).filter(Boolean));

  const facts: SidecarFactPlace[] = [];
  if (Array.isArray(obj.facts)) {
    for (const item of obj.facts) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      if (typeof r.xref !== 'string' || !r.xref || typeof r.place !== 'string' || !r.place) continue;
      if (!FACT_KINDS.includes(r.fact as FactKind)) continue;
      if (typeof r.key !== 'string' || !keys.has(r.key)) continue;
      const n = typeof r.n === 'number' && Number.isInteger(r.n) && r.n >= 0 ? r.n : 0;
      facts.push({
        xref: r.xref, fact: r.fact as FactKind, type: optionalText(r.type), date: optionalText(r.date),
        place: r.place, n, key: r.key,
      });
    }
  }

  return { places, facts };
}
