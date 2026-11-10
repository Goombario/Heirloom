/**
 * The GEDCOM date-qualifier grammar, as this app stores it.
 *
 * This module reads and writes *stored* values only. It is deliberately strict:
 * `ABT 1850` is a stored form, `abt. 1850` is not. Entry leniency (case,
 * trailing periods, symbols, localised words) lives in `parseUserDateInput` and
 * `hoistQualifier`, never here — loosening this module would make forms this app
 * never writes, and GEDCOM does not define, into accepted storage.
 *
 * Pure: no React, no next-intl. The server-side GEDCOM paths use it with no
 * translation context, so any translated word is passed in by the caller.
 */

/** DATE_PHRASE is capped at 35 characters (ged551-3.txt:379). */
export const DATE_PHRASE_MAX = 35;

type SplitPrefix =
    | 'ABT' | 'EST' | 'CAL' | 'BEF' | 'AFT' | 'INT'
    | 'BET' | 'FROM' | 'TO'
    | 'PHRASE';

export interface SplitDate {
    prefix: SplitPrefix;
    /** Inner stored date(s); for PHRASE, the single phrase text without its parentheses. */
    parts: string[];
    sep: 'AND' | 'TO' | null;
}

/** Single-date approximation qualifiers stored as a prefix (GED-4). */
const DATE_QUALIFIER_PREFIXES = ['ABT', 'EST', 'CAL', 'BEF', 'AFT', 'INT'] as const;

/**
 * Split a stored date that carries a GEDCOM qualifier, range, or date phrase into
 * its prefix + inner part(s). Returns null for a plain date.
 */
export function splitDateQualifier(dateStr: string): SplitDate | null {
    const s = dateStr.trim();

    // Parentheses are authoritative and MUST be tested before the prefix table.
    // "(abt 1850)" is the phrase "abt 1850", not an ABT date: promoting it would
    // re-export a user's file with different content than it was imported with,
    // and "(abt the time of the fire)" would become the invalid `ABT the time…`.
    if (s.length >= 2 && s.startsWith('(') && s.endsWith(')')) {
        return { prefix: 'PHRASE', parts: [s.slice(1, -1)], sep: null };
    }

    const toks = s.split(/\s+/);
    if (toks.length < 2) return null;
    const up0 = toks[0].toUpperCase();

    if (up0 === 'BET') {
        const i = toks.findIndex((x) => x.toUpperCase() === 'AND');
        if (i > 1 && i < toks.length - 1) {
            return { prefix: 'BET', parts: [toks.slice(1, i).join(' '), toks.slice(i + 1).join(' ')], sep: 'AND' };
        }
    }
    if (up0 === 'FROM') {
        const i = toks.findIndex((x) => x.toUpperCase() === 'TO');
        if (i > 1 && i < toks.length - 1) {
            return { prefix: 'FROM', parts: [toks.slice(1, i).join(' '), toks.slice(i + 1).join(' ')], sep: 'TO' };
        }
        return { prefix: 'FROM', parts: [toks.slice(1).join(' ')], sep: null };
    }
    if (up0 === 'TO') {
        return { prefix: 'TO', parts: [toks.slice(1).join(' ')], sep: null };
    }
    if ((DATE_QUALIFIER_PREFIXES as readonly string[]).includes(up0)) {
        return { prefix: up0 as SplitPrefix, parts: [toks.slice(1).join(' ')], sep: null };
    }
    return null;
}

export function isDatePhrase(dateStr: string | null | undefined): boolean {
    return Boolean(dateStr && splitDateQualifier(dateStr)?.prefix === 'PHRASE');
}

/**
 * The free-text phrase in a stored bare `(phrase)` or `INT <date> (phrase)`,
 * or null when the value has none.
 */
export function datePhraseText(dateStr: string | null | undefined): string | null {
    if (!dateStr) return null;
    const q = splitDateQualifier(dateStr);
    if (q?.prefix === 'PHRASE') return q.parts[0];
    if (q?.prefix !== 'INT') return null;
    const phrase = q.parts[0].match(/^[\s\S]*?\s*\(([^)]*)\)\s*$/);
    return phrase?.[1] ?? null;
}

/**
 * Replace every C0 control character (and DEL) with a space.
 *
 * Exported because two layers need exactly this rule: values entered through
 * `makeDatePhrase`, and — load-bearingly — every value the GEDCOM writer emits,
 * since imported values never pass through `makeDatePhrase`. A GEDCOM line is
 * newline delimited, so a newline surviving into a stored date ends the `DATE`
 * line on export and lets the remainder be read back as further GEDCOM lines:
 * one date value becoming a forged top-level record inside the user's own
 * export or backup.
 */
