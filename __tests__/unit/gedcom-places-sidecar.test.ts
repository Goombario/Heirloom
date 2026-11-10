import { describe, it, expect } from 'vitest';
import { buildPlacesSidecar, collectFactPlaces, parsePlacesSidecar, type SidecarPlaceInput } from '@/lib/gedcom/places-sidecar';

/**
 * #402 — places.json. GEDCOM 5.5.1 has no PLACE record (the record vocabulary is
 * ged551-2.txt:113-289; PLACE_STRUCTURE at :659 is only ever an event
 * substructure), so a gazetteer row can only reach a .ged by being referenced by a
 * fact — and even then only FORM / MAP / NOTE survive.
 */
const ROWS: SidecarPlaceInput[] = [
  { Id: 1, Name: 'France', Form: 'Country', Latitude: 46.6, Longitude: 2.2, ParentId: null },
  { Id: 2, Name: 'Île-de-France, France', Form: 'Region', Latitude: 48.7, Longitude: 2.5, ParentId: 1 },
  {
    Id: 3, Name: 'Paris, Île-de-France, France', Form: 'City',
    Latitude: 48.8566, Longitude: 2.3522, ParentId: 2,
    DisplayName: 'Paris, France métropolitaine', OsmType: 'relation', OsmId: 7444, PinSuppressed: true,
  },
];

describe('buildPlacesSidecar', () => {
  it('resolves the parent by NAME, since ids are reassigned on every import', () => {
    const out = buildPlacesSidecar(ROWS);
    expect(out.places.map(p => [p.name, p.parent])).toEqual([
      ['France', null],
      ['Île-de-France, France', 'France'],
      ['Paris, Île-de-France, France', 'Île-de-France, France'],
    ]);
  });

  it('carries the fields the .ged has no home for', () => {
    const paris = buildPlacesSidecar(ROWS).places[2];
    expect(paris.displayName).toBe('Paris, France métropolitaine');
    expect(paris.osmType).toBe('relation');
    expect(paris.pinSuppressed).toBe(true);
  });

  // OsmId is a BIGINT, and `pg` hands BIGINT back as a STRING precisely because
  // values above 2^53 cannot survive as JS numbers. Carrying it as a string keeps
  // that intact end to end; emitting a JSON number would silently round it.
  it('emits OsmId as a string, preserving a BIGINT beyond 2^53 exactly', () => {
    expect(buildPlacesSidecar(ROWS).places[2].osmId).toBe('7444');
    const big = '90071992547409911'; // > Number.MAX_SAFE_INTEGER
    expect(buildPlacesSidecar([{ ...ROWS[0], OsmId: big }]).places[0].osmId).toBe(big);
    // The guard is meaningful only because this is NOT what a number would give.
    expect(String(Number(big))).not.toBe(big);
  });

  it('exports rows with no data at all — their existence is the information', () => {
    const bare = buildPlacesSidecar([{ Id: 9, Name: 'Atlantis', Form: null, Latitude: null, Longitude: null, ParentId: null }]);
    expect(bare.places).toHaveLength(1);
    expect(bare.places[0]).toMatchObject({ name: 'Atlantis', form: null, parent: null });
  });

  it('degrades a dangling parent to null rather than emitting an unresolvable name', () => {
    const out = buildPlacesSidecar([{ Id: 2, Name: 'Orphan', Form: null, Latitude: null, Longitude: null, ParentId: 999 }]);
    expect(out.places[0].parent).toBeNull();
  });

  it('stamps version 1', () => {
    expect(buildPlacesSidecar(ROWS).version).toBe(1);
  });
});

describe('other names (#1167, ADR 0031)', () => {
  const names = [
    { PlaceId: 3, Name: 'Lutetia', Language: 'la', FromDate: null, ToDate: '360' },
    { PlaceId: 3, Name: 'Parigi', Language: 'it', FromDate: null, ToDate: null },
  ];

  it('lists each place\'s other names, and adds no field to a place without any', () => {
    const sidecar = buildPlacesSidecar(ROWS, names);
    expect(sidecar.places[2].names).toEqual([
      { name: 'Lutetia', language: 'la', fromDate: null, toDate: '360' },
      { name: 'Parigi', language: 'it', fromDate: null, toDate: null },
    ]);
    expect('names' in sidecar.places[0]).toBe(false);
    expect(buildPlacesSidecar(ROWS).places.some((p) => 'names' in p)).toBe(false);
  });

  it('round-trips them, dropping a malformed name or one that repeats the place\'s own', () => {
    const sidecar = buildPlacesSidecar(ROWS, names);
    expect(parsePlacesSidecar(JSON.stringify(sidecar)).places).toEqual(sidecar.places);
    const raw = JSON.stringify({ version: 1, places: [{ name: 'Paris', names: [{ name: 'Paris' }, { name: '' }, 7, { name: 'Lutèce', language: ' ' }] }] });
    expect(parsePlacesSidecar(raw).places[0].names).toEqual([{ name: 'Lutèce', language: null, fromDate: null, toDate: null }]);
  });
});

