import { describe, it, expect } from 'vitest';
import { factTally } from '@/app/places/factTally';
import type { PlaceFactLinkEntry } from '@/lib/data/types';

const link = (kind: PlaceFactLinkEntry['kind'], eventType: string | null = null): PlaceFactLinkEntry => ({
    personId: 1, name: 'A', sex: null, primaryMediaId: null, focalX: null, focalY: null, focalRadius: null,
    kind, eventType, date: null, placeName: 'X', recordId: 1, placeId: 1,
});

// The place page's What happened here and Explore's Records here (#56).
describe('factTally', () => {
    it('counts births and deaths beside events and marriages, most first', () => {
        expect(factTally([link('death'), link('birth'), link('birth'), link('marriage'), link('event', 'RESI')])).toEqual([
            { type: 'BIRT', count: 2 },
            { type: 'DEAT', count: 1 },
            { type: 'MARR', count: 1 },
            { type: 'RESI', count: 1 },
        ]);
    });

    it('files an event with no type under EVEN', () => {
        expect(factTally([link('event')])).toEqual([{ type: 'EVEN', count: 1 }]);
    });
});
