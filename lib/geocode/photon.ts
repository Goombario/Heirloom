/**
 * Thin client for the Photon geocoder (https://photon.komoot.io) — no API key,
 * CORS-enabled, autocomplete-native. Pure module (no React); the React layer owns
 * debounce + AbortController. This module owns query caching + request coalescing
 * so the same query never hits the network twice in a session.
 */

export interface GeocodeResult {
  name: string;          // canonical, human-readable — becomes the field value
  displayName: string;   // same as name today; kept distinct for future tooltips
  lat: number;
  lng: number;
  osmType: 'node' | 'way' | 'relation' | null;
  osmId: number | null;
  countryCode: string | null;
  /** What the match is, as OSM's `key/value` ("place/city", "landuse/cemetery"; #45). */
  osmKind?: string | null;
}

export interface PhotonProps {
  name?: string; street?: string; city?: string; county?: string;
  state?: string; country?: string; countrycode?: string;
  housenumber?: string;
  osm_id?: number; osm_type?: string;
  /** The OSM tag the match comes from: `place` + `city`, `landuse` + `cemetery`, … */
  osm_key?: string; osm_value?: string;
}

const PHOTON_URL = 'https://photon.komoot.io/api/';
const MIN_QUERY_LEN = 3;
const CACHE_MAX = 100;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SS_KEY = 'photonCacheV1';

type CacheEntry = { at: number; results: GeocodeResult[] };
const memCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<GeocodeResult[]>>();

