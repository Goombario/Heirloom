/** GEDCOM 5.5.1 PLAC.MAP coordinate helpers (signed hemisphere <-> decimal). */
export function gedcomLatLng(lat: number, lng: number): { lati: string; long: string } {
  const lati = `${lat >= 0 ? 'N' : 'S'}${Math.abs(lat)}`;
  const long = `${lng >= 0 ? 'E' : 'W'}${Math.abs(lng)}`;
  return { lati, long };
}

// A coordinate past the pole or the antimeridian, or a malformed number such as
// "1.2.3", reads as no coordinate rather than an unplottable pin (#867).
function parseHemisphere(s: string, positive: string, negative: string, max: number): number | null {
  const m = new RegExp(`^([${positive}${negative}])\\s*(\\d+(?:\\.\\d*)?|\\.\\d+)$`, 'i').exec(s.trim());
  if (!m) return null;
  const v = Number(m[2]);
  if (!Number.isFinite(v) || v > max) return null;
  return m[1].toUpperCase() === negative ? -v : v;
}

export function parseGedcomLat(s: string): number | null {
  return parseHemisphere(s, 'N', 'S', 90);
}

export function parseGedcomLng(s: string): number | null {
  return parseHemisphere(s, 'E', 'W', 180);
}
