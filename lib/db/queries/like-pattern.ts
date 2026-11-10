/**
 * The right-hand side of a "contains" LIKE/ILIKE: `'%' || <term> || '%'` with
 * the term's `\`, `%` and `_` escaped, so a literal "_" or "100%" in a search
 * matches only itself instead of acting as a wildcard (#849). The escaping runs
 * in SQL, after any folding of `term`, so Postgres and PGlite agree.
 *
 * `term` is a SQL expression built from a positional parameter, never user
 * text: `col LIKE ${likeContains('"SearchFold"($2)')}`.
 */
export function likeContains(term: string): string {
    return `'%' || replace(replace(replace(${term}, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%' ESCAPE '\\'`;
}
