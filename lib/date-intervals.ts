/**
 * Stored date → the interval of days it could mean (#827).
 *
 * The data checks compare dates as intervals and flag only when EVERY reading
 * of the dates conflicts, so an approximate date never raises a false alarm
 * (#786's design outcome, "Approximate dates"). This module turns one stored
 * value into its earliest and latest possible day.
 *
 *   1814-01-27 / 27 JAN 1814   that day to that day
 *   1814-01 / JAN 1814         the whole month
 *   1814                       1 Jan to 31 Dec
 *   11 FEB 1712/13             the later year: 11 Feb 1713 (#971)
 *   500 B.C., 500 BC, 9 AD     B.C. as a negative year; AD is the plain year
 *   ABT, EST, CAL x            x's interval widened by ±5 years
 *   BEF x                      open start, up to the end of x
 *   AFT x                      from the start of x, open end
 *   BET a AND b, FROM a TO b   the start of a to the end of b
 *   FROM a / TO b              open on the other side
 *   INT x (phrase)             x's interval
 *   (phrase) / unreadable      null
 *
 * Days are counted from 1970-01-01 in the proleptic Gregorian calendar, with
 * integer arithmetic only: no `Date`, whose two-digit-year handling would read
 * the year 850 as 1850. An open side is ±Infinity, so comparisons need no
 * special case.
 *
 * Pure: no DB, no DOM. It runs on the server and in the browser (PGlite, and
 * the live "clears this problem" line in #832).
 */

import { splitDateQualifier } from '@/lib/date-qualifiers';

export interface DateInterval {
    /** The first day this date could be, or -Infinity when open. */
    earliest: number;
    /** The last day this date could be, or Infinity when open. */
    latest: number;
}

/** ABT, EST and CAL mean this many years either side (#786). */
export const APPROXIMATE_YEARS = 5;

