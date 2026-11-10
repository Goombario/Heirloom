/**
 * Shared date utility for partial date support.
 *
 * Storage formats:
 *   - Year only:    "1945"        (YYYY)
 *   - Year + month: "1945-03"     (YYYY-MM)
 *   - Full date:    "1945-03-15"  (YYYY-MM-DD)
 */

import {
    splitDateQualifier, makeDatePhrase, stripControlCharacters,
    type DateQualifierWords,
} from '@/lib/date-qualifiers';

export type DatePrecision = 'full' | 'year-month' | 'year';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const GEDCOM_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// French display abbreviations (standard abbreviated forms used in French documents)
const MONTH_ABBR_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
// Russian display abbreviations
const MONTH_ABBR_RU = ['янв.', 'фев.', 'мар.', 'апр.', 'май', 'июн.', 'июл.', 'авг.', 'сен.', 'окт.', 'ноя.', 'дек.'];

// French month names for input parsing (full + short, lowercase)
const MONTH_FULL_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTH_SHORT_FR = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'aout', 'sept', 'oct', 'nov', 'déc', 'dec'];
const MONTH_SHORT_FR_IDX = [1, 2, 3, 4, 5, 6, 7, 8, 8, 9, 10, 11, 12, 12]; // parallel index for MONTH_SHORT_FR

// Russian month names for input parsing (nominative + genitive case)
const MONTH_NOM_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTH_GEN_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** Build a lookup from month name/abbreviation (lowercase) to 1-based month number */
const MONTH_LOOKUP: Record<string, number> = {};
MONTH_ABBR.forEach((m, i) => { MONTH_LOOKUP[m.toLowerCase()] = i + 1; });
MONTH_FULL.forEach((m, i) => { MONTH_LOOKUP[m.toLowerCase()] = i + 1; });
GEDCOM_MONTHS.forEach((m, i) => { MONTH_LOOKUP[m.toLowerCase()] = i + 1; });
// French
MONTH_FULL_FR.forEach((m, i) => { MONTH_LOOKUP[m.toLowerCase()] = i + 1; });
MONTH_SHORT_FR.forEach((m, i) => { MONTH_LOOKUP[m.toLowerCase()] = MONTH_SHORT_FR_IDX[i]; });
// Russian (nominative + genitive)
MONTH_NOM_RU.forEach((m, i) => { MONTH_LOOKUP[m.toLowerCase()] = i + 1; });
MONTH_GEN_RU.forEach((m, i) => { MONTH_LOOKUP[m.toLowerCase()] = i + 1; });

export interface DateComponents {
    year: number;
    month?: number;  // 1-12
    day?: number;    // 1-31
    precision: DatePrecision;
}

/**
 * Parse a stored date string into structured components.
 * Returns null if unparseable.
 */
export function parseDateComponents(dateStr: string | null | undefined): DateComponents | null {
    if (!dateStr || !dateStr.trim()) return null;
    const s = dateStr.trim();

    // Full date: YYYY-MM-DD
    const fullMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (fullMatch) {
        return {
            year: parseInt(fullMatch[1], 10),
            month: parseInt(fullMatch[2], 10),
            day: parseInt(fullMatch[3], 10),
            precision: 'full',
        };
    }

    // Year-month: YYYY-MM
    const ymMatch = s.match(/^(\d{4})-(\d{2})$/);
    if (ymMatch) {
        return {
            year: parseInt(ymMatch[1], 10),
            month: parseInt(ymMatch[2], 10),
            precision: 'year-month',
        };
    }

    // Year only: YYYY
    const yMatch = s.match(/^(\d{4})$/);
    if (yMatch) {
        return {
            year: parseInt(yMatch[1], 10),
            precision: 'year',
        };
    }

    return null;
}

/**
 * Format a stored date string for user-facing display.
 *   "1945"       → "1945"
 *   "1945-03"    → "Mar 1945"        (en) / "mars 1945"     (fr) / "мар. 1945" (ru)
 *   "1945-03-15" → "Mar 15, 1945"    (en) / "15 mars 1945"  (fr) / "15 мар. 1945" (ru)
 */
