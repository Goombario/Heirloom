// A citation's record link (ADR 0025). GEDCOM has no link on a citation, so apps
// use their own tags under it: FTM's `_LINK`, `_URL`, and Ancestry's `WWW`.

/** Tags under a citation that import reads into `Citation."Url"`. */
const LINK_LINE = /^1 (?:_LINK|_URL|WWW)(?: (.*))?$/;
const CONC_LINE = /^2 CONC(?: (.*))?$/;
const LEVEL = /^(\d{1,2}) /;

/**
 * Lifts a citation's first link line out of its passthrough sub-lines (levels
 * relative to the citation's SOUR line, as `Citation."RawGedcom"` stores them).
 * The link's `CONC` lines are joined onto it. Lines after it, including any
 * further link line, are returned untouched. A first link line with a blank
 * value or any sub-line other than `CONC` isn't lifted, and nothing changes.
 */
export function liftCitationLink(lines: readonly string[]): { url: string | null; rest: string[] } {
    const at = lines.findIndex(line => LINK_LINE.test(line.trimEnd()));
    if (at === -1) return { url: null, rest: [...lines] };
    let url = LINK_LINE.exec(lines[at].trimEnd())?.[1] ?? '';
    let end = at + 1;
    for (; end < lines.length; end++) {
        const level = Number(LEVEL.exec(lines[end])?.[1] ?? 0);
        if (level <= 1) break;
        const conc = CONC_LINE.exec(lines[end].trimEnd());
        if (!conc) return { url: null, rest: [...lines] };
        url += conc[1] ?? '';
    }
    // Passthrough keeps the file's text, so GEDCOM's `@@` escape is still in it.
    url = url.replace(/@@/g, '@').trim();
    if (url === '') return { url: null, rest: [...lines] };
    return { url, rest: [...lines.slice(0, at), ...lines.slice(end)] };
}