describe('parsePlacesSidecar', () => {
  it('round-trips what build produces', () => {
    const built = buildPlacesSidecar(ROWS);
    expect(parsePlacesSidecar(JSON.stringify(built)).places).toEqual(built.places);
  });

  it('throws only on invalid JSON (the caller turns that into a 400)', () => {
    expect(() => parsePlacesSidecar('{ not json')).toThrow();
  });

  // ADR 0009: warn, never reject. A malformed entry is dropped; the rest import.
  it('drops malformed entries instead of failing the import', () => {
    const raw = JSON.stringify({
      version: 1,
      places: [
        { name: 'Good', form: 'City' },
        { form: 'City' },          // no name
        { name: '   ' },           // blank name
        null,
        'not an object',
        { name: 'Also good' },
      ],
    });
    expect(parsePlacesSidecar(raw).places.map(p => p.name)).toEqual(['Good', 'Also good']);
  });

  it('tolerates a missing places array entirely', () => {
    expect(parsePlacesSidecar(JSON.stringify({ version: 2 })).places).toEqual([]);
  });

  it('rejects non-finite coordinates rather than storing NaN', () => {
    const raw = JSON.stringify({ places: [{ name: 'X', latitude: 'abc', longitude: null }] });
    const p = parsePlacesSidecar(raw).places[0];
    expect(p.latitude).toBeNull();
    expect(p.longitude).toBeNull();
  });

  it('accepts a numeric osmId and a 0/1 pinSuppressed from a hand-edited bundle', () => {
    const raw = JSON.stringify({ places: [{ name: 'X', osmId: 7444, pinSuppressed: 1 }] });
    const p = parsePlacesSidecar(raw).places[0];
    expect(p.osmId).toBe('7444');
    expect(p.pinSuppressed).toBe(true);
  });
});

describe('places that share a name (#1186)', () => {
  const PLACES: SidecarPlaceInput[] = [
    { Id: 10, Name: 'Paris', Form: null, Latitude: 48.85, Longitude: 2.35, ParentId: null },
    { Id: 20, Name: 'Paris', Form: null, Latitude: 43.2, Longitude: -80.38, ParentId: 30 },
    { Id: 30, Name: 'Ontario', Form: null, Latitude: null, Longitude: null, ParentId: null },
  ];

  it('keys each place by position and names its parent by key', () => {
    const sidecar = buildPlacesSidecar(PLACES);
    expect(sidecar.places.map((p) => [p.key, p.parentKey])).toEqual([['1', null], ['2', '3'], ['3', null]]);
    expect(sidecar).not.toHaveProperty('facts');
  });

  it('maps only the facts whose place name two places share', () => {
    const facts = collectFactPlaces(
      [{ Id: 1, BirthDate: '1900', BirthPlace: 'Paris', BirthPlaceId: 20, DeathDate: null, DeathPlace: 'Ontario', DeathPlaceId: 30,
        events: [{ Type: 'RESI', Date: '1920', Place: 'Paris', PlaceId: 10 }, { Type: 'RESI', Date: '1920', Place: 'Paris', PlaceId: 20 }] }],
      [], new Map([[1, '@I1@']]), new Map(),
    );
    expect(buildPlacesSidecar(PLACES, [], facts).facts).toEqual([
      { xref: '@I1@', fact: 'birth', type: null, date: '1900', place: 'Paris', n: 0, key: '2' },
      { xref: '@I1@', fact: 'event', type: 'RESI', date: '1920', place: 'Paris', n: 0, key: '1' },
      { xref: '@I1@', fact: 'event', type: 'RESI', date: '1920', place: 'Paris', n: 1, key: '2' },
    ]);
  });

  it('round-trips keys and facts, dropping a fact whose place key is unknown', () => {
    const raw = JSON.stringify({
      places: [{ key: '1', name: 'Paris' }, { key: '2', name: 'Paris', parentKey: '3' }],
      facts: [
        { xref: '@I1@', fact: 'birth', type: null, date: '1900', place: 'Paris', n: 0, key: '2' },
        { xref: '@I1@', fact: 'birth', place: 'Paris', key: '9' },
        { xref: '@I1@', fact: 'burial', place: 'Paris', key: '1' },
      ],
    });
    const parsed = parsePlacesSidecar(raw);
    expect(parsed.places.map((p) => [p.key, p.parentKey])).toEqual([['1', null], ['2', '3']]);
    expect(parsed.facts).toEqual([{ xref: '@I1@', fact: 'birth', type: null, date: '1900', place: 'Paris', n: 0, key: '2' }]);
  });

  it('forgets a key two entries share', () => {
    const raw = JSON.stringify({ places: [{ key: '1', name: 'Paris' }, { key: '1', name: 'Lyon' }], facts: [{ xref: '@I1@', fact: 'birth', place: 'Paris', key: '1' }] });
    const parsed = parsePlacesSidecar(raw);
    expect(parsed.places.map((p) => p.key)).toEqual([undefined, undefined]);
    expect(parsed.facts).toEqual([]);
  });
});
