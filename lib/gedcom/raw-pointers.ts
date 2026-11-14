/**
 * Pointers kept in GEDCOM passthrough (#979).
 *
 * A kept line such as `2 SOUR @S20@` names a record by the SOURCE file's xref, but
 * export mints its own xrefs, so the pointer would name nothing or the wrong
 * record. So the import stores a pointer as the record's id, and export rewrites
 * it to the xref it minted for that record:
 *
 * - parse time: `@S20@` → a marker `@~?S:S20@` (the record's kind and file xref);
 * - end of import: the marker → a token `@~S:<Sources.Id>@`;
 * - export: the token → the export's own xref, such as `@S19@`.
 *
 * A pointer to a record the app doesn't keep (SUBM, a vendor record, a missing
 * one) is dropped with its sub-lines, and the import report counts it.
 */

export type RawPointerKind = 'S' | 'N' | 'O' | 'I' | 'F' | 'R';

const KIND_BY_RECORD: Record<string, RawPointerKind> = {
  // REPO (#985): Legacy's `1 _TODO` keeps a `2 REPO @R1@`.
  SOUR: 'S', NOTE: 'N', SNOTE: 'N', OBJE: 'O', INDI: 'I', FAM: 'F', REPO: 'R',
};

/** A line whose whole value is one pointer. `@#D…@` is a date escape, not a pointer. */
const POINTER_LINE = /^(\d+) (\S+) @([^@#\s][^@\s]*)@$/;
const MARKER = /^~\?([SNOIFR]):(.+)$/;
const TOKEN = /^~([SNOIFR]):(\d+)$/;

/**
 * Rewrites each pointer line's xref (without its `@`s): a string replaces it,
 * null drops the line and its sub-lines, undefined keeps the line as it is.
 */
function rewritePointers(
  lines: readonly string[],
  rewrite: (xref: string, tag: string) => string | null | undefined,
): { lines: string[]; dropped: string[] } {
  const out: string[] = [];
  const dropped: string[] = [];
  let skipBelow: number | null = null;
  for (const line of lines) {
    const level = parseInt(line, 10);
    if (skipBelow !== null && level > skipBelow) continue;
    skipBelow = null;
    const match = POINTER_LINE.exec(line.trim());
    const next = match ? rewrite(match[3], match[2]) : undefined;
    if (next === null) {
      dropped.push(match![2]);
      skipBelow = level;
    } else if (next !== undefined) {
      out.push(`${match![1]} ${match![2]} @${next}@`);
    } else {
      out.push(line);
    }
  }
  return { lines: out, dropped };
}

/**
 * Parse time: marks every pointer in passthrough lines with its record's kind, so
 * the import can resolve it to an id. `recordTypes` maps the file's `@xref@` to
 * its level-0 tag. Returns the tags of the pointer lines dropped.
 */
export function markRawPointers(lines: readonly string[], recordTypes: ReadonlyMap<string, string>): { lines: string[]; dropped: string[] } {
  return rewritePointers(lines, (xref) => {
    if (xref.startsWith('~')) return null; // a file can't be trusted to carry our markers
    const kind = KIND_BY_RECORD[recordTypes.get(`@${xref}@`) ?? ''];
    return kind ? `~?${kind}:${xref}` : null;
  });
}

/** Whether stored passthrough still holds a marker the import has to resolve. */
export const RAW_POINTER_MARKER = '@~?';

/** End of import: replaces each marker with its record's id, or drops it when the record wasn't kept. */
export function resolveRawPointerMarkers(
  raw: string,
  idOf: (kind: RawPointerKind, xref: string) => number | undefined,
): { raw: string | null; dropped: string[] } {
  const result = rewritePointers(raw.split('\n'), (xref) => {
    const marker = MARKER.exec(xref);
    if (!marker) return undefined;
    const id = idOf(marker[1] as RawPointerKind, `@${marker[2]}@`);
    return id === undefined ? null : `~${marker[1]}:${id}`;
  });
  return { raw: result.lines.length ? result.lines.join('\n') : null, dropped: result.dropped };
}

/**
 * Export: rewrites each token to the xref the export minted for its record, and
 * drops one whose record isn't in the export (or a marker an import never resolved).
 */
export function resolveRawPointerTokens(
  lines: readonly string[],
  xrefOf: (kind: RawPointerKind, id: number) => string | undefined,
): string[] {
  return rewritePointers(lines, (xref) => {
    if (!xref.startsWith('~')) return undefined;
    const token = TOKEN.exec(xref);
    const target = token ? xrefOf(token[1] as RawPointerKind, Number(token[2])) : undefined;
    return target ? target.slice(1, -1) : null;
  }).lines;
}

/**
 * Export: drops every pointer line (and its sub-lines) whose xref no `0 @X@`
 * record in the file defines. A passthrough pointer from before #979 still
 * carries its source file's xref, and this keeps it from dangling.
 */
export function dropDanglingPointers(lines: readonly string[]): string[] {
  const defined = new Set<string>();
  for (const line of lines) {
    const match = /^0 (@[^@\s]+@) /.exec(line);
    if (match) defined.add(match[1]);
  }
  return rewritePointers(lines, (xref) => (defined.has(`@${xref}@`) ? undefined : null)).lines;
}

const RAW_POINTER_MASK = /@[^@\s]+@/g;

/** Pointer values masked, so merge identity compares passthrough whatever form its pointers are in. */
export function maskRawPointers(raw: string | null): string | null {
  return raw === null ? null : raw.replace(RAW_POINTER_MASK, '@@');
}

/** {@link maskRawPointers} for a SQL column. */
export function maskRawPointersSql(column: string): string {
  return `regexp_replace(${column}, '@[^@[:space:]]+@', '@@', 'g')`;
}

/** What a stale media pointer's value becomes, so the token pass drops it and the export can count it first. */
const STALE_MEDIA_POINTER = '~stale:O';
const STALE_MEDIA_LINE = new RegExp(`^\\d+ OBJE @${STALE_MEDIA_POINTER}@$`);

/**
 * Export: marks every `OBJE` pointer in passthrough that isn't a token. Such a
 * pointer was kept before #979 and names its image by the source file's xref,
 * which the export renumbers, and `Media` keeps no xref to match it by, so it
 * would point at a different image or none (ADR 0030). A marked line is dropped
 * with its sub-lines by {@link resolveRawPointerTokens}.
 */
export function markStaleMediaPointers(lines: readonly string[]): string[] {
  return rewritePointers(lines, (xref, tag) => (tag === 'OBJE' && !xref.startsWith('~') ? STALE_MEDIA_POINTER : undefined)).lines;
}

/** How many lines {@link markStaleMediaPointers} marked. */
export function countStaleMediaPointers(lines: readonly string[]): number {
  return lines.filter((line) => STALE_MEDIA_LINE.test(line)).length;
}

const CITATION_MEDIA_TOKEN = /^1 OBJE @~O:(\d+)@$/;

/**
 * End of import (#47): takes each file pointer out of a citation's passthrough so
 * it can become a citation media link. Only a citation's own `1 OBJE @~O:<id>@`
 * (levels relative to its SOUR) with no sub-lines is taken; a pointer carrying
 * sub-lines, or an inline OBJE, stays passthrough and still exports as it came.
 */
export function takeCitationMediaPointers(raw: string): { raw: string | null; mediaIds: number[] } {
  const lines = raw.split('\n');
  const kept: string[] = [];
  const mediaIds: number[] = [];
  lines.forEach((line, i) => {
    const match = CITATION_MEDIA_TOKEN.exec(line.trim());
    const next = lines[i + 1];
    const hasSubLines = next !== undefined && parseInt(next, 10) > 1;
    if (match && !hasSubLines) {
      const id = Number(match[1]);
      if (!mediaIds.includes(id)) mediaIds.push(id);
    } else {
      kept.push(line);
    }
  });
  return { raw: kept.length ? kept.join('\n') : null, mediaIds };
}
