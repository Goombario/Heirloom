/**
 * Display-name helpers. A person's effective first name is their primary name
 * variant (NameVariant with IsPrimary = 1) when one exists, otherwise the raw
 * `FirstName` column. Core read queries expose this as `EffectiveFirstName`
 * (see `lib/db/queries/people.ts`); these helpers apply the fallback for
 * consumers that render names.
 *
 * When the *preferred* name (the primary variant) is a nickname, queries expose
 * it as `Nickname` and the helpers integrate it into the given names with
 * quotes (e.g. William "Bill" Hartley David) rather than replacing the first
 * name with the nickname alone.
 *
 * The raw `FirstName` is still the value edited in the person form — only the
 * displayed name follows the primary variant.
 */
export interface DisplayNameParts {
    FirstName?: string | null;
    LastName?: string | null;
    EffectiveFirstName?: string | null;
    /** Set only when the person's preferred (primary) name is a nickname. */
    Nickname?: string | null;
}

/** The first name to show: primary variant if present, else the stored FirstName. */
export function displayFirstName(p: DisplayNameParts): string {
    return (p.EffectiveFirstName ?? p.FirstName ?? '').trim();
}

/**
 * The given-names portion of a name. When the preferred name is a nickname,
 * integrate it after the first given name: `First “Nickname” Middle…`. Uses the
 * raw `FirstName` (not the effective one, which would be the nickname alone).
 */
export function displayGivenNames(p: DisplayNameParts): string {
    const nickname = (p.Nickname ?? '').trim();
    if (!nickname) return displayFirstName(p);
    const parts = (p.FirstName ?? '').trim().split(/\s+/).filter(Boolean);
    const first = parts[0] ?? '';
    const middle = parts.slice(1).join(' ');
    return [first, `“${nickname}”`, middle].filter(Boolean).join(' ');
}

/** "First Last" — with the nickname integrated when the preferred name is one. */
export function displayFullName(p: DisplayNameParts): string {
    return `${displayGivenNames(p)} ${p.LastName ?? ''}`.trim();
}