function normKey(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** A match's `key/value` OSM tag, or null when Photon left either out (#45). */
function osmKindOf(p: PhotonProps): string | null {
  return p.osm_key && p.osm_value ? `${p.osm_key}/${p.osm_value}` : null;
}

function osmTypeFromCode(code?: string): GeocodeResult['osmType'] {
  if (code === 'N') return 'node';
  if (code === 'W') return 'way';
  if (code === 'R') return 'relation';
  return null;
}

export interface HierarchyLevel {
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** The geocoder's canonical name for THIS level's own pin (e.g. "London,
   *  England, United Kingdom"). Only set on the level that actually owns a
   *  coordinate; structural ancestors leave it null. */
  displayName?: string | null;
  osmType?: GeocodeResult['osmType'];
  osmId?: number | null;
  /** What kind of place this level is, as OSM's `key/value` (#45). */
  osmKind?: string | null;
}

export interface PhotonCandidate {
  props: PhotonProps;
  result: GeocodeResult;
}

/**
 * Raw candidates with structured props intact — searchPlaces() maps straight to
 * GeocodeResult and discards city/county/state/country/housenumber, which
 * resolvePlace() and the Edit-popover picker both need. Deliberately NOT wired
 * into searchPlaces()'s cache/coalescing layers: those exist to cheapen the
 * autosuggest dropdown's per-keystroke calls, a concern this function doesn't
 * share (it's called once per debounced resolve, not once per keystroke).
 */
export async function fetchCandidates(
  query: string,
  opts?: { signal?: AbortSignal; limit?: number }
): Promise<PhotonCandidate[]> {
  const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=${opts?.limit ?? 5}`;
  const res = await fetch(url, { signal: opts?.signal });
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
  const data = (await res.json()) as { features?: { geometry: { coordinates: [number, number] }; properties: PhotonProps }[] };
  return (data.features ?? [])
    .map((f) => {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      const name = buildCanonicalName(p);
      const result: GeocodeResult = {
        name, displayName: name, lat, lng,
        osmType: osmTypeFromCode(p.osm_type),
        osmId: p.osm_id ?? null,
        countryCode: p.countrycode ?? null,
        osmKind: osmKindOf(p),
      };
      return { props: p, result };
    })
    .filter((c) => c.result.name.length > 0);
}

/** De-duplicating, case-insensitive join — same rule buildCanonicalName uses. */
function breadcrumb(...parts: (string | undefined)[]): string {
  const cleaned = parts.filter((x): x is string => !!x && x.trim().length > 0).map((x) => x.trim());
  const seen = new Set<string>();
  const unique = cleaned.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return unique.join(', ');
}

/**
 * Root-first jurisdiction chain built from Photon's *structured* response fields
 * (§5 of the design spec) — never from re-splitting the typed string, which would
 * misfile a state as a country or miss the true country entirely (Photon's own
 * reply for "Dover, Kent, England" names England as a *state*, one level short of
 * "United Kingdom"). Coordinates are always null here — only the level that was
 * actually matched gets a real point; ancestors above it are structural only
 * (resolvePin's walk-up, Task 5, handles finding the nearest real coordinate).
 * County is included on purpose — buildCanonicalName() (the flat leaf-display
 * string) deliberately omits it; this is a different, hierarchy-only purpose.
 *
 * Deliberate asymmetry: country/state/county are named bare ("Kent", not
 * "Kent, England, United Kingdom") to match the approved design mockups —
 * only the city level is fully qualified. This is an intentional tradeoff,
 * not an oversight: a bare ancestor name can in principle collide across two
 * genuinely different real-world places sharing a name (a "Kent, Ohio" would
 * fold into "Kent, England" via the (UserId, Name) upsert if both ever
 * appeared in the same tree) — accepted because a personal single-user tree
 * realistically spans one place's history, and the city level, which is far
 * more collision-prone in practice, already carries full context.
 */
export function buildHierarchyLevels(p: PhotonProps): HierarchyLevel[] {
  const levels: HierarchyLevel[] = [];
  // Each level's kind is the field Photon filed it under (#45).
  if (p.country) levels.push({ name: breadcrumb(p.country), latitude: null, longitude: null, osmKind: 'place/country' });
  if (p.state) levels.push({ name: breadcrumb(p.state), latitude: null, longitude: null, osmKind: 'place/state' });
  if (p.county) levels.push({ name: breadcrumb(p.county), latitude: null, longitude: null, osmKind: 'place/county' });
  if (p.city) levels.push({ name: breadcrumb(p.city, p.county, p.state, p.country), latitude: null, longitude: null, osmKind: 'place/city' });
  return levels;
}

/** buildHierarchyLevels() plus a final leaf entry carrying the candidate's own
 *  point — used both for a confident full-string match (resolvePlace) and an
 *  explicit Edit-popover pick, which always becomes the leaf's own coordinate. */
export function chainFromCandidate(candidate: PhotonCandidate, leafName: string): HierarchyLevel[] {
  const levels = buildHierarchyLevels(candidate.props);
  // A country, state, county, or city can itself be the selected place. Do not
  // insert that same gazetteer row twice and make it its own parent.
  const leafLabel = leafName.split(',')[0]?.trim().toLowerCase();
  const lastLabel = levels.at(-1)?.name.split(',')[0]?.trim().toLowerCase();
  const selectedLevel = leafLabel && leafLabel === lastLabel ? levels.pop() : undefined;
  levels.push({
    name: leafName,
    latitude: candidate.result.lat,
    longitude: candidate.result.lng,
    displayName: buildCanonicalName(candidate.props) || null,
    osmType: candidate.result.osmType,
    osmId: candidate.result.osmId,
    // A match Photon gave no tag keeps the kind its own level had (#45).
    osmKind: osmKindOf(candidate.props) ?? selectedLevel?.osmKind ?? null,
  });
  return levels;
}

/**
 * The full hierarchy-rollup resolution (§5 of the design spec): try the full
 * typed string; if no candidate passes isConfidentMatch, fall back one comma
 * segment at a time (dropping the leftmost/most-specific) until something
 * resolves or segments run out. The leaf (the original full string) is always
 * the last entry, with its own coordinates only when the full-string query
 * itself was confident — otherwise it inherits nothing here (that's resolvePin's
 * job at read time), it's just a name with null coordinates.
 */
export async function resolvePlace(
  fullQuery: string,
  opts?: { signal?: AbortSignal }
): Promise<HierarchyLevel[]> {
  const trimmedFull = fullQuery.trim();
  if (!trimmedFull) return [];
  const segments = trimmedFull.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (segments.length === 0) return [];

  const fullCandidates = await fetchCandidates(trimmedFull, opts);
  const confident = fullCandidates.find((c) => isConfidentMatch(segments, c.props));
  if (confident) {
    return chainFromCandidate(confident, trimmedFull);
  }

  for (let drop = 1; drop < segments.length; drop++) {
    const remaining = segments.slice(drop).join(', ');
    const candidates = await fetchCandidates(remaining, opts);
    const top = candidates[0];
    if (top) {
      const levels = buildHierarchyLevels(top.props);
      if (levels.length > 0) {
        const matched = levels[levels.length - 1];
        levels[levels.length - 1] = {
          ...matched,
          latitude: top.result.lat,
          longitude: top.result.lng,
          displayName: buildCanonicalName(top.props) || null,
          osmKind: osmKindOf(top.props) ?? matched.osmKind,
        };
      }
      levels.push({ name: trimmedFull, latitude: null, longitude: null, displayName: null });
      return levels;
    }
  }

  return [{ name: trimmedFull, latitude: null, longitude: null }];
}

export function buildCanonicalName(p: PhotonProps): string {
  const parts = [p.name ?? p.street, p.city, p.state, p.country]
    .filter((x): x is string => !!x && x.trim().length > 0);
  // De-duplicate consecutive/repeat parts (e.g. name === city === 'Canterbury').
  const seen = new Set<string>();
  const unique = parts.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return unique.join(', ');
}

/**
 * Position-based confidence check (docs/superpowers/specs/2026-07-09-places-
 * precision-hierarchy-design.md §4) — NOT the same as "every token is present
 * somewhere," which is what let a housenumber/street swap through in the first
 * place. The leftmost typed segment (street/house) must match the candidate's
 * housenumber+street exactly; later segments (city/county/state/country) just
 * need to appear somewhere among the candidate's own fields, order-flexible.
 */
export function isConfidentMatch(typedSegments: string[], candidate: PhotonProps): boolean {
  if (typedSegments.length === 0) return false;
  const leaf = typedSegments[0].trim().toLowerCase();

  // The leaf must match whatever field is in the SAME semantic role the
  // candidate actually resolved at. A street/house-level candidate compares
  // against housenumber+street (this is what catches the housenumber/street
  // swap bug — a city-level candidate could never satisfy this, so it can't
  // slip through here). A candidate with no housenumber/street at all is
  // itself only resolving at town/city granularity, so the leaf is compared
  // against the candidate's own city/name instead — this is what lets a bare
  // "Dover, Kent, England" (no street component was ever typed) confidently
  // claim Photon's own town-level point, instead of always falling back and
  // discarding the coordinate Photon already returned for exactly this query.
  const hasStreetLevel = !!(candidate.housenumber || candidate.street);
  const returnedLeaf = hasStreetLevel
    ? `${candidate.housenumber ?? ''} ${candidate.street ?? ''}`.trim().toLowerCase()
    : (candidate.city ?? candidate.name ?? '').trim().toLowerCase();
  if (!returnedLeaf || leaf !== returnedLeaf) return false;

  const rest = typedSegments.slice(1).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
  const haystack = [candidate.city, candidate.county, candidate.state, candidate.country]
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase());
  return rest.every((seg) => haystack.some((h) => h.includes(seg)));
}

function readSessionCache(key: string): GeocodeResult[] | undefined {
  if (typeof sessionStorage === 'undefined') return undefined;
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return undefined;
    const obj = JSON.parse(raw) as Record<string, CacheEntry>;
    const entry = obj[key];
    if (entry && Date.now() - entry.at < CACHE_TTL_MS) return entry.results;
  } catch { /* ignore corrupt cache */ }
  return undefined;
}

function writeSessionCache(key: string, results: GeocodeResult[]): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    const obj: Record<string, CacheEntry> = raw ? JSON.parse(raw) : {};
    obj[key] = { at: Date.now(), results };
    const keys = Object.keys(obj);
    // FIFO insertion-order eviction — drop oldest key when at capacity.
    if (keys.length >= CACHE_MAX) delete obj[keys[0]];
    sessionStorage.setItem(SS_KEY, JSON.stringify(obj));
  } catch { /* quota/serialize errors are non-fatal */ }
}

export async function searchPlaces(
  query: string,
  opts?: { signal?: AbortSignal; limit?: number }
): Promise<GeocodeResult[]> {
  const key = normKey(query);
  if (key.length < MIN_QUERY_LEN) return [];

  const mem = memCache.get(key);
  if (mem && Date.now() - mem.at < CACHE_TTL_MS) return mem.results;

  const ss = readSessionCache(key);
  if (ss) { memCache.set(key, { at: Date.now(), results: ss }); return ss; }

  // Request coalescing: a second caller joining an in-flight request shares the
  // original request's lifecycle — its `signal` does not abort the fetch.
  // This is acceptable because the React layer discards stale results by
  // checking the current query value, not by relying on abort.
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=${opts?.limit ?? 5}`;
    const res = await fetch(url, { signal: opts?.signal });
    if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
    const data = (await res.json()) as { features?: { geometry: { coordinates: [number, number] }; properties: PhotonProps }[] };
    const results: GeocodeResult[] = (data.features ?? []).map((f) => {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      const name = buildCanonicalName(p);
      return {
        name, displayName: name, lat, lng,
        osmType: osmTypeFromCode(p.osm_type),
        osmId: p.osm_id ?? null,
        countryCode: p.countrycode ?? null,
        osmKind: osmKindOf(p),
      };
    }).filter((r) => r.name.length > 0);

    // FIFO insertion-order eviction — drop oldest entry when at capacity.
    if (memCache.size >= CACHE_MAX) memCache.delete(memCache.keys().next().value as string);
    memCache.set(key, { at: Date.now(), results });
    writeSessionCache(key, results);
    return results;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}

/** TEST ONLY: reset in-memory caches between tests. */
export function __clearGeocodeCache(): void {
  memCache.clear();
  inFlight.clear();
}

export interface PinNode {
  name: string;
  latitude: number | null;
  longitude: number | null;
  pinSuppressed: boolean;
  /** The geocoder's canonical name for this node's own pin, when it has one. */
  displayName?: string | null;
}

export interface ResolvedPin {
  lat: number;
  lng: number;
  /** The raw name of the node the pin actually came from — the leaf itself, or
   *  an inherited ancestor. Kept for tests/diagnostics; the badge uses
   *  `displayName`, not this. */
  source: string;
  /** The badge's "Map pinned to <displayName>" text: the pin-owning node's
   *  canonical name, falling back to its own `name` when none was recorded. */
  displayName: string;
  /** True when the pin came from the node the walk started at (own pin) rather
   *  than an inherited ancestor. Drives the marker shape (solid dot vs dashed
   *  diamond) — replaces the fragile `source === typedText` comparison. */
  isOwnPin: boolean;
}

/**
 * Storage-agnostic walk-up: the same algorithm serves the client (walking a
 * plain HierarchyLevel[] array before anything is saved) and, in a later plan,
 * the server (walking real ParentId rows). A suppressed node — explicit "no pin,
 * ever" — stops the walk even if it or an ancestor beyond it has coordinates.
 */
export function resolvePin(start: PinNode, getParent: (node: PinNode) => PinNode | null): ResolvedPin | null {
  let node: PinNode | null = start;
  while (node) {
    if (node.pinSuppressed) return null;
    if (node.latitude != null && node.longitude != null) {
      return {
        lat: node.latitude,
        lng: node.longitude,
        source: node.name,
        displayName: node.displayName ?? node.name,
        isOwnPin: node === start,
      };
    }
    node = getParent(node);
  }
  return null;
}