export function formatDateForDisplay(
    dateStr: string | null | undefined,
    locale: string = 'en',
    words?: Partial<DateQualifierWords>,
): string {
    if (!dateStr) return '';
    // Approximate/range dates (GED-4): format each inner date, keep the qualifier.
    const q = splitDateQualifier(dateStr);
    if (q) {
        // A phrase is prose, not a date: render it verbatim, without the storage
        // parentheses and without recursing into it.
        if (q.prefix === 'PHRASE') return q.parts[0];
        // Display and storage diverge here by design (§5): the stored string keeps
        // the raw GEDCOM tag, the reader gets a word in their own language.
        const word = (tag: string) => words?.[tag as keyof DateQualifierWords] ?? tag;
        const inner = q.parts.map((p) => formatDateForDisplay(p, locale, words));
        return q.sep
            ? `${word(q.prefix)} ${inner[0]} ${word(q.sep)} ${inner[1]}`
            : `${word(q.prefix)} ${inner[0]}`;
    }
    const c = parseDateComponents(dateStr);
    if (!c) return dateStr; // fallback to raw string

    if (c.precision === 'year') return String(c.year);

    if (locale === 'fr') {
        const abbr = MONTH_ABBR_FR[c.month! - 1];
        if (c.precision === 'year-month') return `${abbr} ${c.year}`;
        return `${c.day} ${abbr} ${c.year}`;
    }

    if (locale === 'ru') {
        const abbr = MONTH_ABBR_RU[c.month! - 1];
        if (c.precision === 'year-month') return `${abbr} ${c.year}`;
        return `${c.day} ${abbr} ${c.year}`;
    }

    // Default: English
    if (c.precision === 'year-month') return `${MONTH_ABBR[c.month! - 1]} ${c.year}`;
    return `${MONTH_ABBR[c.month! - 1]} ${c.day}, ${c.year}`;
}

/**
 * Extract the year from a date string for timeline/lifespan display.
 * Returns "?" if no year can be extracted.
 */
export function formatYearForDisplay(dateStr: string | null | undefined): string {
    if (!dateStr) return '?';
    // Preserve GEDCOM approximation/range qualifiers so an estimate reads as distinct
    // from a firmly-sourced exact year on compact cards/timelines (#193) — otherwise
    // "ABT 1876", "BEF 1920", "BET 1877 AND 1880" all silently render as bare years:
    //   ABT/EST/CAL/INT 1876 → ~1876   BEF 1920 → <1920   AFT 1850 → >1850
    //   ranges (BET…AND, FROM…TO, TO, FROM) → ~<first year> (marked uncertain, compact)
    const q = splitDateQualifier(dateStr);
    if (q) {
        if (q.prefix === 'PHRASE') return '?';   // prose has no year
        const year = q.parts[0]?.match(/\d{4}/)?.[0] ?? '?';
        if (year === '?') return '?';
        if (q.prefix === 'BEF') return `<${year}`;
        if (q.prefix === 'AFT') return `>${year}`;
        return `~${year}`;
    }
    const match = dateStr.match(/\d{4}/);
    return match ? match[0] : '?';
}

/**
 * Like {@link formatYearForDisplay} but returns '' (not '?') when no year is
 * known — for compact inline contexts (ranges, parentheses, lists) that render
 * the year in a slot which should collapse when empty rather than show a literal
 * '?'. Still preserves GEDCOM qualifiers (~1876 / <1920 / >1850) when a year is
 * present, which the old inline `dateStr.match(/\d{4}/)` extraction silently dropped.
 */
export function formatYearOrEmpty(dateStr: string | null | undefined): string {
    const year = formatYearForDisplay(dateStr);
    return year === '?' ? '' : year;
}

export interface LifespanInput {
    birth?: string | null;
    death?: string | null;
    living?: boolean | null;
    presentLabel?: string;
}

/**
 * "1819–1901" / "1985–present" / "1900" / null.
 *
 * Lives in `lib/` rather than `app/components/ui/format.ts` (which re-exports
 * it) because `lib/services/media-faces.ts` pre-formats a suggested person's
 * years server-side for the faces queue, and server code must not import from
 * `app/`.
 */
export function formatLifespan({ birth, death, living, presentLabel }: LifespanInput): string | null {
    if (!birth && !death) return null;
    const start = birth || '?';
    if (death) return `${start}–${death}`;
    if (living === true) return `${start}–${presentLabel ?? 'present'}`;
    return start;
}

