import { describe, it, expect } from 'vitest';
import { mergeTargetNames } from '@/lib/places/other-names';
import type { PlaceGazetteerNode, PlaceSummary } from '@/lib/data/types';

// #1232: a place with no records of its own is still a place a rename merges into,
// so its name has to be known to the rename field.
describe('mergeTargetNames', () => {
    it('lists places with records and gazetteer-only places once each, without the place itself', () => {
        const places = [{ name: 'Dover' }, { name: 'Kent' }] as PlaceSummary[];
        const gazetteer = [{ name: 'Dover' }, { name: 'Kent' }, { name: 'England' }] as PlaceGazetteerNode[];
        expect(mergeTargetNames({ places, gazetteer }, 'Kent').sort()).toEqual(['Dover', 'England']);
    });
});
