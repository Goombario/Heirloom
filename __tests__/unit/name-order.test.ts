/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { compareText, comparePeopleByName } from '@/lib/collation';
import { withNameOrder } from '@/lib/data/name-order';
import type { DataClient } from '@/lib/data/types';

/**
 * Lists sort the same whichever engine answered (#882). The names are the audit's
 * probe set; `C_ORDER` is what PGlite's C collation returned for them, and
 * `EN_US_ORDER` what hosted Postgres' en_US.utf8 returns.
 */
const C_ORDER = ['Banana', 'Oliver', 'Zoe', 'apple', 'zeta', 'Émile', 'Ölund', 'élan', 'Ежов', 'Юрий', 'ёж'];
const EN_US_ORDER = ['apple', 'Banana', 'élan', 'Émile', 'Oliver', 'Ölund', 'zeta', 'Zoe', 'ёж', 'Ежов', 'Юрий'];
const EN = ['apple', 'Banana', 'élan', 'Émile', 'Oliver', 'Ölund', 'zeta', 'Zoe', 'ёж', 'Ежов', 'Юрий'];
const RU = ['ёж', 'Ежов', 'Юрий', 'apple', 'Banana', 'élan', 'Émile', 'Oliver', 'Ölund', 'zeta', 'Zoe'];

function fakeClient(order: string[]): DataClient {
    const people = order.map((LastName, i) => ({ Id: i + 1, FirstName: 'A', LastName }));
    return {
        people: { list: async () => ({ people, count: people.length }), search: async () => people },
        places: { list: async () => ({ places: order.map((name) => ({ name, count: 1 })), count: order.length, gazetteer: [] }) },
        sources: { list: async () => ({ sources: order.map((Title, i) => ({ Id: i, Title })), count: order.length }) },
        repositories: { list: async () => order.map((Name, i) => ({ Id: i, Name })) },
    } as unknown as DataClient;
}

async function lists(order: string[]) {
    const client = withNameOrder(fakeClient(order));
    return {
        people: (await client.people.list()).people.map((p) => p.LastName),
        search: (await client.people.search('a')).map((p) => p.LastName),
        places: (await client.places.list()).places.map((p) => p.name),
        sources: (await client.sources.list()).sources.map((s) => s.Title),
        repositories: (await client.repositories.list()).map((r) => r.Name),
    };
}

describe('name order (#882)', () => {
    it('gives the people, places, sources and repositories lists one order whichever engine answered', async () => {
        document.documentElement.lang = 'en';
        const fromPglite = await lists(C_ORDER);
        const fromPostgres = await lists(EN_US_ORDER);
        expect(fromPglite).toEqual(fromPostgres);
        for (const list of Object.values(fromPglite)) expect(list).toEqual(EN);
    });

    it('follows the UI language', async () => {
        document.documentElement.lang = 'ru';
        expect((await lists(C_ORDER)).people).toEqual(RU);
        document.documentElement.lang = 'en';
    });

    it('breaks ties on case and accents, and sorts blanks last', () => {
        expect(['Emile', 'émile', 'Émile', 'emile'].sort((a, b) => compareText(a, b, 'fr'))).toEqual(['emile', 'Emile', 'émile', 'Émile']);
        expect(['', 'b', null, 'a'].sort((a, b) => compareText(a, b, 'en'))).toEqual(['a', 'b', '', null]);
        expect(comparePeopleByName({ Id: 2, FirstName: 'A', LastName: 'Lee' }, { Id: 1, FirstName: 'A', LastName: 'Lee' }, 'en')).toBeGreaterThan(0);
    });

    it('keeps the busiest places first', async () => {
        const client = withNameOrder({
            places: { list: async () => ({ places: [{ name: 'b', count: 1 }, { name: 'z', count: 5 }, { name: 'a', count: 1 }], count: 3, gazetteer: [] }) },
        } as unknown as DataClient);
        expect((await client.places.list()).places.map((p) => p.name)).toEqual(['z', 'a', 'b']);
    });
});
