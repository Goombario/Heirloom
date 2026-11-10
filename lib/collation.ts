/**
 * Name ordering for user-facing lists (#882).
 *
 * PGlite (static and desktop) runs with the C collation and hosted Postgres with
 * the image's locale, so an SQL `ORDER BY` on user text sorts differently between
 * flavours: under C, uppercase comes before lowercase, and accented Latin and `ё`
 * come after `z` and `я`. Lists are therefore put in order here, in the UI
 * language, and SQL ordering on names only decides which rows a `LIMIT` keeps
 * (on the folded search key, so that agrees across engines too).
 */

const collators = new Map<string, { base: Intl.Collator; variant: Intl.Collator }>();

function collatorsFor(locale: string) {
    let c = collators.get(locale);
    if (!c) {
        c = {
            base: new Intl.Collator(locale, { sensitivity: 'base', numeric: true }),
            variant: new Intl.Collator(locale, { sensitivity: 'variant', numeric: true }),
        };
        collators.set(locale, c);
    }
    return c;
}

/** The UI language the page renders in (`LanguageProvider` sets `<html lang>`); 'en' off the page. */
function uiLocale(): string {
    return (typeof document !== 'undefined' && document.documentElement.lang) || 'en';
}

/**
 * Dictionary order in `locale`, ignoring case and accents first, then using them
 * to break ties, so the order never depends on which engine returned the rows.
 * A missing or blank value sorts last, as SQL's `NULLS LAST` did.
 */
export function compareText(a: string | null | undefined, b: string | null | undefined, locale: string = uiLocale()): number {
    if (!a || !b) return a ? -1 : b ? 1 : 0;
    const { base, variant } = collatorsFor(locale);
    return base.compare(a, b) || variant.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

interface NamedPerson {
    Id: number;
    FirstName: string | null;
    LastName: string | null;
}

/** Surname, then given name, then id: the people list's order. */
export function comparePeopleByName(a: NamedPerson, b: NamedPerson, locale: string = uiLocale()): number {
    return compareText(a.LastName, b.LastName, locale) || compareText(a.FirstName, b.FirstName, locale) || a.Id - b.Id;
}

/** A copy of `items` in `compareText` order of `key(item)`. */
export function sortByText<T>(items: readonly T[], key: (item: T) => string | null | undefined, locale: string = uiLocale()): T[] {
    return [...items].sort((a, b) => compareText(key(a), key(b), locale));
}
