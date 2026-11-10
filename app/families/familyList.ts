import { compareText } from '@/lib/collation';
import { formatYearOrEmpty, sortableYear } from '@/lib/date-utils';
import { foldForSearch } from '@/lib/utils/search-fold';
import type { FamilyWithSpouseNames } from '@/lib/db/queries/families';
import { shortNameFromDisplay } from './view/derive';

/*
 * The families list's pure rules, shared by the desktop table and the phone rows
 * (#1064): which chip a family passes, how each column sorts, and the couple's name.
 * No React, no translations.
 */

export type FamilyFilterKey = 'marriages' | 'civil' | 'commonlaw' | 'ended-death' | 'ended-divorce' | 'active';
export type FamilySortKey = 'partner' | 'type' | 'began' | 'ended' | 'children' | 'place' | 'sources';

type Family = FamilyWithSpouseNames;

/**
 * The earlier of two partners' death years (by sortable year — resolves qualifiers
 * and ranges, never a bare digit match), or whichever one has a death year, or null
 * when neither does. Shared by the ended-pill's derived-death branch and the row's
 * years so a `TO 1880`/`ABT 1900`-style death date doesn't silently parse to NaN in
 * one place and not the other (#490).
 */
export function earlierDeathYear(
    d1: string | null | undefined,
    d2: string | null | undefined,
): number | null {
    const a = sortableYear(d1);
    const b = sortableYear(d2);
    if (a !== null && b !== null) return Math.min(a, b);
    return a ?? b;
}

function isEndedByDeath(family: Family): boolean {
    if (family.EndedReason === 'Death') return true;
    if (family.EndedReason) return false;
    return Boolean(family.partner1DeathDate || family.partner2DeathDate);
}

function isEndedByDivorce(family: Family): boolean {
    return family.EndedReason === 'Divorce';
}

export function isActive(family: Family): boolean {
    if (family.EndedDate || family.EndedReason) return false;
    return !family.partner1DeathDate && !family.partner2DeathDate;
}

export function matchesFilter(family: Family, key: FamilyFilterKey): boolean {
    const type = family.Type ?? 'Marriage';
    switch (key) {
        case 'marriages': return type === 'Marriage';
        case 'civil': return type === 'Civil union';
        case 'commonlaw': return type === 'Common-law';
        case 'ended-death': return isEndedByDeath(family);
        case 'ended-divorce': return isEndedByDivorce(family);
        case 'active': return isActive(family);
    }
}

/** The earlier partner death, unless it falls before the start: that is a bad date, not an end (#826). */
function derivedEndYear(family: Pick<Family, 'MarriageDate' | 'partner1DeathDate' | 'partner2DeathDate'>): number | null {
    const startNum = sortableYear(family.MarriageDate);
    const earlierDeath = earlierDeathYear(family.partner1DeathDate, family.partner2DeathDate);
    return earlierDeath !== null && startNum !== null && earlierDeath < startNum ? null : earlierDeath;
}

/**
 * The start/end/duration numbers, computed from `sortableYear` (not a bare digit
 * match) throughout — a qualified or ranged `MarriageDate`/`EndedDate`/death date
 * must not silently drop the duration (#490). `endYear` is still a display string
 * (qualifier markers intact, via `formatYearOrEmpty`) for the explicit `EndedDate`
 * case; the derived-from-death fallback renders its plain sortable year.
 */
export function familyDurationYears(
    family: Pick<Family, 'MarriageDate' | 'EndedDate' | 'partner1DeathDate' | 'partner2DeathDate'>,
    active: boolean,
    currentYear: number,
): { startYear: string; endYear: string | null; yearsCount: number | null } {
    const startYear = formatYearOrEmpty(family.MarriageDate);
    const startNum = sortableYear(family.MarriageDate);
    const derivedEnd = derivedEndYear(family);
    const endYear = formatYearOrEmpty(family.EndedDate) || (derivedEnd !== null ? String(derivedEnd) : null);

    const endNum = active ? currentYear : (sortableYear(family.EndedDate) ?? derivedEnd);
    const yearsCount = startNum !== null && endNum !== null ? endNum - startNum : null;

    return { startYear, endYear, yearsCount };
}

/** The year the partnership ended, recorded or by a partner's death; null while active or unknown. */
export function endedYear(family: Family): number | null {
    if (isActive(family)) return null;
    return sortableYear(family.EndedDate) ?? derivedEndYear(family);
}

