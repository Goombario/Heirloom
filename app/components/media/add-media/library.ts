import type { MediaWithPerson } from '@/lib/db/schema';
import { isPdfMedia } from '@/lib/media/allowed-extensions';

/**
 * A custom data source for a record that isn't a `MediaOwnerTable` (a case, #926):
 * it loads its own candidates, already excluding what's attached, and attaches the
 * whole selection in one call.
 */
export interface MediaPickerSource {
    /** Identifies the record, so a different one reloads. */
    key: string;
    loadCandidates: () => Promise<MediaWithPerson[]>;
    attach: (mediaIds: number[]) => Promise<void>;
    /** Replaces the empty-library line, when the candidates are narrower than the library. */
    emptyLabel?: string;
    /** Names the one library section, for the same reason. */
    sectionTitle?: string;
}

/** The All · Photos · Documents filter over the library (#1204). */
export type MediaKindFilter = 'all' | 'photos' | 'documents';

/** Pure: drop media already attached to this owner, preserving order. */
export function excludeAttached<T extends { Id: number }>(all: T[], attachedIds: Set<number>): T[] {
    return all.filter((m) => !attachedIds.has(m.Id));
}

/** Pure: stable-partition media tagged to any owner-relevant person ID first. */
export function rankOwnerRelevant<T extends { Id: number; TaggedPersonIds?: number[] }>(
    items: readonly T[],
    relevantPersonIds: readonly number[],
): T[] {
    const { tagged, rest } = splitOwnerRelevant(items, relevantPersonIds);
    return [...tagged, ...rest];
}

/** Pure: the "Tagged with …" section and "Everything else", each in its original order. */
export function splitOwnerRelevant<T extends { Id: number; TaggedPersonIds?: number[] }>(
    items: readonly T[],
    relevantPersonIds: readonly number[],
): { tagged: T[]; rest: T[] } {
    if (relevantPersonIds.length === 0) return { tagged: [], rest: [...items] };
    const relevant = new Set(relevantPersonIds);
    const tagged: T[] = [];
    const rest: T[] = [];
    for (const item of items) {
        if ((item.TaggedPersonIds ?? []).some((id) => relevant.has(id))) tagged.push(item);
        else rest.push(item);
    }
    return { tagged, rest };
}

/** Lower-cased haystack for the search filter (title + linked/tagged person names). */
function searchHaystack(m: MediaWithPerson): string {
    return [
        m.Title,
        m.PersonFirstName,
        m.PersonLastName,
        ...(m.TaggedPersonNames ?? []),
        ...(m.LinkedPersonNames ?? []),
    ].filter(Boolean).join(' ').toLowerCase();
}

/** Pure: the library rows a search and the kind filter leave. */
export function filterLibrary(items: readonly MediaWithPerson[], query: string, kind: MediaKindFilter): MediaWithPerson[] {
    const q = query.trim().toLowerCase();
    return items.filter((m) => {
        if (kind === 'photos' && isPdfMedia(m)) return false;
        if (kind === 'documents' && !isPdfMedia(m)) return false;
        return !q || searchHaystack(m).includes(q);
    });
}
