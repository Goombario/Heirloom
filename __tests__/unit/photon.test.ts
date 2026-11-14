import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  searchPlaces, buildCanonicalName, isConfidentMatch, __clearGeocodeCache,
  fetchCandidates, buildHierarchyLevels, chainFromCandidate, resolvePlace, resolvePin, type PinNode,
} from '@/lib/geocode/photon';

const FEATURE = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [1.0789, 51.2802] },
  properties: {
    name: 'Canterbury', city: 'Canterbury', state: 'England',
    country: 'United Kingdom', countrycode: 'GB',
    osm_id: 123, osm_type: 'R',
  },
};

function mockFetchOnce(features: unknown[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ type: 'FeatureCollection', features }),
  });
}

describe('photon geocoder', () => {
  beforeEach(() => { __clearGeocodeCache(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('buildCanonicalName joins unique parts', () => {
    expect(buildCanonicalName(FEATURE.properties)).toBe('Canterbury, England, United Kingdom');
  });

  it('maps Photon GeoJSON to GeocodeResult', async () => {
    vi.stubGlobal('fetch', mockFetchOnce([FEATURE]));
    const results = await searchPlaces('canterbury');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: 'Canterbury, England, United Kingdom',
      lat: 51.2802, lng: 1.0789, osmId: 123, osmType: 'relation', countryCode: 'GB',
    });
  });

  it('returns [] for queries shorter than 3 chars without calling fetch', async () => {
    const fetchMock = mockFetchOnce([FEATURE]);
    vi.stubGlobal('fetch', fetchMock);
    expect(await searchPlaces('ca')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches results so a repeated query hits fetch once', async () => {
    const fetchMock = mockFetchOnce([FEATURE]);
    vi.stubGlobal('fetch', fetchMock);
    await searchPlaces('canterbury');
    await searchPlaces('canterbury');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent identical queries into one fetch', async () => {
    const fetchMock = mockFetchOnce([FEATURE]);
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([searchPlaces('canterbury'), searchPlaces('canterbury')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('buildCanonicalName returns empty string for empty props', () => {
    expect(buildCanonicalName({})).toBe('');
  });

  it('searchPlaces throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(searchPlaces('canterbury')).rejects.toThrow();
  });
});

describe('isConfidentMatch', () => {
  it('rejects a housenumber/street swap even when every token is present', () => {
    // The real Dover/Folkestone bug: querying "67 Folkestone Road, Dover, Kent,
    // England" returns "67 Dover Road, Folkestone" — same tokens, wrong slots.
    const typed = ['67 Folkestone Road', 'Dover', 'Kent', 'England'];
    const candidate = {
      housenumber: '67', street: 'Dover Road',
      city: 'Folkestone', county: 'Kent', state: 'England', country: 'United Kingdom',
    };
    expect(isConfidentMatch(typed, candidate)).toBe(false);
  });

  it('accepts a housenumber/street match with order-flexible trailing segments', () => {
    const typed = ['67 Folkestone Road', 'Dover', 'Kent', 'England'];
    const candidate = {
      housenumber: '67', street: 'Folkestone Road',
      city: 'Dover', county: 'Kent', state: 'England', country: 'United Kingdom',
    };
    expect(isConfidentMatch(typed, candidate)).toBe(true);
  });

  it('is case-insensitive and tolerant of a missing trailing segment', () => {
    const typed = ['67 Folkestone Road', 'DOVER'];
    const candidate = {
      housenumber: '67', street: 'folkestone road',
      city: 'Dover', county: 'Kent', state: 'England', country: 'United Kingdom',
    };
    expect(isConfidentMatch(typed, candidate)).toBe(true);
  });

  it('rejects when the candidate has no housenumber/street at all, but the typed leaf looks like a street', () => {
    const typed = ['67 Folkestone Road', 'Dover'];
    const candidate = { city: 'Dover', county: 'Kent', state: 'England', country: 'United Kingdom' };
    expect(isConfidentMatch(typed, candidate)).toBe(false);
  });

  it('accepts a bare town/city match against the candidate\'s own city — no housenumber ever typed', () => {
    // The dominant genealogy case: most historical places are recorded at
    // town granularity, not a full street address. This must resolve
    // confidently and keep Photon's own town-level point, not be forced
    // through the fallback and lose precision to the county/country level.
    const typed = ['Dover', 'Kent', 'England'];
    const candidate = { name: 'Dover', city: 'Dover', county: 'Kent', state: 'England', country: 'United Kingdom' };
    expect(isConfidentMatch(typed, candidate)).toBe(true);
  });

  it('accepts a single-segment town query with no trailing context at all', () => {
    const typed = ['London'];
    const candidate = { name: 'London', city: 'London', state: 'England', country: 'United Kingdom' };
    expect(isConfidentMatch(typed, candidate)).toBe(true);
  });

  it('still rejects a bare-town query against a wrong city, even with no housenumber on either side', () => {
    const typed = ['Dover', 'Kent', 'England'];
    const candidate = { name: 'Folkestone', city: 'Folkestone', county: 'Kent', state: 'England', country: 'United Kingdom' };
    expect(isConfidentMatch(typed, candidate)).toBe(false);
  });

  it('falls back to candidate.name when a town-level candidate has no city field (e.g. a bare county/country match)', () => {
    const typed = ['Kent', 'England'];
    const candidate = { name: 'Kent', state: 'England', country: 'United Kingdom' };
    expect(isConfidentMatch(typed, candidate)).toBe(true);
  });

  it('returns false for an empty typed-segments array', () => {
    expect(isConfidentMatch([], { housenumber: '1', street: 'A Road' })).toBe(false);
  });
});

describe('fetchCandidates', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns raw props alongside the mapped GeocodeResult', async () => {
    vi.stubGlobal('fetch', mockFetchOnce([FEATURE]));
    const candidates = await fetchCandidates('canterbury');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].props).toEqual(FEATURE.properties);
    expect(candidates[0].result).toMatchObject({ name: 'Canterbury, England, United Kingdom', lat: 51.2802, lng: 1.0789 });
  });
});

