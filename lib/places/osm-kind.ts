// What kind of place a geocoder match is (#45, ADR 0050), stored as OSM's `key/value`
// tag ("place/city"). Only the tags below have a label; any other is stored but not
// shown, since a raw OSM tag means nothing to a reader.

/** A plausible OSM `key/value` tag; anything else is not stored. */
export function isOsmKind(value: string): boolean {
  return /^[a-z_]{1,32}\/[a-z0-9_:;-]{1,64}$/.test(value);
}

/** The `placeKinds` message key for each tag that has a label. */
const LABELS: Record<string, OsmKindLabel> = {
  'place/country': 'country',
  'place/state': 'state',
  'place/province': 'province',
  'place/region': 'region',
  'place/county': 'county',
  'place/district': 'district',
  'place/municipality': 'municipality',
  'place/city': 'city',
  'place/town': 'town',
  'place/village': 'village',
  'place/hamlet': 'hamlet',
  'place/isolated_dwelling': 'hamlet',
  'place/farm': 'farm',
  'place/borough': 'borough',
  'place/suburb': 'suburb',
  'place/quarter': 'neighbourhood',
  'place/neighbourhood': 'neighbourhood',
  'place/island': 'island',
  'place/locality': 'locality',
  'landuse/cemetery': 'cemetery',
  'amenity/grave_yard': 'cemetery',
  'amenity/place_of_worship': 'place_of_worship',
  'building/church': 'church',
  'building/cathedral': 'church',
  'building/chapel': 'church',
  'amenity/hospital': 'hospital',
  'amenity/school': 'school',
  'building/house': 'house',
  'place/house': 'house',
};

export type OsmKindLabel =
  | 'country' | 'state' | 'province' | 'region' | 'county' | 'district' | 'municipality'
  | 'city' | 'town' | 'village' | 'hamlet' | 'farm' | 'borough' | 'suburb' | 'neighbourhood'
  | 'island' | 'locality' | 'cemetery' | 'place_of_worship' | 'church' | 'hospital' | 'school' | 'house';

/** The label key for a stored tag, or null when it has none. */
export function osmKindLabel(kind: string | null | undefined): OsmKindLabel | null {
  return kind ? LABELS[kind] ?? null : null;
}
