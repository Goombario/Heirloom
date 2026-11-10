import { describe, it, expect } from 'vitest';
import { gateOverwriteImport } from '@/lib/gedcom/overwrite-gate';
import type { TreeCounts } from '@/lib/data/types';

const EMPTY: TreeCounts = {
    people: 0, families: 0, events: 0, media: 0, cases: 0,
    places: 0, sources: 0, repositories: 0, notes: 0, citations: 0,
    dataCheckConfirmations: 0,
};

describe('gateOverwriteImport', () => {
    it('skips the confirmation on a wholly empty tree — there is nothing to destroy', () => {
        expect(gateOverwriteImport(EMPTY)).toEqual({ action: 'proceed' });
    });

    it('confirms with counts when the tree holds people', () => {
        expect(gateOverwriteImport({ ...EMPTY, people: 13, families: 4 })).toEqual({
            action: 'confirm',
            counts: { people: 13, families: 4 },
        });
    });

    it('confirms with counts when the tree holds families but no people', () => {
        expect(gateOverwriteImport({ ...EMPTY, families: 3 })).toEqual({
            action: 'confirm',
            counts: { people: 0, families: 3 },
        });
    });

    // The overwrite DELETE block clears all of these, so a tree holding nothing
    // else still has something to lose and must still confirm. Skipping the
    // confirm for any of them would be silent data loss.
    it.each([
        ['library media', { media: 5 }],
        ['cases', { cases: 1 }],
        ['sources', { sources: 2 }],
        ['events', { events: 7 }],
        ['a geocoded places gazetteer', { places: 9 }],
        ['standalone repositories', { repositories: 3 }],
        ['notes', { notes: 4 }],
        ['citations', { citations: 6 }],
    ])('confirms without counts when the tree holds only %s', (_label, overrides) => {
        expect(gateOverwriteImport({ ...EMPTY, ...overrides })).toEqual({
            action: 'confirm',
            counts: null,
        });
    });

    it('confirms without counts when the live counts could not be read', () => {
        // Fail-safe: an unreadable tree must never be treated as an empty one, or a
        // transient error would silently drop the last guard before a wipe.
        expect(gateOverwriteImport(null)).toEqual({ action: 'confirm', counts: null });
    });

    it('confirms rather than proceeds on a nonsensical negative count', () => {
        // -1 is impossible from a COUNT(*); if it ever appears, something is wrong —
        // and "something is wrong" must never resolve to "wipe without asking".
        expect(gateOverwriteImport({ ...EMPTY, people: -1 })).toEqual({
            action: 'confirm',
            counts: null,
        });
    });

    it('confirms on a NaN count rather than treating it as empty', () => {
        expect(gateOverwriteImport({ ...EMPTY, media: NaN })).toEqual({
            action: 'confirm',
            counts: null,
        });
    });

    // A table added to TreeCounts later must participate in the emptiness test
    // without anyone remembering to update this function.
    it('confirms on an unknown nonzero count field', () => {
        const withFutureTable = { ...EMPTY, submitters: 2 } as unknown as TreeCounts;
        expect(gateOverwriteImport(withFutureTable)).toEqual({ action: 'confirm', counts: null });
    });
});
