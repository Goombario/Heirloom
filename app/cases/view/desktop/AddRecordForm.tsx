'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, SegmentedControl, cx, fieldClass } from '@/app/components/ui';
import { X } from '@/lib/icons';
import { displayFullName } from '@/lib/utils/names';
import { getDataClient } from '@/lib/data';
import type { CaseInformation, CaseLead, CasePersonRef, CaseSourceNature } from '@/lib/db/schema';
import type { CaseClaimInput, CaseFindingInput } from '@/lib/data/types';
import type { Source } from '@/lib/db/queries/sources';
import { ClaimForm } from './ClaimForm';
import { claimWhat } from './claims';

export interface AddRecordStart {
    /** The repository a site search found it in. */
    repository?: string;
    /** The request whose reply sent it. */
    requestId?: number;
}

/**
 * I have the record (#58): the source (one in the library or a new one), where
 * in it, a link, an image and a transcription; About this source; the leads it
 * helps; and what the record says, claim by claim. Conflicts are decided in the lead.
 */
export function AddRecordForm({ lead, leads, people, treeId, start, onSave }: {
    lead: CaseLead;
    /** Leads still open, which a record can be filed under. */
    leads: CaseLead[];
    people: CasePersonRef[];
    treeId: number | null;
    start?: AddRecordStart;
    /** Resolves false when the save failed, keeping the form. */
    onSave: (input: CaseFindingInput) => Promise<boolean>;
}) {
    const t = useTranslations('caseResearch');
    const id = useId();
    const [title, setTitle] = useState('');
    const [picked, setPicked] = useState<Source | null>(null);
    const [matches, setMatches] = useState<Source[]>([]);
    const [repository, setRepository] = useState(start?.repository ?? '');
    const [page, setPage] = useState('');
    const [url, setUrl] = useState('');
    const [transcription, setTranscription] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [nature, setNature] = useState<CaseSourceNature | ''>('');
    const [information, setInformation] = useState<CaseInformation | ''>('');
    const [leadIds, setLeadIds] = useState<number[]>([lead.Id]);
    const [claims, setClaims] = useState<CaseClaimInput[]>([]);
    const [adding, setAdding] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Library sources matching the title, to file the record under one already there.
    useEffect(() => {
        const q = title.trim();
        if (picked || q.length < 2) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            getDataClient().then((c) => c.sources.search(q, treeId))
                .then((rows) => { if (!cancelled) setMatches(rows.slice(0, 5)); })
                .catch(() => { if (!cancelled) setMatches([]); });
        }, 200);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [title, picked, treeId]);

    const shownMatches = picked || title.trim().length < 2 ? [] : matches;
    const ready = (picked != null || title.trim() !== '') && leadIds.length > 0 && !busy;
    const personName = (pid: number | null | undefined) => people.find((p) => p.Id === pid);

    const save = async () => {
        if (!ready) return;
        setBusy(true);
        setError(null);
        try {
            let mediaId: number | null = null;
            if (file) {
                const client = await getDataClient();
                mediaId = (await client.media.upload({ file, title: picked?.Title ?? title.trim() }, treeId)).Id;
            }
            const ok = await onSave({
                kind: 'record',
                leadIds,
                source: picked ? { id: picked.Id } : { title: title.trim(), repository: repository.trim() || null },
                page: page.trim() || null, url: url.trim() || null, transcription: transcription.trim() || null, mediaId,
                sourceNature: nature || null, information: information || null,
                requestId: start?.requestId ?? null,
                claims,
            });
            if (!ok) setBusy(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setBusy(false);
        }
    };

    const toggleLead = (leadId: number) => setLeadIds((list) => (list.includes(leadId) ? list.filter((x) => x !== leadId) : [...list, leadId]));

    return (
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <div className="grid gap-1.5 text-sm text-text-secondary">
                <label htmlFor={`${id}-source`}>{t('record_source')}</label>
                {picked ? (
                    <div className="flex items-center gap-2 rounded-btn border border-border bg-card-alt px-3 py-2">
                        <span className="grid min-w-0 flex-1">
                            <span className="text-sm text-text break-words">{picked.Title}</span>
                            <span className="text-meta text-text-muted">{t('record_in_library')}</span>
                        </span>
                        <button type="button" aria-label={t('record_other_source')} onClick={() => { setPicked(null); setTitle(''); }}
                            className="grid place-items-center w-7 h-7 rounded-full bg-transparent border-0 text-text-muted hover:text-text cursor-pointer focus-ring">
                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                    </div>
                ) : (
                    <>
                        <input id={`${id}-source`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} className={fieldClass()}
                            placeholder={t('record_source_hint')} autoComplete="off" />
                        {shownMatches.length > 0 && (
                            <ul aria-label={t('record_library_matches')} className="m-0 p-0 list-none grid rounded-btn border border-border bg-card overflow-hidden">
                                {shownMatches.map((s) => (
                                    <li key={s.Id} className="border-t border-border-light first:border-t-0">
                                        <button type="button" onClick={() => { setPicked(s); setMatches([]); }}
                                            className="grid w-full bg-transparent border-0 px-3 py-2 text-left cursor-pointer hover:bg-hover-surface focus-ring-inset">
                                            <span className="text-sm text-text">{s.Title}</span>
                                            {s.RepositoryName && <span className="text-meta text-text-muted">{s.RepositoryName}</span>}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                )}
            </div>
            {!picked && (
                <label className="grid gap-1.5 text-sm text-text-secondary">
                    {t('record_repository')}
                    <input value={repository} onChange={(e) => setRepository(e.target.value)} maxLength={500} className={fieldClass()} />
                </label>
            )}
            <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5 text-sm text-text-secondary">
                    {t('record_page')}
                    <input value={page} onChange={(e) => setPage(e.target.value)} maxLength={500} className={fieldClass()} />
                </label>
                <label className="grid gap-1.5 text-sm text-text-secondary">
                    {t('record_link')}
                    <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2000} className={fieldClass()} />
                </label>
            </div>
            <label className="grid gap-1.5 text-sm text-text-secondary">
                {t('record_image')}
                <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-text file:mr-3 file:h-8 file:cursor-pointer file:rounded-btn file:border file:border-solid file:border-border file:bg-card file:px-3 file:text-sm file:text-text" />
            </label>
            <label className="grid gap-1.5 text-sm text-text-secondary">
                {t('record_transcription')}
                <textarea rows={3} value={transcription} onChange={(e) => setTranscription(e.target.value)} className={cx(fieldClass(), 'resize-y')} />
            </label>

            <fieldset className="m-0 p-0 border-0 grid gap-2">
                <legend className="mb-1.5 text-sm font-semibold text-text">{t('about_source')}</legend>
                <SegmentedControl aria-label={t('source_nature')} value={nature} onChange={(v) => setNature(v as CaseSourceNature)} fullWidth
                    options={[{ v: 'original', l: t('nature_original') }, { v: 'derivative', l: t('nature_derivative') }, { v: 'authored', l: t('nature_authored') }]} />
                <SegmentedControl aria-label={t('source_information')} value={information} onChange={(v) => setInformation(v as CaseInformation)} fullWidth
                    options={[{ v: 'primary', l: t('information_primary') }, { v: 'secondary', l: t('information_secondary') }, { v: 'unknown', l: t('information_unknown') }]} />
            </fieldset>

            {leads.length > 1 && (
                <fieldset className="m-0 p-0 border-0 grid gap-1.5">
                    <legend className="mb-1.5 text-sm font-semibold text-text">{t('leads_it_helps')}</legend>
                    {leads.map((l) => (
                        <label key={l.Id} className="flex items-start gap-2 text-sm text-text cursor-pointer">
                            <input type="checkbox" checked={leadIds.includes(l.Id)} onChange={() => toggleLead(l.Id)} className="mt-0.5" />
                            <span className="break-words">{l.Question}</span>
                        </label>
                    ))}
                </fieldset>
            )}

            <section aria-labelledby={`${id}-claims`} className="grid gap-2">
                <h3 id={`${id}-claims`} className="m-0 text-sm font-semibold text-text">{t('record_says')}</h3>
                {claims.length > 0 && (
                    <ul className="m-0 p-0 list-none grid rounded-card border border-border overflow-hidden">
                        {claims.map((c, i) => {
                            const who = personName(c.personId);
                            return (
                                <li key={i} className="flex items-start gap-2 border-t border-border-light first:border-t-0 bg-card px-3 py-2 text-sm">
                                    <span className="grid min-w-0 flex-1">
                                        <span className="text-text"><span className="text-text-muted">{claimWhat(c.what, t)}</span> {[c.says, c.date, c.place].filter(Boolean).join(', ')}</span>
                                        <span className="text-meta text-text-muted">
                                            {[who ? displayFullName(who) : c.personName, c.evidence ? t(`evidence_${c.evidence}`) : null].filter(Boolean).join(' · ')}
                                        </span>
                                    </span>
                                    <button type="button" aria-label={t('remove_claim', { what: claimWhat(c.what, t) })} onClick={() => setClaims((list) => list.filter((_, j) => j !== i))}
                                        className="grid place-items-center w-7 h-7 rounded-full bg-transparent border-0 text-text-muted hover:text-text cursor-pointer focus-ring">
                                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {adding ? (
                    <ClaimForm people={people} onCancel={() => setAdding(false)} onAdd={(c) => { setClaims((list) => [...list, c]); setAdding(false); }} />
                ) : (
                    <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setAdding(true)}>{t('add_claim')}</Button>
                )}
            </section>

            {error && <p role="alert" className="m-0 text-sm text-error">{error}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <span className="text-meta text-text-muted">{t('conflicts_fine')}</span>
                <Button type="submit" disabled={!ready}>{t('add_to_case')}</Button>
            </div>
        </form>
    );
}
