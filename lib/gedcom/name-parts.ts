// A person's name prefix, surname prefix and suffix (#37, ADR 0053). GEDCOM 5.5.1's
// PERSONAL_NAME_PIECES carries them as `NPFX`, `SPFX` and `NSFX` under `1 NAME`; the
// app models the first of each.

export interface NameParts {
    NamePrefix: string | null;
    SurnamePrefix: string | null;
    NameSuffix: string | null;
}

const PART_TAGS = { NPFX: 'NamePrefix', SPFX: 'SurnamePrefix', NSFX: 'NameSuffix' } as const;
const LINE = /^(\d{1,2}) (\S+)(?: (.*))?$/;

/** `text` with `part` taken off its front (or, for a suffix, its end) when it is a separate word there. */
function without(text: string | null, part: string, at: 'start' | 'end'): string | null {
    if (!text) return text;
    const t = text.trim();
    const p = part.trim();
    if (at === 'start' && t.length > p.length && t.toLocaleLowerCase().startsWith(`${p.toLocaleLowerCase()} `)) return t.slice(p.length).trim() || null;
    if (at === 'end' && t.length > p.length && t.toLocaleLowerCase().endsWith(` ${p.toLocaleLowerCase()}`)) return t.slice(0, t.length - p.length).trim() || null;
    return text;
}

/**
 * Lifts the first `2 NPFX`, `2 SPFX` and `2 NSFX` out of the primary NAME's passthrough
 * lines (as `People."NameRawGedcom"` stores them). A line is lifted only when it has a
 * value and nothing under it; otherwise it stays, and so does every later line with that
 * tag. Other lines (TYPE, FONE, …) are untouched.
 *
 * Many programs also write the pieces into the NAME text itself ("Dr Johann /von
 * Habsburg/ PhD"), which the import splits into the first and last name. So a prefix
 * at the front of the first name, a surname prefix at the front of the last name and a
 * suffix at the end of either are taken off them, and the name doesn't show them twice.
 */
export function liftNameParts(
    lines: readonly string[],
    name: { FirstName: string | null; LastName: string | null },
): NameParts & { FirstName: string | null; LastName: string | null; rest: string[] } {
    const out: NameParts = { NamePrefix: null, SurnamePrefix: null, NameSuffix: null };
    const seen = new Set<string>();
    const rest: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const m = LINE.exec(lines[i].trimEnd());
        const tag = m?.[1] === '2' ? m[2] as keyof typeof PART_TAGS : null;
        if (!tag || !(tag in PART_TAGS) || seen.has(tag)) { rest.push(lines[i]); continue; }
        seen.add(tag);
        const next = lines[i + 1] ? Number(LINE.exec(lines[i + 1])?.[1] ?? 0) : 0;
        // Passthrough keeps the file's text, so GEDCOM's `@@` escape is still in it.
        const value = (m![3] ?? '').replace(/@@/g, '@').trim();
        if (value === '' || next > 2) { rest.push(lines[i]); continue; }
        out[PART_TAGS[tag]] = value;
    }
    let { FirstName, LastName } = name;
    if (out.NamePrefix) {
        // "1 NAME Rev. /Jones/" with "2 NPFX Rev.": the first name was only the prefix.
        if (LastName && FirstName?.trim().toLocaleLowerCase() === out.NamePrefix.toLocaleLowerCase()) FirstName = null;
        else FirstName = without(FirstName, out.NamePrefix, 'start');
    }
    if (out.SurnamePrefix) LastName = without(LastName, out.SurnamePrefix, 'start');
    if (out.NameSuffix) {
        const last = without(LastName, out.NameSuffix, 'end');
        if (last !== LastName) LastName = last;
        else FirstName = without(FirstName, out.NameSuffix, 'end');
    }
    return { ...out, FirstName, LastName, rest };
}

/** The `1 NAME` text with every piece: "Dr Johann /von Habsburg/ PhD". */
export function gedcomNameText(p: Partial<NameParts> & { FirstName?: string | null; LastName?: string | null }): string {
    const given = [p.NamePrefix, p.FirstName].filter(Boolean).join(' ');
    const surname = [p.SurnamePrefix, p.LastName].filter(Boolean).join(' ');
    return [given, `/${surname}/`, p.NameSuffix].filter(Boolean).join(' ');
}