describe('buildHierarchyLevels', () => {
  it('builds a root-first chain from structured fields, county included', () => {
    // Live Photon data for "Dover, Kent, England": city is a *state*, one level
    // short of the true country — this is exactly why the chain is built from
    // structured fields, not from re-splitting what the user typed.
    const levels = buildHierarchyLevels({
      city: 'Dover', county: 'Kent', state: 'England', country: 'United Kingdom',
    });
    expect(levels.map((l) => l.name)).toEqual([
      'United Kingdom',
      'England',
      'Kent',
      'Dover, Kent, England, United Kingdom',
    ]);
    expect(levels.every((l) => l.latitude === null && l.longitude === null)).toBe(true);
  });

  it('skips absent levels without leaving gaps', () => {
    const levels = buildHierarchyLevels({ country: 'United Kingdom' });
    expect(levels.map((l) => l.name)).toEqual(['United Kingdom']);
  });

  it('returns an empty array when no admin fields are present', () => {
    expect(buildHierarchyLevels({})).toEqual([]);
  });
});

describe('chainFromCandidate', () => {
  it('appends the leaf with the candidate\'s own coordinates', () => {
    const candidate = {
      props: { city: 'Dover', county: 'Kent', state: 'England', country: 'United Kingdom' },
      result: { name: 'x', displayName: 'x', lat: 51.1048, lng: 1.2416, osmType: null, osmId: null, countryCode: 'GB' },
    };
    const levels = chainFromCandidate(candidate, '67 Folkestone Road, Dover, Kent, England');
    expect(levels).toHaveLength(5);
    expect(levels[3]).toMatchObject({ name: 'Dover, Kent, England, United Kingdom', latitude: null, longitude: null });
    expect(levels[4]).toMatchObject({ name: '67 Folkestone Road, Dover, Kent, England', latitude: 51.1048, longitude: 1.2416 });
  });

  it('a confident own-pin match badges Photon\'s canonical name, not the typed text', async () => {
    // typed "London"; Photon matches at city level, so the LEAF owns the coordinate
    const chain = chainFromCandidate(
      { props: { name: 'London', city: 'London', county: 'Greater London', state: 'England', country: 'United Kingdom' },
        result: { name: 'x', displayName: 'x', lat: 51.5, lng: -0.13, osmType: null, osmId: null, countryCode: 'gb' } },
      'London',
    );
    const leaf = chain[chain.length - 1];
    expect(leaf.name).toBe('London');                                  // Name never rewritten
    expect(leaf.displayName).toBe('London, England, United Kingdom');  // …but the badge has the truth
    expect(chain.map((level) => level.name)).toEqual(['United Kingdom', 'England', 'Greater London', 'London']);
  });

  it('does not make a selected country its own parent and retains OSM provenance', () => {
    const chain = chainFromCandidate(
      { props: { name: 'Canada', country: 'Canada' },
        result: { name: 'Canada', displayName: 'Canada', lat: 56.1, lng: -106.3, osmType: 'relation', osmId: 1428125, countryCode: 'ca' } },
      'Canada',
    );
    expect(chain).toEqual([{ name: 'Canada', latitude: 56.1, longitude: -106.3, displayName: 'Canada', osmType: 'relation', osmId: 1428125, osmKind: 'place/country' }]);
  });

  it('keeps what kind each level is (#45)', () => {
    const chain = chainFromCandidate(
      { props: { name: 'Lakewood Cemetery', city: 'Minneapolis', state: 'Minnesota', country: 'United States', osm_key: 'landuse', osm_value: 'cemetery' },
        result: { name: 'x', displayName: 'x', lat: 44.9, lng: -93.3, osmType: 'way', osmId: 1, countryCode: 'us' } },
      'Lakewood Cemetery, Minneapolis',
    );
    expect(chain.map((l) => l.osmKind)).toEqual(['place/country', 'place/state', 'place/city', 'landuse/cemetery']);
  });

  it('leaves ancestor levels without a displayName — only the leaf carries the canonical name', () => {
    const chain = chainFromCandidate(
      { props: { name: 'London', city: 'London', county: 'Greater London', state: 'England', country: 'United Kingdom' },
        result: { name: 'x', displayName: 'x', lat: 51.5, lng: -0.13, osmType: null, osmId: null, countryCode: 'gb' } },
      'London',
    );
    // Everything above the leaf is scaffold-only: no coords, no displayName.
    for (const level of chain.slice(0, -1)) {
      expect(level.displayName ?? null).toBeNull();
    }
  });
});

