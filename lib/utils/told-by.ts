/**
 * Fold an oral source's teller into its author (#470, ADR 0038). An empty author
 * takes the teller; a different author keeps its value and names the teller after
 * it. The v65 migration in `initializeSchema` applies the same rule in SQL, and the
 * GEDCOM importer applies it to `_TOLDBY` lines from older Heirloom exports.
 */
export function foldToldBy(author: string | null, toldBy: string | null | undefined): string | null {
    const teller = toldBy?.trim();
    if (!teller) return author;
    const own = author?.trim();
    if (!own) return teller;
    if (own === teller) return author;
    return `${author} (told by ${teller})`;
}
