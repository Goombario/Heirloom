import { describe, it, expect } from 'vitest';
import { axisParts, decadeBlocks, lanes, placeRecords } from '@/app/places/view/desktop/placeRecords';
import type { PlaceFactLinkEntry } from '@/lib/data/types';

let seq = 0;
const link = (over: Partial<PlaceFactLinkEntry>): PlaceFactLinkEntry => ({
    personId: 1, name: 'Anna', sex: 'F', primaryMediaId: null, focalX: null, focalY: null, focalRadius: null,
    kind: 'event', eventType: 'RESI', date: null, placeName: 'Here', recordId: ++seq, placeId: 1, ...over,
});

// What happened here on the place page (#56).
describe('placeRecords', () => {
    it('puts both partners of a marriage on one record, dated first and undated last', () => {
        const recs = placeRecords([
            link({ kind: 'event', date: null }),
            link({ kind: 'marriage', recordId: 900, personId: 1, date: '1901' }),
            link({ kind: 'marriage', recordId: 900, personId: 2, name: 'Erik', date: '1901' }),
            link({ kind: 'birth', recordId: 1, date: 'ABT 1880' }),
        ]);
        expect(recs.map((r) => [r.type, r.year, r.people.length])).toEqual([['BIRT', 1880, 1], ['MARR', 1901, 2], ['RESI', null, 1]]);
    });
});

describe('decadeBlocks', () => {
    it('folds empty decades onto one quiet stretch', () => {
        const recs = placeRecords([link({ date: '1801' }), link({ date: '1835' })]);
        expect(decadeBlocks(recs).map((b) => (b.kind === 'decade' ? b.decade : `${b.from}-${b.to}`))).toEqual([1800, '1810-1820', 1830]);
    });

    it('in a long chronicle, folds decades with one or two records behind Show N', () => {
        const recs = placeRecords([
            ...Array.from({ length: 12 }, () => link({ date: '1900' })),
            link({ date: '1915' }),
            ...Array.from({ length: 3 }, () => link({ date: '1920' })),
        ]);
        const blocks = decadeBlocks(recs);
        expect(blocks.map((b) => b.kind)).toEqual(['decade', 'quiet', 'decade']);
        expect(blocks[1]!.records).toHaveLength(1);
    });
});

describe('lanes', () => {
    it('gives someone who emigrated and came back two spans, and lists the undated last', () => {
        const recs = placeRecords([
            link({ personId: 2, name: 'Undated Ulla', date: null }),
            link({ kind: 'birth', date: '1890' }),
            link({ eventType: 'EMIG', date: '1910' }),
            link({ eventType: 'IMMI', date: '1925' }),
            link({ kind: 'death', date: '1960' }),
        ]);
        const result = lanes(recs);
        expect(result[0]!.spans).toEqual([{ from: 1890, to: 1910 }, { from: 1925, to: 1960 }]);
        expect(result[1]!.undated).toBe(true);
    });
});

describe('axisParts', () => {
    it('folds a long quiet stretch unless asked for the full scale', () => {
        expect(axisParts([1702, 1705, 1850, 1880], false)).toEqual([
            { from: 1702, to: 1705, folded: false },
            { from: 1705, to: 1850, folded: true },
            { from: 1850, to: 1880, folded: false },
        ]);
        expect(axisParts([1702, 1705, 1850, 1880], true)).toEqual([{ from: 1702, to: 1880, folded: false }]);
    });
});