describe('resolvePlace', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('confident full-string match: leaf gets its own coordinates, ancestors are scaffold-only', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{
          geometry: { type: 'Point', coordinates: [1.2416, 51.1048] },
          properties: {
            housenumber: '67', street: 'Folkestone Road',
            city: 'Dover', county: 'Kent', state: 'England', country: 'United Kingdom',
          },
        }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const levels = await resolvePlace('67 Folkestone Road, Dover, Kent, England');
    expect(fetchMock).toHaveBeenCalledTimes(1); // confident on the first try — no fallback query
    expect(levels).toHaveLength(5);
    expect(levels[0]).toMatchObject({ name: 'United Kingdom', latitude: null });
    expect(levels[3]).toMatchObject({ name: 'Dover, Kent, England, United Kingdom', latitude: null });
    expect(levels[4]).toMatchObject({ name: '67 Folkestone Road, Dover, Kent, England', latitude: 51.1048, longitude: 1.2416 });
  });

  it('confident bare-town match: the town itself gets its own coordinates, not the county via fallback', async () => {
    // The dominant genealogy case — no street ever typed. Before the fix, this
    // always missed isConfidentMatch (no housenumber/street to compare) and
    // fell through to the fallback loop, discarding Photon's own town-level
    // point and pinning the leaf's inherited ancestor (Kent) instead.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{
          geometry: { type: 'Point', coordinates: [1.2416, 51.1048] },
          properties: { name: 'Dover', city: 'Dover', county: 'Kent', state: 'England', country: 'United Kingdom' },
        }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const levels = await resolvePlace('Dover, Kent, England');
    expect(fetchMock).toHaveBeenCalledTimes(1); // confident on the first try — no fallback query
    const leaf = levels[levels.length - 1];
    expect(leaf).toMatchObject({ name: 'Dover, Kent, England', latitude: 51.1048, longitude: 1.2416 });
  });

  it('no confident match: falls back one segment, leaf keeps its own text with null coords', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        // Full-string query: the real bug — housenumber/street swapped.
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [{
            geometry: { type: 'Point', coordinates: [1.1838, 51.0835] },
            properties: { housenumber: '67', street: 'Dover Road', city: 'Folkestone', county: 'Kent', state: 'England', country: 'United Kingdom' },
          }],
        }),
      })
      .mockResolvedValueOnce({
        // Fallback query "Dover, Kent, England" — resolves cleanly.
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [{
            geometry: { type: 'Point', coordinates: [1.2416, 51.1048] },
            properties: { city: 'Dover', county: 'Kent', state: 'England', country: 'United Kingdom' },
          }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const levels = await resolvePlace('67 Folkestone Road, Dover, Kent, England');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const leaf = levels[levels.length - 1];
    expect(leaf).toEqual({ name: '67 Folkestone Road, Dover, Kent, England', latitude: null, longitude: null, displayName: null });
    const dover = levels.find((l) => l.name.startsWith('Dover'));
    // The matched ancestor carries the canonical name; the structural leaf does not.
    expect(dover).toMatchObject({ latitude: 51.1048, longitude: 1.2416, displayName: 'Dover, England, United Kingdom' });
    expect(leaf.displayName ?? null).toBeNull();
  });

  it('nothing resolves at all: returns just the leaf, null coordinates', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    const levels = await resolvePlace('Nowhere Real, Nonexistentshire');
    expect(levels).toEqual([{ name: 'Nowhere Real, Nonexistentshire', latitude: null, longitude: null }]);
  });

  it('empty query returns an empty array without calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await resolvePlace('   ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('resolvePin', () => {
  function chain(nodes: { name: string; latitude: number | null; longitude: number | null; pinSuppressed?: boolean }[]) {
    // nodes[0] is the leaf, nodes[i+1] is its parent.
    const full: PinNode[] = nodes.map((n) => ({ ...n, pinSuppressed: n.pinSuppressed ?? false }));
    const getParent = (node: PinNode) => {
      const idx = full.indexOf(node);
      return full[idx + 1] ?? null;
    };
    return { leaf: full[0], getParent };
  }

  it('returns the leaf\'s own pin when it has one', () => {
    const { leaf, getParent } = chain([{ name: 'leaf', latitude: 1, longitude: 2 }]);
    // No displayName on the node → falls back to the node's own name; own pin.
    expect(resolvePin(leaf, getParent)).toEqual({ lat: 1, lng: 2, source: 'leaf', displayName: 'leaf', isOwnPin: true });
  });

  it('walks up to the nearest ancestor with coordinates', () => {
    const { leaf, getParent } = chain([
      { name: 'leaf', latitude: null, longitude: null },
      { name: 'town', latitude: null, longitude: null },
      { name: 'county', latitude: 5, longitude: 6 },
    ]);
    // Inherited pin: isOwnPin is false, and displayName falls back to the owner's name.
    expect(resolvePin(leaf, getParent)).toEqual({ lat: 5, lng: 6, source: 'county', displayName: 'county', isOwnPin: false });
  });

  it('reports the pin-owning node\'s displayName when present (own pin)', () => {
    const { leaf, getParent } = chain([
      { name: 'London', latitude: 51.5, longitude: -0.13, displayName: 'London, England, United Kingdom' } as PinNode,
    ]);
    const pin = resolvePin(leaf, getParent);
    expect(pin).toMatchObject({ displayName: 'London, England, United Kingdom', isOwnPin: true, source: 'London' });
  });

  it('resolvePin reports the collapse case honestly (typing "England" is not "United Kingdom")', () => {
    // After ON CONFLICT collapse the leaf IS the state row: it owns the coords itself.
    const nodes: PinNode[] = [
      { name: 'United Kingdom', latitude: null, longitude: null, pinSuppressed: false, displayName: null },
      { name: 'England', latitude: 52.35, longitude: -1.17, pinSuppressed: false, displayName: 'England, United Kingdom' },
    ];
    const pin = resolvePin(nodes[1], (n) => (nodes.indexOf(n) > 0 ? nodes[nodes.indexOf(n) - 1] : null));
    expect(pin).toMatchObject({ displayName: 'England, United Kingdom', isOwnPin: true });
    expect(pin!.displayName).not.toBe('United Kingdom'); // the rejected parent-rule would say this
  });

  it('inherited pin uses the ancestor\'s displayName, and isOwnPin is false', () => {
    const { leaf, getParent } = chain([
      { name: 'leaf', latitude: null, longitude: null } as PinNode,
      { name: 'Dover, Kent, England, United Kingdom', latitude: 51.1, longitude: 1.24, displayName: 'Dover, England, United Kingdom' } as PinNode,
    ]);
    const pin = resolvePin(leaf, getParent);
    expect(pin).toMatchObject({ displayName: 'Dover, England, United Kingdom', isOwnPin: false, source: 'Dover, Kent, England, United Kingdom' });
  });

  it('returns null when the leaf is explicitly suppressed, even with real coordinates', () => {
    const { leaf, getParent } = chain([{ name: 'leaf', latitude: 1, longitude: 2, pinSuppressed: true }]);
    expect(resolvePin(leaf, getParent)).toBeNull();
  });

  it('stops at a suppressed ancestor instead of walking past it', () => {
    const { leaf, getParent } = chain([
      { name: 'leaf', latitude: null, longitude: null },
      { name: 'town', latitude: null, longitude: null, pinSuppressed: true },
      { name: 'county', latitude: 5, longitude: 6 },
    ]);
    expect(resolvePin(leaf, getParent)).toBeNull();
  });

  it('returns null when nothing in the chain has coordinates', () => {
    const { leaf, getParent } = chain([{ name: 'leaf', latitude: null, longitude: null }]);
    expect(resolvePin(leaf, getParent)).toBeNull();
  });
});
