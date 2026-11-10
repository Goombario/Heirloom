import { describe, expect, it } from 'vitest';
import { liftCitationLink } from '@/lib/gedcom/citation-link';

describe('liftCitationLink (ADR 0025)', () => {
    it('lifts the first link line and leaves the rest', () => {
        expect(liftCitationLink(['1 OBJE @M1@', '1 _LINK https://a.example/1', '1 _LINK https://a.example/2'])).toEqual({
            url: 'https://a.example/1',
            rest: ['1 OBJE @M1@', '1 _LINK https://a.example/2'],
        });
    });

    it('reads _URL and WWW, joins CONC lines and undoes the @@ escape', () => {
        expect(liftCitationLink(['1 _URL https://a.example/', '2 CONC long'])).toEqual({ url: 'https://a.example/long', rest: [] });
        expect(liftCitationLink(['1 WWW https://a.example/u@@x'])).toEqual({ url: 'https://a.example/u@x', rest: [] });
    });

    it('lifts nothing from a blank link or one with other sub-lines', () => {
        const blank = ['1 _LINK', '1 _LINK https://a.example/2'];
        expect(liftCitationLink(blank)).toEqual({ url: null, rest: blank });
        const withNote = ['1 _LINK https://a.example/1', '2 NOTE kept'];
        expect(liftCitationLink(withNote)).toEqual({ url: null, rest: withNote });
    });

    it('ignores link tags that are not direct children of the citation', () => {
        const deep = ['1 DATA', '2 _LINK https://a.example/1'];
        expect(liftCitationLink(deep)).toEqual({ url: null, rest: deep });
    });
});
