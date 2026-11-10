/**
 * The living-person rules (#1021). One place decides whether someone is
 * deceased, living or unknown, and whether they may still be alive.
 *
 * Pure: no DB, no DOM.
 */

import { addYears, dateInterval, daysFromCivil } from '@/lib/date-intervals';

export type LivingStatus = 'living' | 'deceased' | 'unknown';

/** A birth this many years back or more is taken to be someone no longer alive. */
const MAY_BE_LIVING_YEARS = 100;

interface LivingFields {
    /** null = unknown, 0 = alive, 1 = deceased. */
    IsDeceased?: number | null;
    DeathDate?: string | null;
}

/**
 * The status the person pages and lists show. A death date or the deceased flag
 * means deceased; only the explicit living flag means living; anything else,
 * including no death data at all, is unknown.
 */
export function livingStatus(person: LivingFields): LivingStatus {
    if (person.IsDeceased === 1 || person.DeathDate) return 'deceased';
    return person.IsDeceased === 0 ? 'living' : 'unknown';
}

/**
 * True when the person could still be alive: not marked deceased, no death
 * date, and either marked living, born within the last `MAY_BE_LIVING_YEARS`
 * by the latest reading of the birth date, or with no readable birth date.
 * `BEF 1900` is read as at most 1900, `ABT 1930` as up to 1935, and `AFT 1900`
 * as open-ended, so it may be living.
 */
export function mayBeLiving(person: LivingFields & { BirthDate?: string | null }, nowYear: number): boolean {
    const status = livingStatus(person);
    if (status === 'deceased') return false;
    if (status === 'living') return true;
    const birth = dateInterval(person.BirthDate);
    if (!birth) return true;
    return birth.latest >= addYears(daysFromCivil(nowYear, 1, 1), -MAY_BE_LIVING_YEARS);
}
