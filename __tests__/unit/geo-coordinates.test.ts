import { describe, it, expect } from 'vitest';
import { distanceKm, parseCoordinate, parseCoordinatePair } from '@/lib/geo/coordinates';

// Type coordinates on the place page (#56).
describe('parseCoordinate', () => {
    it('reads decimal degrees and a minus sign', () => {
        expect(parseCoordinate('51.5072', 'lat')).toBe(51.5072);
        expect(parseCoordinate(' -0.1276 ', 'lng')).toBe(-0.1276);
    });

    it('reads degrees, minutes and seconds with a hemisphere', () => {
        expect(parseCoordinate('51°30′26″N', 'lat')).toBeCloseTo(51.5072, 4);
        expect(parseCoordinate('0 7 39 W', 'lng')).toBeCloseTo(-0.1275, 4);
        expect(parseCoordinate("33°52.0'S", 'lat')).toBeCloseTo(-33.8667, 4);
    });

    it('refuses the wrong hemisphere, out of range values and stray text', () => {
        expect(parseCoordinate('51 N', 'lng')).toBeNull();
        expect(parseCoordinate('91', 'lat')).toBeNull();
        expect(parseCoordinate('181', 'lng')).toBeNull();
        expect(parseCoordinate('51 70 0 N', 'lat')).toBeNull();
        expect(parseCoordinate('london', 'lat')).toBeNull();
        expect(parseCoordinate('', 'lat')).toBeNull();
    });
});

describe('parseCoordinatePair', () => {
    it('splits a pasted pair at its comma or its hemisphere letters', () => {
        expect(parseCoordinatePair('51.5072, -0.1276')).toEqual({ lat: 51.5072, lng: -0.1276 });
        const dms = parseCoordinatePair('51°30′26″N 0°7′39″W')!;
        expect(dms.lat).toBeCloseTo(51.5072, 4);
        expect(dms.lng).toBeCloseTo(-0.1275, 4);
    });

    it('is null for one coordinate', () => {
        expect(parseCoordinatePair('51.5072')).toBeNull();
    });
});

describe('distanceKm', () => {
    it('measures London to Paris at about 344 km', () => {
        expect(Math.round(distanceKm({ lat: 51.5072, lng: -0.1276 }, { lat: 48.8566, lng: 2.3522 }))).toBe(344);
    });
});
