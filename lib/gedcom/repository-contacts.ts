// A repository's website, phone and email (ADR 0049). GEDCOM 5.5.1's ADDRESS_STRUCTURE
// allows up to three of each on a REPO record; the app models the first.

export interface RepositoryContacts {
    Website: string | null;
    Phone: string | null;
    Email: string | null;
}

const CONTACT_TAGS = { WWW: 'Website', PHON: 'Phone', EMAIL: 'Email' } as const;
const LINE = /^(\d{1,2}) (\S+)(?: (.*))?$/;

/**
 * Lifts the first `1 WWW`, `1 PHON` and `1 EMAIL` out of a REPO record's passthrough
 * lines (as `Repository."RawGedcom"` stores them). A line is lifted only when it has
 * a value and nothing under it; otherwise it stays, and so does every later line with
 * that tag, so "the first" always means the file's first. Other lines are untouched.
 * A merge passes the repository's `existing` values: where one is set, the file's
 * first line for it is dropped only when it says the same thing, and otherwise stays
 * raw, so a merge neither loses a different value nor writes the same one twice.
 */
export function liftRepositoryContacts(
    lines: readonly string[],
    existing: Partial<RepositoryContacts> = {},
): RepositoryContacts & { rest: string[] } {
    const out: RepositoryContacts = { Website: null, Phone: null, Email: null };
    const seen = new Set<string>();
    const rest: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const m = LINE.exec(lines[i].trimEnd());
        const tag = m?.[1] === '1' ? m[2] as keyof typeof CONTACT_TAGS : null;
        if (!tag || !(tag in CONTACT_TAGS) || seen.has(tag)) { rest.push(lines[i]); continue; }
        seen.add(tag);
        const next = lines[i + 1] ? Number(LINE.exec(lines[i + 1])?.[1] ?? 0) : 0;
        // Passthrough keeps the file's text, so GEDCOM's `@@` escape is still in it.
        const value = (m![3] ?? '').replace(/@@/g, '@').trim();
        if (value === '' || next > 1) { rest.push(lines[i]); continue; }
        const field = CONTACT_TAGS[tag];
        const have = existing[field];
        if (have != null) { if (have !== value) rest.push(lines[i]); continue; }
        out[field] = value;
    }
    return { ...out, rest };
}
