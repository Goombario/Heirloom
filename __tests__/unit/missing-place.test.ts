import { describe, expect, it } from 'vitest';
import { isMissingPlace } from '@/app/places/view/missingPlace';
import type { PlaceDetail } from '@/lib/data/types';

const empty: PlaceDetail = {
    name: 'Nowhere', people: [], factLinks: [], eventCounts: [], eventCount: 0, familyCount: 0,
};

describe('isMissingPlace (#697)', () => {
    it('treats a name nothing refers to as missing, so the page never offers to edit it into existence', () => {
        expect(isMissingPlace('Nowhere', empty)).toBe(true);
        expect(isMissingPlace('  ', { ...empty, id: 3 })).toBe(true);
    });

    it('keeps a gazetteer row or any referencing fact', () => {
        expect(isMissingPlace('Boston', { ...empty, id: 3 })).toBe(false);
        expect(isMissingPlace('Boston', { ...empty, eventCount: 1 })).toBe(false);
        expect(isMissingPlace('Boston', { ...empty, familyCount: 1 })).toBe(false);
    });
});
