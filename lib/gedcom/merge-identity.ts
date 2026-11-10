// Merge-import identity guard (#871).
//
// GEDCOM xrefs are document-local: almost every app numbers people from `@I1@`,
// so an xref match alone says nothing about whether two records are the same
// person. Merge import still uses the xref to find candidates (that is what makes
// re-merging the same file, or this tree's own export, idempotent), but only
// accepts a candidate whose name agrees with the incoming record and whose sex
// doesn't conflict. Anything else is imported as a new person.

import { normalizeNameText } from '../validation';

export interface IncomingIdentity {
  FirstName?: string | null;
  LastName?: string | null;
  Sex?: string | null;
}

export interface ExistingIdentity extends IncomingIdentity {
  /** Every `NameVariant.Name` the existing person carries (married names, AKAs, nicknames). */
  Variants: string[];
}

/** Case-, accent- and punctuation-insensitive tokens of a name. */
function nameTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  return normalizeNameText(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function binarySex(value: string | null | undefined): 'M' | 'F' | null {
  const first = value?.trim().charAt(0).toUpperCase();
  return first === 'M' || first === 'F' ? first : null;
}

/**
 * True when `existing` may be treated as the same person as `incoming`.
 *
 * Given names agree on their first token (middle names come and go), surnames on
 * their full token list; a name variant of the existing person also counts (a
 * married name, say). A part has to be present on both records or on neither:
 * "John" alone never matches "John Doe", so one shared token isn't enough.
 */
export function mergeIdentityAgrees(incoming: IncomingIdentity, existing: ExistingIdentity): boolean {
  const inSex = binarySex(incoming.Sex);
  const exSex = binarySex(existing.Sex);
  if (inSex && exSex && inSex !== exSex) return false;

  const inGiven = nameTokens(incoming.FirstName)[0] ?? null;
  const inSurname = nameTokens(incoming.LastName).join(' ') || null;
  const exGiven = nameTokens(existing.FirstName)[0] ?? null;
  const exSurname = nameTokens(existing.LastName).join(' ') || null;
  if (Boolean(inGiven) !== Boolean(exGiven) || Boolean(inSurname) !== Boolean(exSurname)) return false;

  const exGivens = new Set<string>(exGiven ? [exGiven] : []);
  const exSurnames = new Set<string>(exSurname ? [exSurname] : []);
  for (const variant of existing.Variants) {
    const tokens = nameTokens(variant);
    if (tokens.length === 0) continue;
    exGivens.add(tokens[0]);
    // A one-word variant may be a nickname or a bare married surname; a longer
    // one is a given name followed by a surname.
    exSurnames.add(tokens.length === 1 ? tokens[0] : tokens.slice(1).join(' '));
  }

  if (inGiven && !exGivens.has(inGiven)) return false;
  if (inSurname && !exSurnames.has(inSurname)) return false;
  return true;
}
