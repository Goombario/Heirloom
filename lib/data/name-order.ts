import { compareText, comparePeopleByName, sortByText } from '@/lib/collation';
import type { DataClient, GetPeopleResult, PlaceDetail, PlaceSummary } from './types';

/**
 * Puts the name-ordered lists in UI-language order on the way out of the data
 * client, whichever backend answered (#882). Hosted Postgres and in-browser
 * PGlite collate text differently, so the SQL order can't be shown as is.
 */

type Named = { Id: number; FirstName: string | null; LastName: string | null };
const people = <T extends Named>(rows: T[]): T[] => [...rows].sort((a, b) => comparePeopleByName(a, b));
const byTitle = <T extends { Title?: string | null }>(rows: T[]): T[] => sortByText(rows, (r) => r.Title);
const byName = <T extends { Name?: string | null }>(rows: T[]): T[] => sortByText(rows, (r) => r.Name);

const ORDER: Record<string, Record<string, (result: never) => unknown>> = {
    people: {
        list: (r: GetPeopleResult) => ({ ...r, people: people(r.people) }),
        search: people,
    },
    places: {
        // Busiest first (the server's order), names alphabetical within a count.
        list: (r: { places: PlaceSummary[] }) => ({
            ...r,
            places: [...r.places].sort((a, b) => b.count - a.count || compareText(a.name, b.name)),
        }),
        detail: (r: PlaceDetail) => ({
            ...r,
            people: people(r.people),
            ...(r.children ? { children: sortByText(r.children, (c) => c.name) } : {}),
        }),
    },
    sources: {
        list: (r: { sources: { Title?: string | null }[] }) => ({ ...r, sources: byTitle(r.sources) }),
        search: byTitle,
    },
    repositories: {
        list: byName,
        sources: byTitle,
    },
};

function wrapSubClient<T extends object>(sub: T, order: Record<string, (result: never) => unknown>): T {
    return new Proxy(sub, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            const sort = typeof prop === 'string' ? order[prop] : undefined;
            if (typeof value !== 'function' || !sort) return value;
            return async (...args: unknown[]) =>
                sort((await (value as (...a: unknown[]) => Promise<never>).apply(target, args)));
        },
    });
}

export function withNameOrder(client: DataClient): DataClient {
    return new Proxy(client, {
        get(target, prop, receiver) {
            const sub = Reflect.get(target, prop, receiver);
            const order = typeof prop === 'string' ? ORDER[prop] : undefined;
            return order && sub && typeof sub === 'object' ? wrapSubClient(sub as object, order) : sub;
        },
    }) as DataClient;
}
