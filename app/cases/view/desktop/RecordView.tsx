'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from '@/app/components/ExternalLink';
import MediaImg from '@/app/components/MediaImg';
import type { CaseFinding, CaseLead, Media } from '@/lib/db/schema';
import { claimWhat } from './claims';

/**
 * The Record tab (#58): one finding's source as it was added: where in it, the
 * link, the scan, the transcription, what kind of source it is, the leads it
 * is filed under and what it says.
 */
export function RecordView({ finding, leads, treeId, onOpenMedia }: {
    finding: CaseFinding;
    leads: CaseLead[];
    treeId: number | null;
    onOpenMedia: (media: Media) => void;
}) {
    const t = useTranslations('caseResearch');
    const c = finding.citation;
    const filed = leads.filter((l) => finding.leadIds.includes(l.Id));
    const kind = [finding.SourceNature && t(`nature_${finding.SourceNature}`), finding.Information && t(`information_${finding.Information}`)].filter(Boolean).join(' · ');
    const rows: Array<[string, React.ReactNode]> = [];
    if (c?.sourceRepo) rows.push([t('record_repository'), c.sourceRepo]);
    if (c?.Page) rows.push([t('record_page'), c.Page]);
    if (c?.Url) rows.push([t('record_link'), <ExternalLink key="u" href={c.Url} className="text-link underline break-all">{c.Url}</ExternalLink>]);
    if (kind) rows.push([t('about_source'), kind]);
    if (filed.length > 0) rows.push([t('filed_under'), filed.map((l) => l.Question).join(' · ')]);

    return (
        <article aria-labelledby="record-title" className="grid gap-4">
            <h3 id="record-title" className="m-0 serif text-md font-semibold text-text break-words">{c?.sourceTitle || t('untitled_record')}</h3>
            {rows.length > 0 && (
                <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                    {rows.map(([label, value]) => (
                        <div key={label} className="contents">
                            <dt className="text-text-muted">{label}</dt>
                            <dd className="m-0 text-text break-words">{value}</dd>
                        </div>
                    ))}
                </dl>
            )}
            {finding.media && (
                <button type="button" onClick={() => onOpenMedia(finding.media!)} aria-label={t('open_scan')}
                    className="block overflow-hidden rounded-btn border border-border bg-card-alt p-0 cursor-zoom-in focus-ring">
                    <MediaImg mediaId={finding.media.Id} contentType={finding.media.ContentType} treeId={treeId} width={640} alt="" style={{ width: '100%', height: 'auto' }} />
                </button>
            )}
            {c?.DataText && (
                <section aria-labelledby="record-transcription" className="grid gap-1.5">
                    <h4 id="record-transcription" className="eyebrow m-0 text-text-muted">{t('record_transcription')}</h4>
                    <p className="m-0 whitespace-pre-wrap text-sm text-text-secondary">{c.DataText}</p>
                </section>
            )}
            {finding.claims.length > 0 && (
                <section aria-labelledby="record-says" className="grid gap-1.5">
                    <h4 id="record-says" className="eyebrow m-0 text-text-muted">{t('record_says')}</h4>
                    <ul className="m-0 p-0 list-none grid gap-1 text-sm">
                        {finding.claims.map((cl) => (
                            <li key={cl.Id}>
                                <span className="text-text-muted">{claimWhat(cl.What, t)}</span>{' '}
                                <span className="text-text">{[cl.Says, cl.Date, cl.Place].filter(Boolean).join(', ') || t('says_nothing')}</span>
                                {cl.Evidence && <span className="text-text-muted"> · {t(`evidence_${cl.Evidence}`)}</span>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            {finding.Note && <p className="m-0 text-sm text-text-secondary whitespace-pre-wrap">{finding.Note}</p>}
        </article>
    );
}
