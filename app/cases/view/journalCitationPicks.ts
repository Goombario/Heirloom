import type { Citation } from '@/lib/db/queries/citations';
import type { CaseCitation } from '@/lib/db/schema';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import type { CitationPick } from '@/app/components/AttachSourceSidebar';

/**
 * The cite sidebar's quick picks for a journal entry (#34, option A): the case's
 * own sources, then the citations on its linked people's facts. Picking one
 * prefills the entry's citation; saving still writes the entry its own row, so
 * an append-only entry (ADR 0042) never changes when the original is edited.
 */

/** The case's Sources section, in its order. */
export function caseCitationPicks(citations: CaseCitation[]): CitationPick[] {
    return citations.map((c) => ({
        key: `case:${c.Id}`,
        sourceId: c.SourceId,
        sourceTitle: c.sourceTitle,
        sourceType: c.sourceType,
        sourceRepo: c.sourceRepo,
        page: c.Page,
        quay: c.Quay,
        dataText: c.DataText,
        url: c.Url,
        context: null,
    }));
}

/**
 * Each linked person's citations, named by the person. One person citing the same
 * source with the same detail on several facts (a census page cited on birth,
 * residence and occupation) is offered once, since the copy would be the same.
 */
export function peopleCitationPicks(people: { id: number; name: string; citations: Record<string, Citation[]> }[]): CitationPick[] {
    const picks: CitationPick[] = [];
    for (const person of people) {
        const seen = new Set<string>();
        for (const list of Object.values(person.citations)) {
            for (const c of list) {
                if (c.FactTable === FACT_TABLES.CASE_COMMENTS) continue;
                const same = [c.SourceId, c.Page ?? '', c.Quay ?? '', c.DataText ?? '', c.Url ?? ''].join('\u0000');
                if (seen.has(same)) continue;
                seen.add(same);
                picks.push({
                    key: `person:${person.id}:${c.Id}`,
                    sourceId: c.SourceId,
                    sourceTitle: c.sourceTitle ?? null,
                    sourceType: c.sourceType ?? null,
                    sourceRepo: c.sourceRepo ?? null,
                    page: c.Page,
                    quay: c.Quay,
                    dataText: c.DataText,
                    url: c.Url ?? null,
                    context: person.name,
                });
            }
        }
    }
    return picks;
}
