/**
 * Coordinates as people type or paste them (#56, Type coordinates): decimal
 * degrees ("51.5072", "-0.1276") or degrees, minutes and seconds
 * ("51°30′26″N", "0 7 39 W"), with N/S/E/W or a minus sign.
 */

type Axis = 'lat' | 'lng';
const LIMIT: Record<Axis, number> = { lat: 90, lng: 180 };

/** One coordinate, or null when it isn't one (or is out of range for its axis). */
export function parseCoordinate(input: string, axis: Axis): number | null {
    const s = input.trim().toUpperCase();
    if (!s) return null;
    const hemis = s.match(/[NSEW]/g) ?? [];
    if (hemis.length > 1) return null;
    const hemi = hemis[0];
    if (hemi && (axis === 'lat') !== (hemi === 'N' || hemi === 'S')) return null;
    // Only digits, separators and degree, minute and second marks are allowed around the numbers.
    if (/[^\d.\s°º'′’"″NSEW+-]/.test(s)) return null;
    const nums = s.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (nums.length === 0 || nums.length > 3) return null;
    const [deg, min = 0, sec = 0] = nums as [number, number?, number?];
    if (nums.length > 1 && (min >= 60 || sec >= 60 || !Number.isInteger(deg))) return null;
    let value = deg + min / 60 + sec / 3600;
    const negative = s.trimStart().startsWith('-') || hemi === 'S' || hemi === 'W';
    if (negative) value = -value;
    if (Math.abs(value) > LIMIT[axis]) return null;
    return value;
}

/**
 * A pasted pair: "51.5072, -0.1276", or "51°30′N 0°7′W" with the hemisphere
 * letters marking the split. Null when the text is a single coordinate.
 */
export function parseCoordinatePair(input: string): { lat: number; lng: number } | null {
    const s = input.trim();
    let parts: string[] | null = null;
    if (s.includes(',')) parts = s.split(',');
    else {
        const m = s.match(/^(.*?[NS])\s*(.+[EW])$/i);
        if (m) parts = [m[1]!, m[2]!];
    }
    if (!parts || parts.length !== 2) return null;
    const lat = parseCoordinate(parts[0]!, 'lat');
    const lng = parseCoordinate(parts[1]!, 'lng');
    return lat != null && lng != null ? { lat, lng } : null;
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const rad = (d: number) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