/** First 4-digit run in a plain stored date, or null. */
function bareYear(dateStr: string | null | undefined): number | null {
    const m = dateStr?.match(/\d{4}/);
    return m ? parseInt(m[0], 10) : null;
}

/**
 * The year a date should sort by, or null when it has none.
 *
 * Replaces the local `match(/(\d{4})/)` that roughly fourteen call sites grew
 * independently (#490). Those returned 0 for a yearless value, which sorted it
 * ahead of every real event, and read `TO 1880` as a start date.
 *
 *   ABT/EST/CAL/BEF/AFT/INT → the stated year
 *   BET … AND … / FROM … TO … / FROM …  → the earliest bound
 *   TO …  → the end year (a bare TO has no start)
 *   (phrase) / no 4-digit run → null
 */
export function sortableYear(date: string | null | undefined): number | null {
    if (!date || !date.trim()) return null;
    const q = splitDateQualifier(date);
    if (q) {
        if (q.prefix === 'PHRASE') return null;
        return bareYear(q.parts[0]);
    }
    return bareYear(date);
}

/**
 * Ascending comparator over stored dates that places yearless values LAST rather
 * than at year zero. Returns 0 when neither side has a year, so callers can chain
 * their own tiebreak.
 */
export function compareSortableYears(a: string | null | undefined, b: string | null | undefined): number {
    const ya = sortableYear(a);
    const yb = sortableYear(b);
    if (ya === null && yb === null) return 0;
    if (ya === null) return 1;
    if (yb === null) return -1;
    return ya - yb;
}

/**
 * Whether a token parses as a month name or abbreviation in any shipped language.
 * Used by the alias-collision test: a translator-supplied qualifier alias that is
 * also a month would make "mar 1850" ambiguous.
 */
export function isMonthWord(token: string): boolean {
    return MONTH_LOOKUP[token.trim().toLowerCase()] !== undefined;
}

/**
 * Calculate age from partial dates. Uses year-level comparison when
 * only years are available. Returns null if birth date is unknown.
 */
/**
 * Structured age result so callers can format/translate it themselves.
 * `years_approx` is a year-only estimate (was rendered as "~N years").
 */
export type AgeResult =
    | { kind: 'years'; value: number }
    | { kind: 'years_approx'; value: number }
    | { kind: 'months'; value: number }
    | { kind: 'deceased' };

export function calculateAge(birthDate: string | null | undefined, deathDate: string | null | undefined, isDeceased: boolean | null | undefined): AgeResult | null {
    const birth = parseDateComponents(birthDate);
    if (!birth) return null;

    let endYear: number;
    let endMonth: number | undefined;
    let endDay: number | undefined;

    if (deathDate) {
        const death = parseDateComponents(deathDate);
        if (!death) return null;
        endYear = death.year;
        endMonth = death.month;
        endDay = death.day;
    } else {
        const now = new Date();
        endYear = now.getFullYear();
        endMonth = now.getMonth() + 1;
        endDay = now.getDate();
    }

    // If both have full or year-month precision, compute more precisely
    if (birth.month !== undefined && endMonth !== undefined) {
        let age = endYear - birth.year;
        if (endMonth < birth.month || (endMonth === birth.month && (endDay ?? 31) < (birth.day ?? 1))) {
            age--;
        }
        if (age < 0) return null;
        if (age < 2) {
            const months = (endYear - birth.year) * 12 + (endMonth - birth.month)
                - ((endDay ?? 31) < (birth.day ?? 1) ? 1 : 0);
            return months >= 0 ? { kind: 'months', value: months } : null;
        }
        return { kind: 'years', value: age };
    } else if (isDeceased) {
        // If deceased but we don't have enough info for a precise calculation, report "deceased" instead of an age estimate
        return { kind: 'deceased' };
    }

    // Year-only comparison
    const age = endYear - birth.year;
    return age >= 0 ? { kind: 'years_approx', value: age } : null;
}

