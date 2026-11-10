import { describe, it, expect } from 'vitest';
import { markBatchDuplicates, applyTreeMatches, distinctHashes } from '@/app/components/upload/duplicate-scan';

const row = (id: string, hash: string | null) => ({ id, hash });

describe('markBatchDuplicates', () => {
    it('keeps the first occurrence and flags later ones', () => {
        expect(markBatchDuplicates([row('a', 'h1'), row('b', 'h2'), row('c', 'h1')]))
            .toEqual({ c: 'in-batch' });
    });

    it('flags nothing when every hash is distinct', () => {
        expect(markBatchDuplicates([row('a', 'h1'), row('b', 'h2')])).toEqual({});
    });

    it('flags every repeat, not only the second', () => {
        expect(markBatchDuplicates([row('a', 'h1'), row('b', 'h1'), row('c', 'h1')]))
            .toEqual({ b: 'in-batch', c: 'in-batch' });
    });

    it('ignores rows whose hash is not computed yet', () => {
        expect(markBatchDuplicates([row('a', null), row('b', null)])).toEqual({});
    });
});

describe('applyTreeMatches', () => {
    it('maps a match onto every row sharing that hash', () => {
        expect(applyTreeMatches(
            [row('a', 'h1'), row('b', 'h1'), row('c', 'h2')],
            [{ hash: 'h1', mediaId: 7, title: 'Wedding portrait', reason: 'in-tree' as const }],
        )).toEqual({
            a: { kind: 'in-tree', title: 'Wedding portrait' },
            b: { kind: 'in-tree', title: 'Wedding portrait' },
        });
    });

    it('carries a null title through rather than inventing one', () => {
        expect(applyTreeMatches(
            [row('a', 'h1')],
            [{ hash: 'h1', mediaId: 7, title: null, reason: 'in-tree' as const }],
        )).toEqual({ a: { kind: 'in-tree', title: null } });
    });

    it('returns nothing when there are no matches', () => {
        expect(applyTreeMatches([row('a', 'h1')], [])).toEqual({});
    });
});

describe('distinctHashes', () => {
    it('collapses repeats so one hash is asked about once', () => {
        expect(distinctHashes([row('a', 'h1'), row('b', 'h1'), row('c', 'h2')]))
            .toEqual(['h1', 'h2']);
    });

    it('drops rows with no hash', () => {
        expect(distinctHashes([row('a', null), row('b', 'h1')])).toEqual(['h1']);
    });
});
