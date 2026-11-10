/**
 * Fold text for search: decompose (NFD), drop combining marks, lower-case, so
 * "Étienne" → "etienne", "Val-Brûlé" → "val-brule" and "Белозёрова" →
 * "белозерова" (#792). The client-side twin of the database's "SearchFold"
 * function (lib/db/init-schema.ts), for lists that filter in the browser.
 */
export function foldForSearch(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