/**
 * Parse flexible user input into a normalized storage format.
 *
 * Handles numeric-only formats explicitly:
 *   "1945", "1945-03", "1945-03-15" (storage passthrough)
 *   "3/15/1945" or "15/3/1945" depending on slashOrder
 *
 * All other formats are handled by a tokenizer that accepts any ordering
 * of a 4-digit year, a text month name/abbreviation, and an optional day:
 *   "Mar 1945", "March 1945", "1945 Mar", "1945 March"
 *   "Oct 04 1884", "October 4, 1884", "1884 October 4"
 *   "15 Mar 1945", "Mar 15 1945", "1945 Mar 15"
 *
 * Returns null if the input cannot be parsed.
 *
 * @param slashOrder - How to interpret slash-separated dates: 'MDY' (MM/DD/YYYY, default) or 'DMY' (DD/MM/YYYY)
 */
export function parseUserDateInput(input: string, slashOrder: 'MDY' | 'DMY' = 'MDY'): string | null {
    const s = input.trim();
    if (!s) return null;

    // Keep manual entry symmetric with the GEDCOM qualifier grammar already
    // accepted by storage/display/export. Parse each inner point date so a
    // qualified date remains sortable where possible, but retain an INT/raw
    // phrase rather than rejecting a value the importer can round-trip.
    const qualifier = splitDateQualifier(s);
    if (qualifier) {
        // A user who types a parenthesised value means a date phrase; keep it as
        // one (capped), rather than reading its text as a qualified date.
        if (qualifier.prefix === 'PHRASE') return makeDatePhrase(qualifier.parts[0]);
        if (qualifier.prefix === 'INT') {
            // The grammar is `INT <DATE> (<DATE_PHRASE>)` — both halves required.
            const rest = qualifier.parts[0];
            const m = rest.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
            const dateText = (m ? m[1] : rest).trim();
            // No phrase typed: echo the date text, so the value stays legal and
            // nothing the user wrote is invented or lost. The cap comes from
            // `makeDatePhrase` rather than a second inline slice — one capping
            // rule, so the two sites cannot drift (and control characters are
            // stripped here too).
            const phrase = makeDatePhrase(m ? m[2] : dateText);
            const parsedDate = parseUserDateInput(dateText, slashOrder) ?? dateText;
            return `INT ${parsedDate} ${phrase || '()'}`;
        }
        const parts = qualifier.parts.map((part) => parseUserDateInput(part, slashOrder));
        if (parts.every((part): part is string => part !== null)) {
            return qualifier.sep
                ? `${qualifier.prefix} ${parts[0]} ${qualifier.sep} ${parts[1]}`
                : `${qualifier.prefix} ${parts[0]}`;
        }
        // A qualifier with an unstructured inner phrase is still valid GEDCOM
        // text; keep it normalized instead of inventing a point date.
        return qualifier.sep
            ? `${qualifier.prefix} ${qualifier.parts[0]} ${qualifier.sep} ${qualifier.parts[1]}`
            : `${qualifier.prefix} ${qualifier.parts[0]}`;
    }

    // --- Numeric-only formats ---

    // Already in storage format: YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const c = parseDateComponents(s);
        if (c && isValidDate(c)) return s;
        return null;
    }

    // Storage format: YYYY-MM
    if (/^\d{4}-\d{2}$/.test(s)) {
        const c = parseDateComponents(s);
        if (c && c.month! >= 1 && c.month! <= 12) return s;
        return null;
    }

    // Year only: YYYY
    if (/^\d{4}$/.test(s)) {
        const year = parseInt(s, 10);
        if (year > 0 && year < 3000) return s;
        return null;
    }

    // Slash-separated: N/N/YYYY — order depends on slashOrder preference
    const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
        const a = parseInt(slashMatch[1], 10);
        const b = parseInt(slashMatch[2], 10);
        const year = parseInt(slashMatch[3], 10);
        const [month, day] = slashOrder === 'DMY' ? [b, a] : [a, b];
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year > 0 && year < 3000) {
            return `${year}-${pad(month)}-${pad(day)}`;
        }
        return null;
    }

    // --- Tokenizer for text-month formats (any token ordering) ---
    // Normalize: commas → spaces, then split on whitespace
    const tokens = s.replace(/,/g, ' ').split(/\s+/).filter(Boolean);

    let year: number | null = null;
    let month: number | null = null;
    const numericTokens: number[] = [];

    for (const token of tokens) {
        if (/^\d{4}$/.test(token)) {
            year = parseInt(token, 10);
        } else {
            const monthNum = MONTH_LOOKUP[token.toLowerCase()];
            if (monthNum) {
                month = monthNum;
            } else if (/^\d{1,2}$/.test(token)) {
                numericTokens.push(parseInt(token, 10));
            } else {
                return null; // unrecognized token
            }
        }
    }

    // Remaining numeric tokens (after extracting the 4-digit year) must be the day only
    if (numericTokens.length > 1) return null;
    const day = numericTokens.length === 1 ? numericTokens[0] : null;

    // Must have at least a year and a text month name to use the tokenized path
    if (!year || month === null) return null;
    if (year <= 0 || year >= 3000) return null;
    if (month < 1 || month > 12) return null;
    if (day !== null && (day < 1 || day > 31)) return null;

    if (day !== null) return `${year}-${pad(month)}-${pad(day)}`;
    return `${year}-${pad(month)}`;
}

