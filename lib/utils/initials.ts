/**
 * Returns 1–2 uppercase initials from a first and last name.
 *
 * - `getInitials("Dorothy", "Bramley")` → `"DB"`
 * - `getInitials("Dorothy", null)`      → `"D"`
 * - `getInitials(null, null)`           → `"?"`
 */
export function getInitials(
    firstName: string | null | undefined,
    lastName: string | null | undefined,
): string {
    const first = firstName?.charAt(0) ?? '';
    const last = lastName?.charAt(0) ?? '';
    return (first + last).toUpperCase() || '?';
}

/**
 * Initials from a single combined display name (first + last word). Strips
 * surrounding quotes so a quoted preferred/nickname token doesn't leak into the
 * initials (e.g. `'"Eddie" Windsor'` → `"EW"`). Delegates to `getInitials` so
 * the structured helper stays the single source of the first/last rule.
 *
 * Use `getInitials` directly when you already hold separate first/last fields;
 * reach for this only when the name arrives as one string (user names, place
 * labels, combined display names).
 */
export function initialsFromName(name: string | null | undefined): string {
    const words = String(name ?? '')
        .trim()
        .replace(/["“”]/g, '')
        .split(/\s+/)
        .filter(Boolean);
    if (words.length === 0) return '?';
    return getInitials(words[0], words.length > 1 ? words[words.length - 1] : undefined);
}
