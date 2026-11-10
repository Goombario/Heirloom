import { describe, it, expect } from 'vitest';
import { compareTimelineItems, type TimelineSortable } from '@/app/people/view/derive';

const order = (items: TimelineSortable[]) =>
    [...items].sort(compareTimelineItems).map(i => `${i.type}:${i.sortKey}`);

describe('compareTimelineItems', () => {
    it('orders dated events by year', () => {
        expect(order([
            { type: 'GRAD', sortKey: 1930 },
            { type: 'BIRT', sortKey: 1900 },
            { type: 'DEAT', sortKey: 1975 },
        ])).toEqual(['BIRT:1900', 'GRAD:1930', 'DEAT:1975']);
    });

    it('sinks undated ordinary events below every dated one', () => {
        expect(order([
            { type: 'WILL', sortKey: null },
            { type: 'BIRT', sortKey: 1900 },
            { type: 'OCCU', sortKey: 1925 },
        ])).toEqual(['BIRT:1900', 'OCCU:1925', 'WILL:null']);
    });

    // The intrinsic Birth row renders for a person with only a BirthPlace, so an
    // undated birth is common — and must not land below the death.
    it('keeps an undated birth first and an undated death after the dated rows', () => {
        expect(order([
            { type: 'DEAT', sortKey: null },
            { type: 'OCCU', sortKey: 1925 },
            { type: 'BIRT', sortKey: null },
        ])).toEqual(['BIRT:null', 'OCCU:1925', 'DEAT:null']);
    });

    it('puts an undated death above an undated ordinary event', () => {
        expect(order([
            { type: 'WILL', sortKey: null },
            { type: 'DEAT', sortKey: null },
        ])).toEqual(['DEAT:null', 'WILL:null']);
    });

    it('is a consistent comparator — reversing the input gives the same order', () => {
        const items: TimelineSortable[] = [
            { type: 'BIRT', sortKey: null },
            { type: 'OCCU', sortKey: 1925 },
            { type: 'RESI', sortKey: 1910 },
            { type: 'DEAT', sortKey: null },
            { type: 'WILL', sortKey: null },
        ];
        expect(order(items)).toEqual(order([...items].reverse()));
        expect(order(items)).toEqual(['BIRT:null', 'RESI:1910', 'OCCU:1925', 'DEAT:null', 'WILL:null']);
    });
});

describe('compareTimelineItems with a null sortKey', () => {
    it('sinks an undated ordinary event below every dated one', () => {
        const rows = [
            { type: 'RESI', sortKey: null },
            { type: 'OCCU', sortKey: 1911 },
            { type: 'BIRT', sortKey: null },
            { type: 'DEAT', sortKey: null },
        ];
        expect([...rows].sort(compareTimelineItems).map((r) => r.type)).toEqual(['BIRT', 'OCCU', 'DEAT', 'RESI']);
    });
});
