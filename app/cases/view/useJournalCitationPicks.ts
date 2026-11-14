'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import type { Citation } from '@/lib/db/queries/citations';
import type { CaseWithRelations } from '@/lib/db/schema';
import type { CitationPickGroup } from '@/app/components/AttachSourceSidebar';
import { caseCitationPicks, peopleCitationPicks } from './journalCitationPicks';

type PeopleCitations = { id: number; name: string; citations: Record<string, Citation[]> }[];

/**
 * The journal composer's citations to copy (#34): the case's sources at once, and
 * the linked people's citations once the cite sidebar opens. A person whose
 * citations fail to load is left out rather than failing the list.
 */
export function useJournalCitationPicks(caseData: CaseWithRelations | null, open: boolean, treeId: number | null): CitationPickGroup[] {
    const t = useTranslations('cases');
    const [people, setPeople] = useState<{ key: string; list: PeopleCitations } | null>(null);
    const casePeople = caseData?.people;
    const peopleKey = (casePeople ?? []).map((p) => p.Id).join(',');

    useEffect(() => {
        if (!open || !casePeople || casePeople.length === 0 || people?.key === peopleKey) return;
        let cancelled = false;
        (async () => {
            const client = await getDataClient();
            const list = await Promise.all(casePeople.map(async (p) => ({
                id: p.Id,
                name: [p.EffectiveFirstName ?? p.FirstName, p.LastName].filter(Boolean).join(' '),
                citations: await client.citations.listForPerson(p.Id, treeId).catch(() => ({} as Record<string, Citation[]>)),
            })));
            if (!cancelled) setPeople({ key: peopleKey, list });
        })();
        return () => { cancelled = true; };
    }, [open, casePeople, peopleKey, people?.key, treeId]);

    return useMemo(() => [
        { id: 'case', label: t('cite_pick_case'), picks: caseCitationPicks(caseData?.citations ?? []) },
        { id: 'people', label: t('cite_pick_people'), picks: people?.key === peopleKey ? peopleCitationPicks(people.list) : [] },
    ], [caseData?.citations, people, peopleKey, t]);
}
