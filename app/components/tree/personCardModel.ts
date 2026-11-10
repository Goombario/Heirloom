/**
 * Shared derivation for the tree's person cards (portrait `PersonNode` and
 * compact `PersonBarNode`). Both cards must interpret a person identically —
 * name abbreviation, initials, living status and the shown age — so that logic
 * lives here once instead of drifting between two components.
 */

import type { LivingStatus } from '@/lib/living';

/** A name token wrapped in quotes is the integrated nickname (e.g. "Ned"). */
function isNicknameToken(w: string): boolean {
  return /^["“].*["”]$/.test(w);
}

/**
 * Abbreviate middle names to initials when the name is long. The name already
 * reflects the person's primary name (resolved server-side from name variants),
 * with any preferred nickname integrated in quotes.
 *   "Osric Lionel Fairweather" → "Osric L. Fairweather"
 *   "Edmund \"Ned\" Ashby David Thornbury" → "\"Ned\" A. D. Thornbury"
 */
function getDisplayName(fullName: string): string {
  const name = fullName.trim();
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length <= 2 || name.length <= 15) return name;

  const last = words[words.length - 1];
  const middle = words.slice(1, -1);
  const nick = middle.find(isNicknameToken);

  // Long name with a nickname → drop the original first name, lead with the
  // nickname, keep middle names as initials (they distinguish people).
  if (nick) {
    const restInitials = middle.filter(w => !isNicknameToken(w)).map(w => w.charAt(0).toUpperCase() + '.');
    return [nick, ...restInitials, last].join(' ');
  }

  const first = words[0];
  const midInitials = middle.map(w => w.charAt(0).toUpperCase() + '.');
  return [first, ...midInitials, last].join(' ');
}

export interface PersonCardInput {
  name: string;
  isDeceased?: boolean | null;
  /** Computed server-side; a string such as "6mo" for infants. */
  age?: number | string;
}

export interface PersonCardModel {
  /** Abbreviated primary name for display. */
  displayName: string;
  /** One- or two-letter initials for the avatar fallback. */
  initials: string;
  /** The status the card's mark shows (#736). */
  status: LivingStatus;
  /** The age the card shows when ages are on, or null when it shows none. */
  age: string | null;
}

/**
 * Font size for a name when the canvas is zoomed out, shrunk so the longest
 * unbreakable word still fits `maxWidth`. Shared by PersonNode (portrait) and
 * PersonBarNode (bar), which pass their own width/max-size.
 */
export function getZoomedOutFontSize(displayName: string, maxWidth: number, maxFontSize: number): number {
  const charWidthRatio = 0.45; // approx char width as a fraction of font size (proportional sans)
  const longestSegment = displayName.split(/\s+/).reduce((a, b) => (a.length >= b.length ? a : b), '');
  const fittingSize = maxWidth / (longestSegment.length * charWidthRatio);
  return Math.floor(Math.min(maxFontSize, Math.max(10, fittingSize)));
}

export function personCardModel(person: PersonCardInput): PersonCardModel {
  const displayName = getDisplayName(person.name || 'Unknown');

  // Strip surrounding quotes so a nickname-led name yields a letter initial (P, not ").
  const nameWords = displayName.split(/\s+/).map(w => w.replace(/^["“]+|["”]+$/g, '')).filter(Boolean);
  const initials = nameWords.length >= 2
    ? (nameWords[0].charAt(0) + nameWords[nameWords.length - 1].charAt(0)).toUpperCase()
    : (nameWords[0]?.charAt(0) ?? '?').toUpperCase();

  const status: LivingStatus = person.isDeceased === true ? 'deceased'
    : person.isDeceased === false ? 'living'
    : 'unknown';

  // No age for an unknown status at 70+: it would read as the age of someone who
  // may well have died, so only the mark shows.
  const age = person.age === undefined
    || (status === 'unknown' && typeof person.age === 'number' && person.age >= 70)
    ? null
    : String(person.age);

  return {
    displayName,
    initials,
    status,
    age,
  };
}