const GEDCOM_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** A trailing era: GEDCOM's `B.C.`, and the vendors' unambiguous `BC`, `BCE` and `AD` (#971). */
const ERA = /^(.*\S)\s+(B\.?C\.?(?:E\.?)?|A\.?D\.?)$/i;

/** Days from 1970-01-01 to y-m-d (Hinnant's days_from_civil). */
export function daysFromCivil(y: number, m: number, d: number): number {
    const yy = m <= 2 ? y - 1 : y;
    const era = Math.floor(yy / 400);
    const yoe = yy - era * 400;
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
}

/** The y-m-d of a day number (Hinnant's civil_from_days). */
export function civilFromDays(z: number): { y: number; m: number; d: number } {
    const zz = z + 719468;
    const era = Math.floor(zz / 146097);
    const doe = zz - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const m = mp + (mp < 10 ? 3 : -9);
    return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

function daysInMonth(y: number, m: number): number {
    return daysFromCivil(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - daysFromCivil(y, m, 1);
}

/**
 * The same day of the month `months` later (or earlier), clamped to the end of
 * a shorter month: 31 Jan + 1 month is 28 or 29 Feb. An open bound stays open.
 */
export function addMonths(day: number, months: number): number {
    if (!Number.isFinite(day)) return day;
    const { y, m, d } = civilFromDays(day);
    const t = m - 1 + months;
    const ny = y + Math.floor(t / 12);
    const nm = t - Math.floor(t / 12) * 12 + 1;
    return daysFromCivil(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** The same calendar day `years` later (or earlier); 29 Feb lands on 28 Feb. */
export function addYears(day: number, years: number): number {
    return addMonths(day, years * 12);
}

/**
 * A GEDCOM year, or null. A dual year names the later one, which 5.5.1 says
 * is the Gregorian year (#971): "1712/13", and the vendors' "1712/3" and
 * "1712/1713", all read as 1713. A second year that isn't the next one is
 * unreadable.
 */
function gedcomYear(token: string): number | null {
    const dual = token.match(/^(\d{1,4})\/(\d{1,4})$/);
    if (!dual) return Number(token);
    const later = String(Number(dual[1]) + 1);
    return dual[2].length <= later.length && later.endsWith(dual[2]) ? Number(later) : null;
}

/** A plain stored date (no qualifier) → its interval, or null when unreadable. */
function plainInterval(raw: string): DateInterval | null {
    let s = raw.trim();
    let y: number | null, m: number | undefined, d: number | undefined;

    // Only a GEDCOM date carries an era; the app's ISO form never does.
    const era = s.match(ERA);
    if (era) s = era[1];
    const bc = Boolean(era && /^B/i.test(era[2]));

    const iso = era ? null : s.match(/^(\d{1,4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
    const ged = iso ? null : s.match(/^(?:(?:(\d{1,2})\s+)?([A-Za-z]{3})\s+)?(\d{1,4}(?:\/\d{1,4})?)$/);
    if (iso) {
        y = Number(iso[1]);
        m = iso[2] !== undefined ? Number(iso[2]) : undefined;
        d = iso[3] !== undefined ? Number(iso[3]) : undefined;
    } else if (ged) {
        if (bc && ged[3].includes('/')) return null;
        y = gedcomYear(ged[3]);
        if (ged[2] !== undefined) {
            const month = GEDCOM_MONTHS.indexOf(ged[2].toUpperCase());
            if (month < 0) return null;
            m = month + 1;
        }
        d = ged[1] !== undefined ? Number(ged[1]) : undefined;
    } else {
        return null;
    }

    if (y === null || y < 1) return null;
    // Astronomical numbering: 1 B.C. is year 0, so an age across the era
    // boundary counts no missing year.
    if (bc) y = 1 - y;
    if (m === undefined) return { earliest: daysFromCivil(y, 1, 1), latest: daysFromCivil(y, 12, 31) };
    if (m < 1 || m > 12) return null;
    const last = daysInMonth(y, m);
    if (d === undefined) return { earliest: daysFromCivil(y, m, 1), latest: daysFromCivil(y, m, last) };
    if (d < 1 || d > last) return null;
    const day = daysFromCivil(y, m, d);
    return { earliest: day, latest: day };
}

/**
 * The interval a stored date could mean, or null for an empty value, a date
 * phrase, or a value the checks can't read. `isDatePhrase` tells the last two
 * apart (the record-shape rule flags only the unreadable ones).
 */
export function dateInterval(stored: string | null | undefined): DateInterval | null {
    if (!stored || !stored.trim()) return null;
    const q = splitDateQualifier(stored);
    if (!q) return plainInterval(stored);

    switch (q.prefix) {
        case 'PHRASE':
            return null;
        case 'ABT':
        case 'EST':
        case 'CAL': {
            const x = plainInterval(q.parts[0]);
            return x && { earliest: addYears(x.earliest, -APPROXIMATE_YEARS), latest: addYears(x.latest, APPROXIMATE_YEARS) };
        }
        case 'BEF': {
            const x = plainInterval(q.parts[0]);
            return x && { earliest: -Infinity, latest: x.latest };
        }
        case 'AFT': {
            const x = plainInterval(q.parts[0]);
            return x && { earliest: x.earliest, latest: Infinity };
        }
        case 'INT':
            // "INT 1850 (from the parish book)": the phrase explains the date.
            return plainInterval(q.parts[0].replace(/\s*\([^)]*\)\s*$/, ''));
        case 'TO': {
            const x = plainInterval(q.parts[0]);
            return x && { earliest: -Infinity, latest: x.latest };
        }
        case 'BET':
        case 'FROM': {
            const a = plainInterval(q.parts[0]);
            if (!a) return null;
            if (q.parts.length === 1) return { earliest: a.earliest, latest: Infinity };
            const b = plainInterval(q.parts[1]);
            if (!b) return null;
            // A reversed range is still a range: take its widest reading.
            return { earliest: Math.min(a.earliest, b.earliest), latest: Math.max(a.latest, b.latest) };
        }
    }
}

/** True when every reading of `a` falls strictly before every reading of `b`. */
export function definitelyBefore(a: DateInterval, b: DateInterval): boolean {
    return a.latest < b.earliest;
}
