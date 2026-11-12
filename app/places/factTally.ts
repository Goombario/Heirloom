import type { PlaceFactLinkEntry } from '@/lib/data/types';

const KIND_TYPE = { birth: 'BIRT', death: 'DEAT', marriage: 'MARR' } as const;

/**
 * The records at a place, tallied by GEDCOM type, most first. Built from the fact
 * links, so births and deaths (which live on the person, not as event rows) count
 * alongside events and marriages, and the total matches the records count.
 */
export function factTally(links: readonly PlaceFactLinkEntry[]): { type: string; count: number }[] {
    const tally = new Map<string, number>();
    for (const l of links) {
        const type = l.kind === 'event' ? (l.eventType ?? 'EVEN') : KIND_TYPE[l.kind];
        tally.set(type, (tally.get(type) ?? 0) + 1);
    }
    return Array.from(tally.entries()).sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count }));
}
