// One entry per PERSON, from the one-row-per-FACT payload the place detail ships.
//
// The service deliberately returns a row per fact, because the place page's job is
// to say *why* each person is tied to the place. Rendering that list verbatim meant
// a person born, married and resident in one town took three rows, and on a rolled-up
// jurisdiction the repetition dominated the pane. Grouping keeps every reason while
// saying the name once. Pure and separately tested — the ordering rules are the
// interesting part, and they should not need a render to verify.

import type { PlaceFactLinkEntry } from '@/lib/data/types';

export interface PersonFactGroup {
  personId: number;
  name: string;
  sex: string | null;
  primaryMediaId: number | null;
  /** Focal crop of `primaryMediaId`, carried through so the row's avatar shows
   *  the face rather than a centred crop of the whole photo. */
  focalX: number | null;
  focalY: number | null;
  focalRadius: number | null;
  /** This person's facts at the place, earliest first, undated last. */
  facts: PlaceFactLinkEntry[];
}

/**
 * A string-comparable key for a stored date.
 *
 * Raw `<` on the stored string is NOT safe here, and the pane now drops what it
 * mis-sorts (only `MAX_REASONS_PER_PERSON` reasons render). Three shapes reach
 * this list and only the first sorts lexically:
 *   - `People.BirthDate` / `DeathDate` / `Families.MarriageDate` — ISO partials
 *     from `parseDate` ("1945", "1945-03", "1945-03-15").
 *   - `Events."Date"` — stored RAW from GEDCOM (`lib/gedcom/parser.ts`, the
 *     non-BIRT/DEAT branch), so "14 JUN 1921" compares BEFORE "1888-02-02".
 *   - Qualified dates ("ABT 1876", "BET 1877 AND 1880") — 'A' > '1', so every
 *     estimate sorted after every exact date.
 * So key on the year first (the signal that actually orders a life), then the
 * ISO remainder when the string is a clean ISO partial. Anything with no
 * 4-digit run sorts with the undated.
 */
function dateSortKey(date: string): string | null {
  const year = date.match(/\d{4}/)?.[0];
  if (!year) return null;
  // "1945-03-15" → "1945-03-15"; "14 JUN 1921" → "1921" (month/day unresolved,
  // deliberately — guessing at GEDCOM month names here would be a date parser).
  const iso = date.match(/^\d{4}(-\d{2}){0,2}$/)?.[0];
  return iso ?? year;
}

/** Sort key: dates ascending, undated after everything dated, then kind for stability. */
function compareFacts(a: PlaceFactLinkEntry, b: PlaceFactLinkEntry): number {
  const ka = a.date ? dateSortKey(a.date) : null;
  const kb = b.date ? dateSortKey(b.date) : null;
  if (ka && kb) return ka < kb ? -1 : ka > kb ? 1 : a.kind.localeCompare(b.kind);
  if (ka) return -1;
  if (kb) return 1;
  return a.kind.localeCompare(b.kind);
}

/**
 * Group fact links by person, preserving the order people first appear in — the
 * query already sorts by name, so the rendered list stays alphabetical without
 * this helper needing to know that.
 */
export function groupFactLinks(links: PlaceFactLinkEntry[]): PersonFactGroup[] {
  const byPerson = new Map<number, PersonFactGroup>();
  for (const link of links) {
    let group = byPerson.get(link.personId);
    if (!group) {
      group = {
        personId: link.personId,
        name: link.name,
        sex: link.sex,
        primaryMediaId: link.primaryMediaId,
        focalX: link.focalX,
        focalY: link.focalY,
        focalRadius: link.focalRadius,
        facts: [],
      };
      byPerson.set(link.personId, group);
    }
    group.facts.push(link);
  }
  const groups = Array.from(byPerson.values());
  for (const group of groups) group.facts.sort(compareFacts);
  return groups;
}
