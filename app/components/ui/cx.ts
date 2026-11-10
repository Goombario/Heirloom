/** Join class fragments, dropping falsy ones. The canonical class-merge helper
 *  for ui/* primitives (utility strings in TSX). No dependency; appends
 *  caller `className` last so consumer overrides win on equal specificity. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
