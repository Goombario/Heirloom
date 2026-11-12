'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import MediaImg from '@/app/components/MediaImg';
import { FilterChip, SelectField, SectionHeader, cx } from '@/app/components/ui';
import type { CaseFinding, CaseLead, Media } from '@/lib/db/schema';
import { claimRelations } from './claims';

type Only = 'all' | 'accepted' | 'undecided' | 'nothing';

interface EvidenceRow {
    key: string;
    title: string;
    detail: string;
    findings: CaseFinding[];
    leadIds: number[];
    accepted: number;
    rejected: number;
    undecided: number;
    conflicts: number;
    nothing: boolean;
    at: string;
}

/** The case's evidence as rows: one per source (its findings together), one per nothing-found result. */
function evidenceRows(findings: readonly CaseFinding[]): EvidenceRow[] {
    const relations = claimRelations(findings.filter((f) => f.Kind === 'record'));
    const bySource = new Map<number, EvidenceRow>();
    const rows: EvidenceRow[] = [];
    for (const f of findings) {
        if (f.Kind === 'nothing' || !f.citation) {
            rows.push({
                key: `n${f.Id}`, title: f.Searched ?? '', detail: [f.Site, f.Note].filter(Boolean).join(' · '), findings: [f],
                leadIds: f.leadIds, accepted: 0, rejected: 0, undecided: 0, conflicts: 0, nothing: true, at: f.CreatedAt,
            });
            continue;
        }
        let row = bySource.get(f.citation.SourceId);
        if (!row) {
            row = {
                key: `s${f.citation.SourceId}`, title: f.citation.sourceTitle, detail: f.citation.sourceRepo ?? '', findings: [],
                leadIds: [], accepted: 0, rejected: 0, undecided: 0, conflicts: 0, nothing: false, at: f.CreatedAt,
            };
            bySource.set(f.citation.SourceId, row);
            rows.push(row);
        }
        row.findings.push(f);
        for (const id of f.leadIds) if (!row.leadIds.includes(id)) row.leadIds.push(id);
        if (f.CreatedAt > row.at) row.at = f.CreatedAt;
        for (const c of f.claims) {
            if (c.Decision === 'accepted') row.accepted++;
            else if (c.Decision === 'rejected') row.rejected++;
            else row.undecided++;
            if ((relations.get(c.Id)?.conflicts.length ?? 0) > 0) row.conflicts++;
        }
    }
    return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/**
 * All evidence (#58): every new source the case found, across leads, with how
 * its findings were decided and the leads it helps; filters by lead, Accepted,
 * Undecided and Nothing found; then the scans from these sources. Records
 * already in the library before the case stay in the library.
 */
export function EvidenceView({ findings, leads, treeId, onOpenRecord, onOpenMedia }: {
    findings: CaseFinding[];
    leads: CaseLead[];
    treeId: number | null;
    onOpenRecord: (finding: CaseFinding) => void;
    onOpenMedia: (media: Media) => void;
}) {
    const t = useTranslations('caseResearch');
    const format = useFormatter();
    const [lead, setLead] = useState<string>('all');
    const [only, setOnly] = useState<Only>('all');
    const rows = useMemo(() => evidenceRows(findings), [findings]);
    const leadName = (id: number) => leads.find((l) => l.Id === id)?.Question ?? '';

    const shown = rows.filter((r) => (lead === 'all' || r.leadIds.includes(Number(lead)))
        && (only === 'all' || (only === 'nothing' ? r.nothing : only === 'accepted' ? r.accepted > 0 : r.undecided > 0)));
    const media = shown.flatMap((r) => r.findings.flatMap((f) => (f.media ? [{ media: f.media, label: r.title }] : [])));

    const summary = (r: EvidenceRow) => {
        if (r.nothing) return t('evidence_nothing');
        if (r.accepted + r.rejected + r.undecided === 0) return t('evidence_no_claims');
        return [
            r.accepted > 0 && t('evidence_accepted', { count: r.accepted }),
            r.rejected > 0 && t('evidence_rejected', { count: r.rejected }),
            r.undecided > 0 && t('evidence_undecided', { count: r.undecided }),
            r.conflicts > 0 && t('evidence_conflicts', { count: r.conflicts }),
        ].filter(Boolean).join(' · ');
    };

    return (
        <article aria-labelledby="evidence-title" className="grid gap-5">
            <header className="grid gap-1">
                <p className="eyebrow m-0">{t('case_section')}</p>
                <h2 id="evidence-title" className="title m-0 serif text-text">{t('all_evidence')}</h2>
                <p className="m-0 text-sm text-text-muted">{t('evidence_intro')}</p>
            </header>

            <div className="flex flex-wrap items-center gap-2">
                <SelectField size="sm" width="w-56" aria-label={t('evidence_lead_filter')} value={lead} onChange={setLead}
                    options={[{ value: 'all', label: t('evidence_every_lead') }, ...leads.map((l) => ({ value: String(l.Id), label: l.Question }))]} />
                <div role="group" aria-label={t('evidence_show')} className="flex flex-wrap gap-1.5">
                    {(['all', 'accepted', 'undecided', 'nothing'] as Only[]).map((k) => (
                        <FilterChip key={k} active={only === k} onClick={() => setOnly(k)}>{t(`evidence_only_${k}`)}</FilterChip>
                    ))}
                </div>
            </div>

            {rows.length === 0 ? (
                <p className="m-0 text-sm text-text-muted">{t('evidence_empty')}</p>
            ) : shown.length === 0 ? (
                <p className="m-0 text-sm text-text-muted">{t('evidence_filtered')}</p>
            ) : (
                <ul className={cx('rounded-card', 'm-0 p-0 list-none border border-border overflow-hidden')}>
                    {shown.map((r) => {
                        const conflict = r.conflicts > 0;
                        return (
                            <li key={r.key} className="border-t border-border-light first:border-t-0 bg-card">
                                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-4 py-3">
                                    {r.nothing ? (
                                        <span className="text-sm font-medium text-text-secondary break-words">{t('nothing_found_in', { searched: r.title })}</span>
                                    ) : (
                                        <button type="button" onClick={() => onOpenRecord(r.findings[0])}
                                            className="justify-self-start bg-transparent border-0 p-0 text-left text-sm font-semibold text-text hover:underline cursor-pointer focus-ring rounded-sm break-words">
                                            {r.title || t('untitled_record')}
                                        </button>
                                    )}
                                    <span className="font-mono text-meta text-text-muted">{format.dateTime(new Date(r.at), { month: 'short', day: 'numeric' })}</span>
                                    <span className={cx('col-span-2 text-meta', conflict ? 'text-error' : 'text-text-secondary')}>{summary(r)}</span>
                                    {(r.detail || r.leadIds.length > 0) && (
                                        <span className="col-span-2 text-meta text-text-muted break-words">
                                            {[r.detail, r.leadIds.map(leadName).filter(Boolean).join(' · ')].filter(Boolean).join(' — ')}
                                        </span>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {media.length > 0 && (
                <section aria-labelledby="evidence-media" className="grid gap-2.5">
                    <SectionHeader level="label" headingId="evidence-media" title={t('evidence_scans')} count={media.length} />
                    <ul className="m-0 p-0 list-none grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
                        {media.map(({ media: m, label }) => (
                            <li key={m.Id}>
                                <button type="button" onClick={() => onOpenMedia(m)} className="grid w-full gap-1.5 bg-transparent border-0 p-0 text-left cursor-pointer focus-ring rounded-btn">
                                    <span className="block aspect-[4/3] overflow-hidden rounded-btn border border-border bg-card-alt">
                                        <MediaImg mediaId={m.Id} contentType={m.ContentType} treeId={treeId} width={264} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    </span>
                                    <span className="text-meta text-text line-clamp-2">{label || t('photo')}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </article>
    );
}