interface CoupleNamePart {
    given: string;
    surname: string;
}

export interface CoupleName {
    /** The partners present, in slot order (zero, one or two). */
    partners: CoupleNamePart[];
    /** Both partners share a surname: "Anders & Greta Halvorsen". */
    shared: boolean;
    /** The whole name as text, '' when no partner is named. */
    text: string;
}

/**
 * One partner's first given name and surname from the list's display name. The list
 * carries the formatted full name (nickname integrated) plus the surname, so the given
 * part is what precedes the surname. Without a surname field (an older cached list) the
 * whole name stands as the given part.
 */
function namePart(full: string | null | undefined, last: string | null | undefined): CoupleNamePart | null {
    const name = full?.trim();
    if (!name) return null;
    if (last === undefined) return { given: name, surname: '' };
    const surname = (last ?? '').trim();
    const rest = surname && name.endsWith(surname) ? name.slice(0, -surname.length).trim() : name;
    return { given: shortNameFromDisplay(rest), surname };
}

/**
 * The couple's name by the family page rule (#1062): "Anders & Greta Halvorsen" when
 * the surnames match, "Thomas Marsh & Ellen Pryce" when they don't, one name with one
 * partner, and '' with none (the caller supplies the fallback).
 */
export function coupleName(family: Family): CoupleName {
    const partners = [
        namePart(family.husbandName, family.partner1LastName),
        namePart(family.wifeName, family.partner2LastName),
    ].filter((p): p is CoupleNamePart => p !== null);
    const one = (p: CoupleNamePart) => [p.given, p.surname].filter(Boolean).join(' ') || '?';
    const [a, b] = partners;
    const shared = !!a && !!b && !!a.surname && a.surname.toLocaleLowerCase() === b.surname.toLocaleLowerCase();
    const text = shared
        ? `${a.given || '?'} & ${b.given || '?'} ${a.surname}`
        : partners.map(one).join(' & ');
    return { partners, shared, text };
}

/** The surname a family sorts and divides by: the first partner's, else the second's. */
export function sortSurname(family: Family): string {
    return coupleName(family).partners.find((p) => p.surname)?.surname ?? '';
}

const TYPE_ORDER = ['Marriage', 'Civil union', 'Common-law', 'Other', 'Unknown'];

/** Search by partner names or marriage place, accent-blind, every word must match. */
export function searchFamilies(families: Family[], query: string): Family[] {
    const tokens = foldForSearch(query.trim()).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return families;
    return families.filter((f) => {
        const blob = foldForSearch(`${f.husbandName ?? ''} ${f.wifeName ?? ''} ${f.MarriagePlace ?? ''}`);
        return tokens.every((tok) => blob.includes(tok));
    });
}

/**
 * Sorts a copy by one column. Missing values sort last in both directions, so they
 * never crowd the top; ties fall back to the couple's name. Partner sorts by surname,
 * like the people list. Years compare by `sortableYear`, so "ABT 1871" sits with 1871.
 * Still-active partnerships count as the newest ending.
 */
export function sortFamilies(families: Family[], key: FamilySortKey, ascending: boolean, locale: string): Family[] {
    const value = (f: Family): string | number | null => {
        switch (key) {
            case 'partner': return sortSurname(f) || null;
            case 'type': return TYPE_ORDER.indexOf(f.Type ?? 'Marriage');
            case 'began': return sortableYear(f.MarriageDate);
            case 'ended': return isActive(f) ? Number.MAX_SAFE_INTEGER : endedYear(f);
            case 'children': return f.childCount ?? 0;
            case 'place': return f.MarriagePlace?.trim() || null;
            case 'sources': return f.SourcedFacts ?? 0;
        }
    };
    const names = new Map(families.map((f) => [f.Id, coupleName(f).text]));
    const byName = (a: Family, b: Family) => {
        const an = names.get(a.Id) ?? '', bn = names.get(b.Id) ?? '';
        if (!an || !bn) return an ? -1 : bn ? 1 : a.Id - b.Id;
        return compareText(an, bn, locale);
    };
    const dir = ascending ? 1 : -1;
    return [...families].sort((a, b) => {
        const va = value(a), vb = value(b);
        if (va === null || vb === null) return va === vb ? byName(a, b) : va === null ? 1 : -1;
        const cmp = typeof va === 'string' ? compareText(va, vb as string, locale) : va - (vb as number);
        return dir * cmp || byName(a, b);
    });
}
