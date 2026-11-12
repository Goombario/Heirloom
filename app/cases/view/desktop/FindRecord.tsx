'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SearchRecordsPanel } from '@/app/components/research/SearchRecordsPanel';
import { Button, SegmentedControl, cx, fieldClass } from '@/app/components/ui';
import { displayFullName } from '@/lib/utils/names';
import { leadResearchSubject, type ResearchSubject } from '@/lib/research/subject';
import { getDataClient } from '@/lib/data';
import type { CaseLead, CasePersonRef, CaseWithRelations } from '@/lib/db/schema';
import type { CaseFindingInput, CaseRequestInput } from '@/lib/data/types';
import { AddRecordForm, type AddRecordStart } from './AddRecordForm';
import { RequestForm } from './RequestForm';
import { yearsLabel } from './LeadsRail';

export type FindMode = 'search' | 'have' | 'request';
export interface FindStart extends AddRecordStart { mode: FindMode }

/** A person's search subject across the lead's years and the case's place; null while it loads or when it can't. */
function useLeadSubject(personId: number | null, treeId: number | null, scope: { fromYear: number | null; toYear: number | null; place: string | null }) {
    const [loaded, setLoaded] = useState<{ key: string; subject: ResearchSubject | null } | null>(null);
    const key = `${personId}:${scope.fromYear}:${scope.toYear}:${scope.place}`;
    useEffect(() => {
        if (personId == null) return;
        let cancelled = false;
        getDataClient().then((c) => c.people.get(personId, treeId))
            .then((person) => { if (!cancelled) setLoaded({ key, subject: leadResearchSubject(person, scope, new Date().getFullYear()) }); })
            .catch(() => { if (!cancelled) setLoaded({ key, subject: null }); });
        return () => { cancelled = true; };
        // scope is folded into key.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, personId, treeId]);
    return loaded?.key === key ? loaded : null;
}

/**
 * Find a record (#58), in the right column: Search a site, I have the record, or
 * Request it. A site that had nothing saves a nothing-found result on the lead;
 * one that had the record goes on to I have the record.
 */
export function FindRecord({ lead, leads, caseData, treeId, start, onAddFinding, onAddRequest }: {
    lead: CaseLead;
    leads: CaseLead[];
    caseData: CaseWithRelations;
    treeId: number | null;
    start: FindStart;
    onAddFinding: (input: CaseFindingInput) => Promise<boolean>;
    onAddRequest: (input: CaseRequestInput) => Promise<boolean>;
}) {
    const t = useTranslations('caseResearch');
    const [mode, setMode] = useState<FindMode>(start.mode);
    const [haveStart, setHaveStart] = useState<AddRecordStart | undefined>(start.mode === 'have' ? start : undefined);
    // The lead's people first, then the rest of the case's.
    const people: CasePersonRef[] = [...lead.people, ...caseData.people.filter((p) => !lead.people.some((l) => l.Id === p.Id))];
    const [personId, setPersonId] = useState<number | null>(people[0]?.Id ?? null);
    const scope = { fromYear: lead.FromYear ?? caseData.FromYear ?? null, toYear: lead.ToYear ?? caseData.ToYear ?? null, place: caseData.Place ?? null };
    const subject = useLeadSubject(personId, treeId, scope);
    const [nothing, setNothing] = useState<{ searched: string; site: string; note: string } | null>(null);
    const [busy, setBusy] = useState(false);

    const who = people.find((p) => p.Id === personId);
    const details = [
        who && { label: t('detail_name'), value: displayFullName(who) },
        yearsLabel(scope.fromYear, scope.toYear) && { label: t('years'), value: yearsLabel(scope.fromYear, scope.toYear)! },
        scope.place && { label: t('place'), value: scope.place },
        { label: t('question'), value: lead.Question },
    ].filter((d): d is { label: string; value: string } => Boolean(d));

    const saveNothing = async () => {
        if (!nothing || !nothing.searched.trim()) return;
        setBusy(true);
        const ok = await onAddFinding({ kind: 'nothing', leadIds: [lead.Id], searched: nothing.searched.trim(), site: nothing.site || null, note: nothing.note.trim() || null });
        setBusy(false);
        if (ok) setNothing(null);
    };

    return (
        <div className="grid gap-4">
            <SegmentedControl aria-label={t('find_how')} value={mode} onChange={(v) => setMode(v as FindMode)} fullWidth
                options={[{ v: 'search', l: t('find_search') }, { v: 'have', l: t('find_have') }, { v: 'request', l: t('find_request') }]} />

            {mode === 'search' && (
                <div className="grid gap-3">
                    {people.length > 1 && (
                        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('search_for')}>
                            {people.map((p) => (
                                <button key={p.Id} type="button" aria-pressed={p.Id === personId} onClick={() => setPersonId(p.Id)}
                                    className={cx('h-[30px] rounded-full px-3 text-sm cursor-pointer focus-ring border',
                                        p.Id === personId ? 'bg-segment-on text-on-segment border-segment-on' : 'bg-card text-text border-border')}>
                                    {displayFullName(p) || t('unnamed')}
                                </button>
                            ))}
                        </div>
                    )}
                    {nothing && (
                        <form className={cx('rounded-card', 'grid gap-2.5 border border-border bg-card-alt p-3')} onSubmit={(e) => { e.preventDefault(); void saveNothing(); }}>
                            <p className="m-0 text-sm font-semibold text-text">{t('nothing_title')}</p>
                            <label className="grid gap-1 text-meta text-text-secondary">
                                {t('nothing_searched')}
                                <input value={nothing.searched} onChange={(e) => setNothing({ ...nothing, searched: e.target.value })} maxLength={500} className={fieldClass('sm')} />
                            </label>
                            <label className="grid gap-1 text-meta text-text-secondary">
                                {t('nothing_note')}
                                <input value={nothing.note} onChange={(e) => setNothing({ ...nothing, note: e.target.value })} maxLength={1000} className={fieldClass('sm')} />
                            </label>
                            <div className="flex justify-end gap-2">
                                <Button variant="ghost" size="sm" onClick={() => setNothing(null)} disabled={busy}>{t('cancel')}</Button>
                                <Button type="submit" variant="outline" size="sm" disabled={busy || !nothing.searched.trim()}>{t('save_nothing')}</Button>
                            </div>
                        </form>
                    )}
                    {people.length === 0 ? (
                        <p className="m-0 text-sm text-text-muted">{t('search_no_people')}</p>
                    ) : !subject ? (
                        <p className="m-0 text-sm text-text-muted" role="status">{t('loading')}</p>
                    ) : !subject.subject ? (
                        <p className="m-0 text-sm text-text-muted">{t('search_unavailable')}</p>
                    ) : (
                        <div className="-mx-3 -mt-3">
                            <SearchRecordsPanel
                                key={personId ?? 0}
                                subject={subject.subject}
                                canCite
                                onFound={(site) => { setHaveStart({ repository: site.repository.name }); setMode('have'); }}
                                onNothing={(site) => setNothing({ searched: site.name, site: site.name, note: '' })}
                            />
                        </div>
                    )}
                </div>
            )}
            {mode === 'have' && (
                <AddRecordForm key={haveStart?.repository ?? haveStart?.requestId ?? 'new'} lead={lead} leads={leads} people={people} treeId={treeId} start={haveStart} onSave={onAddFinding} />
            )}
            {mode === 'request' && <RequestForm details={details} onSave={onAddRequest} />}
        </div>
    );
}