/**
 * Format a stored date string to GEDCOM 5.5.1 format.
 *   "1945"       → "1945"
 *   "1945-03"    → "MAR 1945"
 *   "1945-03-15" → "15 MAR 1945"
 */
export function formatDateForGedcom(dateStr: string | null | undefined): string {
    return sanitizeGedcomDateValue(formatDateValue(dateStr));
}

function formatDateValue(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    // Re-emit approximate/range dates with the qualifier + GEDCOM-formatted inner
    // date(s), so an imported "ABT 1850" / "BET … AND …" round-trips (GED-4).
    const q = splitDateQualifier(dateStr);
    if (q) {
        if (q.prefix === 'PHRASE') return `(${q.parts[0]})`;
        const inner = q.parts.map(formatPlainGedcomDate);
        return q.sep ? `${q.prefix} ${inner[0]} ${q.sep} ${inner[1]}` : `${q.prefix} ${inner[0]}`;
    }
    return formatPlainGedcomDate(dateStr);
}

/**
 * The last guard on every value that becomes a `DATE` line.
 *
 * This is the load-bearing one, not `makeDatePhrase`: the import path is
 * deliberately verbatim and uncapped (`parseDate` keeps a bare `(phrase)` exactly
 * as the file wrote it, for round-trip fidelity), so an imported value reaches
 * the writer without ever having been cleaned. A newline here would terminate the
 * DATE line and let the rest of the value be read back as further GEDCOM lines —
 * one date value emitting a forged top-level record into the user's own export.
 *
 * Length is NOT capped here: capping on the way out would hand a user back an
 * altered copy of their own file. The cap belongs at entry (`makeDatePhrase`) and
 * at the API boundary (`validateDateField`).
 */
export function sanitizeGedcomDateValue(value: string): string {
    const cleaned = stripControlCharacters(value).replace(/\s+/g, ' ').trim();
    // A bare `@xref@`-shaped value is read as a pointer by strict parsers. `@@` is
    // GEDCOM 5.5.1's escape for a literal leading `@` in a line value (ged551-3
    // "escape"/`@@` rule), so doubling it keeps the text as text.
    return cleaned.startsWith('@') ? `@${cleaned}` : cleaned;
}

/** Format a plain ISO partial date to GEDCOM; pass non-ISO values through. */
function formatPlainGedcomDate(dateStr: string): string {
    const c = parseDateComponents(dateStr);
    if (!c) return dateStr;
    if (c.precision === 'year') return String(c.year);
    if (c.precision === 'year-month') return `${GEDCOM_MONTHS[c.month! - 1]} ${c.year}`;
    return `${c.day} ${GEDCOM_MONTHS[c.month! - 1]} ${c.year}`;
}

/** Convert a stored date to a display string suitable for editing in the DateInput field */
export function formatDateForInput(dateStr: string | null | undefined, locale: string = 'en'): string {
    return formatDateForDisplay(dateStr, locale);
}

// --- helpers ---

function pad(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}

function isValidDate(c: DateComponents): boolean {
    if (c.month !== undefined && (c.month < 1 || c.month > 12)) return false;
    if (c.day !== undefined && (c.day < 1 || c.day > 31)) return false;
    return true;
}
