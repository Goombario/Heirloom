import { describe, it, expect } from 'vitest';
import { buildPlaceOptions, matchPlaceOptions, sameNamePlaces, settlePlaceText } from '@/lib/places/place-options';
import type { PlaceGazetteerNode, PlaceSummary } from '@/lib/data/types';

/** The place field's "In your tree" matching (#1186). */

function node(id: number, name: string, extra: Partial<PlaceGazetteerNode> = {}): PlaceGazetteerNode {
    return { id, name, parentId: null, displayName: null, latitude: null, longitude: null, ...extra } as PlaceGazetteerNode;
}

const gazetteer: PlaceGazetteerNode[] = [
    node(1, 'France'),
    node(2, 'Paris', { parentId: 1, latitude: 48.85, longitude: 2.35 }),
    node(3, 'Ontario'),
    node(4, 'Paris', { parentId: 3 }),
    node(5, 'Lviv', { otherNames: ['Lwów', 'Lemberg'] }),
    node(6, 'Pärnu'),
];
const places = [
    { id: 2, count: 1 }, { id: 4, count: 5 }, { id: 5, count: 3 }, { id: 6, count: 2 },
] as PlaceSummary[];
const options = buildPlaceOptions(places, gazetteer);

describe('buildPlaceOptions', () => {
    it('gives each place and each other name a row, with what tells it apart', () => {
        expect(options.filter((o) => o.placeId === 5).map((o) => [o.text, o.isOtherName])).toEqual([
            ['Lviv', false], ['Lwów', true], ['Lemberg', true],
        ]);
        expect(options.find((o) => o.placeId === 4)).toMatchObject({ parentName: 'Ontario', count: 5, pinned: false });
        expect(options.find((o) => o.placeId === 2)).toMatchObject({ parentName: 'France', count: 1, pinned: true });
        expect(options.find((o) => o.placeId === 1)?.count).toBe(0);
    });
});

describe('matchPlaceOptions', () => {
    it('matches inside names, accents and case aside, exact names first', () => {
        expect(matchPlaceOptions(options, 'par').map((o) => o.placeId)).toEqual([4, 6, 2]);
        expect(matchPlaceOptions(options, 'paris').map((o) => o.placeId)).toEqual([4, 2]);
        expect(matchPlaceOptions(options, 'LWOW').map((o) => o.text)).toEqual(['Lwów']);
    });

    it('offers close spellings only when nothing contains the text', () => {
        const close = matchPlaceOptions(options, 'Lvov');
        expect(close.map((o) => [o.text, o.close])).toEqual([['Lviv', true], ['Lwów', true]]);
        expect(matchPlaceOptions(options, 'Zz')).toEqual([]);
        expect(matchPlaceOptions(options, 'Paris, Texas').map((o) => o.text)).toEqual(['Pärnu']);
    });

    it('lists the most-used places, not other names, for an empty field', () => {
        expect(matchPlaceOptions(options, '  ', 3).map((o) => o.text)).toEqual(['Paris', 'Lviv', 'Pärnu']);
    });
});

describe('settlePlaceText', () => {
    it('links an exact name to its most-used place, else the place it is another name of', () => {
        expect(settlePlaceText(options, 'Paris')?.placeId).toBe(4);
        expect(settlePlaceText(options, ' Lemberg ')).toMatchObject({ placeId: 5, isOtherName: true });
        expect(settlePlaceText(options, 'paris')).toBeNull();
        expect(settlePlaceText(options, 'Paris, Texas')).toBeNull();
        expect(settlePlaceText(options, '')).toBeNull();
    });
});

describe('sameNamePlaces', () => {
    it('counts the places that share a name', () => {
        expect(sameNamePlaces(options, options.find((o) => o.placeId === 2)!)).toBe(2);
        expect(sameNamePlaces(options, options.find((o) => o.placeId === 5)!)).toBe(1);
    });
});