export function stripControlCharacters(text: string): string {
    return text.replace(/[\u0000-\u001F\u007F]+/g, ' ');
}

/**
 * Everything `makeDatePhrase` does except the cap: strip control characters (see
 * `stripControlCharacters`), then parentheses — they delimit the phrase in GEDCOM
 * and cannot appear inside it — then collapse runs of whitespace, so the cap
 * counts real characters rather than padding.
 */
function cleanPhraseText(text: string): string {
    return stripControlCharacters(text)
        .replace(/[()]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Wrap free text as a stored date phrase, cleaned and capped at DATE_PHRASE_MAX.
 * Returns '' for text that is empty once cleaned.
 */
export function makeDatePhrase(text: string): string {
    const cleaned = cleanPhraseText(text).slice(0, DATE_PHRASE_MAX).trim();
    return cleaned ? `(${cleaned})` : '';
}

/**
 * Whether storing this text as a phrase would have to shorten it.
 *
 * Shares `cleanPhraseText` with `makeDatePhrase` on purpose: the UI asks this to
 * decide whether to warn, then stores via `makeDatePhrase`, and a second
 * hand-rolled length test would eventually disagree with the real cap.
 */
export function phraseWouldTruncate(text: string): boolean {
    return cleanPhraseText(text).length > DATE_PHRASE_MAX;
}

/** The qualifier menu, in display order (§2). INT is deliberately absent. */
export const QUALIFIER_OPTIONS = [
    'EXACT', 'ABT', 'EST', 'CAL', 'BEF', 'AFT', 'BET', 'FROM',
] as const;

type QualifierOption = (typeof QUALIFIER_OPTIONS)[number];

/**
 * The control's mode. `PHRASE` (free text) and `RAW` (an INT value being edited)
 * are reachable states with no menu entry: offering free text up front would
 * invite it where a real date is known, and INT requires a date *and* a phrase.
 */
export type DateInputMode = QualifierOption | 'PHRASE' | 'RAW';

export interface DateInputParts {
    qualifier: DateInputMode;
    /** Plain stored date; phrase text in PHRASE mode; the whole value in RAW mode. */
    first: string;
    /** Plain stored date; only meaningful for BET and FROM. */
    second: string;
}

/**
 * Build the stored string from the control's state. An empty box stores nothing
 * whatever the select says, so Exact can never produce wrong data.
 *
 * Half-known ranges (§2): GEDCOM has no one-bound BET, so "between 1877 and an
 * unknown year" stores as `AFT 1877` — the same claim, legally written. A period
 * does have half forms, so FROM/TO keep theirs.
 */
export function composeDateValue(parts: DateInputParts): string {
    const a = parts.first.trim();
    const b = parts.second.trim();

    switch (parts.qualifier) {
        case 'PHRASE':
            return makeDatePhrase(a);
        case 'RAW':
        case 'EXACT':
            return a;
        case 'BET':
            if (a && b) return `BET ${a} AND ${b}`;
            if (a) return `AFT ${a}`;
            if (b) return `BEF ${b}`;
            return '';
        case 'FROM':
            if (a && b) return `FROM ${a} TO ${b}`;
            if (a) return `FROM ${a}`;
            if (b) return `TO ${b}`;
            return '';
        default:
            return a ? `${parts.qualifier} ${a}` : '';
    }
}

/** Read a stored string back into the control's state. Inverse of `composeDateValue`. */
export function decomposeDateValue(stored: string | null | undefined): DateInputParts {
    const s = stored?.trim() ?? '';
    if (!s) return { qualifier: 'EXACT', first: '', second: '' };

    const q = splitDateQualifier(s);
    // No qualifier: a plain date, or legacy text the parser never understood.
    // Either way it stays visible in the box rather than being silently dropped.
    if (!q) return { qualifier: 'EXACT', first: s, second: '' };

    if (q.prefix === 'PHRASE') return { qualifier: 'PHRASE', first: q.parts[0], second: '' };
    // INT carries both a date and a phrase and has no menu entry; edit it whole so
    // it round-trips exactly rather than being rebuilt from two halves.
    if (q.prefix === 'INT') return { qualifier: 'RAW', first: s, second: '' };
    if (q.prefix === 'BET') return { qualifier: 'BET', first: q.parts[0], second: q.parts[1] ?? '' };
    if (q.prefix === 'FROM') return { qualifier: 'FROM', first: q.parts[0], second: q.parts[1] ?? '' };
    if (q.prefix === 'TO') return { qualifier: 'FROM', first: '', second: q.parts[0] };
    return { qualifier: q.prefix as QualifierOption, first: q.parts[0], second: '' };
}

/**
 * Per-language word aliases for the three qualifiers people actually type.
 * The GEDCOM tokens are accepted unconditionally and are not listed here.
 */
export interface QualifierAliases {
    ABT: string[];
    BEF: string[];
    AFT: string[];
}

export interface HoistResult {
    qualifier: QualifierOption;
    /** Raw remainder text — the caller still runs it through parseUserDateInput. */
    first: string;
    second: string;
}

/**
 * Display words for the qualifier tags, injected by the caller. `date-utils` and
 * this module import no next-intl, because the server-side GEDCOM paths use them
 * with no translation context — so translation arrives as a plain object, and a
 * missing one falls back to the raw tag rather than crashing.
 */
export interface DateQualifierWords {
    ABT: string; EST: string; CAL: string; INT: string;
    BEF: string; AFT: string;
    BET: string; AND: string; FROM: string; TO: string;
}

/** Lowercase, strip a single trailing period. */
function normalizeWord(w: string): string {
    return w.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Pull a leading qualifier out of typed, pasted, or loaded text (§2a).
 *
 * This is where entry leniency lives — case, trailing periods, symbols, and
 * localised words. `splitDateQualifier` stays strict, because it also reads
 * *stored* values; loosening it there would make `ABT. 1850` an accepted storage
 * form this app never writes and GEDCOM does not define.
 *
 * A convenience, not the mechanism: the select already makes every qualifier
 * reachable, so a missing alias costs one extra interaction, not the feature.
 *
 * Returns null when nothing is hoistable — the caller then treats the text as a
 * plain date.
 */
export function hoistQualifier(input: string, aliases?: QualifierAliases): HoistResult | null {
    const s = input.trim();
    if (!s) return null;
    // Parentheses are authoritative: a phrase is never hoisted into a qualifier.
    if (s.startsWith('(')) return null;

    // --- Symbols: the app's own compact display forms from formatYearForDisplay.
    // A user who copies "~1876" off a timeline back into a date field was rejected
    // before this; accepting them closes that loop.
    const sym = s.match(/^([~<>])\s*(.+)$/);
    if (sym) {
        const qualifier = sym[1] === '~' ? 'ABT' : sym[1] === '<' ? 'BEF' : 'AFT';
        return { qualifier, first: sym[2].trim(), second: '' };
    }

    // --- Year range with a dash (hyphen, en dash, or em dash). Four digits on both
    // sides, so an ISO partial ("1945-03") can never match.
    const dash = s.match(/^(\d{4})\s*[-–—]\s*(\d{4})$/);
    if (dash) {
        return { qualifier: 'BET', first: dash[1], second: dash[2] };
    }

    const toks = s.split(/\s+/);
    const head = normalizeWord(toks[0]);
    const rest = toks.slice(1).join(' ').trim();

    // --- Two-token ranges, GEDCOM tokens only (the storage grammar, and what
    // imported files contain).
    if (head === 'bet') {
        const i = toks.findIndex((x) => normalizeWord(x) === 'and');
        if (i > 1 && i < toks.length - 1) {
            return { qualifier: 'BET', first: toks.slice(1, i).join(' '), second: toks.slice(i + 1).join(' ') };
        }
    }
    if (head === 'from') {
        const i = toks.findIndex((x) => normalizeWord(x) === 'to');
        if (i > 1 && i < toks.length - 1) {
            return { qualifier: 'FROM', first: toks.slice(1, i).join(' '), second: toks.slice(i + 1).join(' ') };
        }
        if (rest) return { qualifier: 'FROM', first: rest, second: '' };
    }
    if (head === 'to' && rest) {
        return { qualifier: 'FROM', first: '', second: rest };
    }

    if (!rest) return null;

    // --- Single-word head: GEDCOM tokens first, then this language's aliases.
    const TOKENS: Record<string, QualifierOption> = {
        abt: 'ABT', est: 'EST', cal: 'CAL', bef: 'BEF', aft: 'AFT',
    };
    if (TOKENS[head]) return { qualifier: TOKENS[head], first: rest, second: '' };

    for (const q of ['ABT', 'BEF', 'AFT'] as const) {
        if (aliases?.[q]?.some((a) => normalizeWord(a) === head)) {
            return { qualifier: q, first: rest, second: '' };
        }
    }

    return null;
}
