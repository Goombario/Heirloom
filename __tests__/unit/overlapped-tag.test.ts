import { describe, expect, it } from 'vitest';
import { overlappedTag, type LightboxTag } from '@/app/components/lightbox/types';

const tag = (Id: number, RegionX: number, RegionY: number, RegionW: number, RegionH: number) =>
    ({ Id, PersonId: Id, RegionX, RegionY, RegionW, RegionH }) as LightboxTag;

// #802 (MD-1): a second person on the same face region is the mistake to warn about.
describe('overlappedTag', () => {
    const existing = [tag(1, 10, 10, 20, 20)];

    it('finds a tag covering more than half the new box', () => {
        expect(overlappedTag({ RegionX: 10, RegionY: 10, RegionW: 20, RegionH: 20 }, existing)?.Id).toBe(1);
        expect(overlappedTag({ RegionX: 15, RegionY: 12, RegionW: 20, RegionH: 20 }, existing)?.Id).toBe(1);
    });

    it('ignores a box that only grazes a neighbour', () => {
        expect(overlappedTag({ RegionX: 25, RegionY: 10, RegionW: 20, RegionH: 20 }, existing)).toBeUndefined();
        expect(overlappedTag({ RegionX: 50, RegionY: 50, RegionW: 10, RegionH: 10 }, existing)).toBeUndefined();
    });

    it('ignores tags without a region, and an empty box', () => {
        expect(overlappedTag({ RegionX: 10, RegionY: 10, RegionW: 20, RegionH: 20 }, [tag(2, 0, 0, 0, 0)])).toBeUndefined();
        expect(overlappedTag({ RegionX: 10, RegionY: 10, RegionW: 0, RegionH: 0 }, existing)).toBeUndefined();
    });
});
