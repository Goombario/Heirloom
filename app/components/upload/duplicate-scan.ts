import type { DuplicateMatch } from '@/lib/data/types';

/**
 * Why a row in the upload batch is flagged (#592).
 *
 * `in-batch` never reaches the server — the same file picked twice is decided
 * entirely from the hashes the client already computed.
 */
export type DuplicateKind = 'in-tree' | 'in-batch';

export interface DuplicateInfo {
    kind: DuplicateKind;
    /** The matched library photo's title; null when it has none. */
    title: string | null;
}

/** The minimum a row needs to take part in duplicate detection. */
export interface HashedRow {
    id: string;
    hash: string | null;
}

/**
 * Flags every occurrence of a hash after the first. The first stays unflagged
 * deliberately: picking the same file five times should still upload one copy
 * by default, not zero.
 */
export function markBatchDuplicates(rows: HashedRow[]): Record<string, DuplicateKind> {
    const seen = new Set<string>();
    const flagged: Record<string, DuplicateKind> = {};
    for (const row of rows) {
        if (!row.hash) continue;
        if (seen.has(row.hash)) flagged[row.id] = 'in-batch';
        else seen.add(row.hash);
    }
    return flagged;
}

/**
 * Spreads server matches across every row carrying a matched hash — the lookup
 * answers per hash, but several rows in one batch can share it.
 */
export function applyTreeMatches(
    rows: HashedRow[],
    matches: DuplicateMatch[],
): Record<string, DuplicateInfo> {
    const byHash = new Map(matches.map(m => [m.hash, m]));
    const out: Record<string, DuplicateInfo> = {};
    for (const row of rows) {
        if (!row.hash) continue;
        const match = byHash.get(row.hash);
        if (match) out[row.id] = { kind: 'in-tree', title: match.title };
    }
    return out;
}

/** One entry per distinct hash, so a batch of copies asks the server once. */
export function distinctHashes(rows: HashedRow[]): string[] {
    const seen = new Set<string>();
    for (const row of rows) {
        if (row.hash) seen.add(row.hash);
    }
    return [...seen];
}
