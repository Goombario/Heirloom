'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import PersonAvatar from '@/app/components/PersonAvatar';
import MediaImg from '@/app/components/MediaImg';
import { Button, IconButton, cx } from '@/app/components/ui';
import { ChevronRight, Pencil, Plus } from '@/lib/icons';
import { initialsFromName } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import type { CaseCitation, CaseWithRelations } from '@/lib/db/schema';
import { LeadStatusDot } from './LeadStatus';
import type { LeadSummary, WorkspaceView } from './useCaseWorkspace';

/** The case's years as a range, or one end. */
export function yearsLabel(from: number | null | undefined, to: number | null | undefined): string | null {
    if (from != null && to != null) return from === to ? String(from) : `${from} – ${to}`;
    if (from != null) return `${from} –`;
    if (to != null) return `– ${to}`;
    return null;
}

/**
 * The workspace's left rail (#58, K1b): the leads as bordered buttons (status dot,
 * name, status; the open one filled navy) with + New lead by the heading; the
 * case's own pages; and About this case, a quiet panel with its edit pencil.
 */
export function LeadsRail({ caseData, treeId, summaries, view, evidenceCount, canEdit, closed = false, onOpen, onNewLead, onEditAbout, onAddPhotos, onOpenPhoto, onCite, onOpenCitation }: {
    caseData: CaseWithRelations;
    treeId: number | null;
    summaries: LeadSummary[];
    view: WorkspaceView | null;
    evidenceCount: number;
    canEdit: boolean;
    /** A closed case leads with its answer, and takes no new leads. */
    closed?: boolean;
    onOpen: (view: WorkspaceView) => void;
    onNewLead: () => void;
    onEditAbout: () => void;
    onAddPhotos: () => void;
    onOpenPhoto: (index: number) => void;
    /** Cite a library source on the case itself. */
    onCite: () => void;
    onOpenCitation: (citation: CaseCitation, anchor: HTMLElement) => void;
}) {
    const t = useTranslations('caseResearch');
    const years = yearsLabel(caseData.FromYear, caseData.ToYear);

    return (
        <nav aria-label={t('rail_label')} className="grid gap-6 content-start">
            <section aria-labelledby="leads-title" className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                    <h2 id="leads-title" className="eyebrow m-0">
                        {t('leads')} <span className="font-mono font-normal tracking-normal">{summaries.length}</span>
                    </h2>
                    {canEdit && !closed && (
                        <Button variant="ghost" size="sm" icon={<Plus className="w-3.5 h-3.5" aria-hidden="true" />} onClick={onNewLead}>
                            {t('new_lead')}
                        </Button>
                    )}
                </div>
                <ol className="m-0 p-0 list-none grid gap-2">
                    {summaries.map(({ lead, status }) => {
                        const current = view?.kind === 'lead' && view.leadId === lead.Id;
                        return (
                            <li key={lead.Id}>
                                <RailButton current={current} onClick={() => onOpen({ kind: 'lead', leadId: lead.Id })}>
                                    <LeadStatusDot status={status} className="mt-1 self-start" />
                                    <span className="grid min-w-0">
                                        <span className="text-sm font-medium leading-snug break-words">{lead.Question}</span>
                                        <span className={cx('text-meta', current ? 'lead-rail-current__sub' : 'text-text-muted')}>{t(`status_${status}`)}</span>
                                    </span>
                                </RailButton>
                            </li>
                        );
                    })}
                </ol>
            </section>

            <section aria-labelledby="case-pages-title" className="grid gap-2">
                <h2 id="case-pages-title" className="eyebrow m-0">{t('case_section')}</h2>
                {closed && (
                    <RailButton current={view?.kind === 'answer'} onClick={() => onOpen({ kind: 'answer' })} plain>
                        <span className="text-sm font-medium min-w-0 flex-1">{t('the_answer')}</span>
                    </RailButton>
                )}
                <RailButton current={view?.kind === 'evidence'} onClick={() => onOpen({ kind: 'evidence' })} plain>
                    <span className="text-sm font-medium min-w-0 flex-1">{t('all_evidence')}</span>
                    <span className={cx('font-mono text-meta', view?.kind === 'evidence' ? 'lead-rail-current__sub' : 'text-text-muted')}>{evidenceCount}</span>
                </RailButton>
            </section>

            <section aria-labelledby="about-title" className="grid gap-4 rounded-card bg-surface-2 p-4">
                <div className="flex items-center justify-between gap-2">
                    <h2 id="about-title" className="eyebrow m-0">{t('about_case')}</h2>
                    {canEdit && (
                        <IconButton label={t('edit_about')} onClick={onEditAbout} size="sm" icon={<Pencil className="w-3.5 h-3.5" aria-hidden="true" />} />
                    )}
                </div>
                {caseData.Description && <p className="m-0 text-sm text-text-secondary whitespace-pre-wrap break-words">{caseData.Description}</p>}
                <div className="grid gap-2">
                    <h3 className="eyebrow m-0 text-text-muted">{t('people')}</h3>
                    {caseData.people.length === 0 ? (
                        <p className="m-0 text-sm text-text-muted">{t('no_people')}</p>
                    ) : (
                        <ul className="m-0 p-0 list-none grid gap-1.5">
                            {caseData.people.map((p) => {
                                const name = displayFullName(p) || t('unnamed');
                                return (
                                    <li key={p.Id}>
                                        <Link href={`/people/view?id=${p.Id}`} className="flex items-center gap-2 text-sm text-text no-underline hover:underline focus-ring rounded-sm">
                                            <PersonAvatar as="span" size={24} treeId={treeId} mediaId={p.PrimaryMediaId} focalX={p.FocalX} focalY={p.FocalY} focalRadius={p.FocalRadius}
                                                sex={p.Sex} name={name} initials={initialsFromName(name)} />
                                            <span className="serif min-w-0 truncate">{name}</span>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
                {(years || caseData.Place) && (
                    <div className="grid gap-2">
                        <h3 className="eyebrow m-0 text-text-muted">{t('scope')}</h3>
                        <dl className="m-0 grid grid-cols-[56px_minmax(0,1fr)] gap-x-2 gap-y-1 text-sm">
                            {years && <><dt className="text-text-muted">{t('years')}</dt><dd className="m-0 date-mono">{years}</dd></>}
                            {caseData.Place && <><dt className="text-text-muted">{t('place')}</dt><dd className="m-0 text-text break-words">{caseData.Place}</dd></>}
                        </dl>
                    </div>
                )}
                <div className="grid gap-2">
                    <h3 className="eyebrow m-0 text-text-muted">{t('from_library')}</h3>
                    {caseData.media.length > 0 && (
                        <div className="grid grid-cols-4 gap-1.5">
                            {caseData.media.slice(0, 8).map((m, i) => (
                                <button key={m.Id} type="button" onClick={() => onOpenPhoto(i)} className="aspect-square overflow-hidden rounded-btn border-0 p-0 bg-card-alt cursor-pointer focus-ring" aria-label={m.Title || t('photo')}>
                                    <MediaImg mediaId={m.Id} contentType={m.ContentType} treeId={treeId} width={96} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="flex items-center justify-between gap-2 text-meta text-text-muted">
                        <span>{t('photos_added', { count: caseData.media.length })}</span>
                        {canEdit && <button type="button" onClick={onAddPhotos} className="bg-transparent border-0 p-0 text-meta text-link hover:underline cursor-pointer focus-ring rounded-sm">{t('add')}</button>}
                    </div>
                </div>
                {(caseData.citations.length > 0 || canEdit) && (
                    <div className="grid gap-2">
                        <h3 className="eyebrow m-0 text-text-muted">{t('case_sources')}</h3>
                        {caseData.citations.length > 0 && (
                            <ul className="m-0 p-0 list-none grid gap-1">
                                {caseData.citations.map((c) => (
                                    <li key={c.Id}>
                                        <button type="button" onClick={(e) => onOpenCitation(c, e.currentTarget)}
                                            className="w-full grid bg-transparent border-0 p-0 text-left cursor-pointer focus-ring rounded-sm">
                                            <span className="text-sm text-text hover:underline break-words">{c.sourceTitle ?? `#${c.SourceId}`}</span>
                                            {(c.Page ?? c.Note) && <span className="text-meta text-text-muted truncate">{c.Page ?? c.Note}</span>}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="flex items-center justify-between gap-2 text-meta text-text-muted">
                            <span>{t('sources_cited', { count: caseData.citations.length })}</span>
                            {canEdit && <button type="button" onClick={onCite} className="bg-transparent border-0 p-0 text-meta text-link hover:underline cursor-pointer focus-ring rounded-sm">{t('cite')}</button>}
                        </div>
                    </div>
                )}
                {(caseData.Tags?.length ?? 0) > 0 && (
                    <div className="grid gap-2">
                        <h3 className="eyebrow m-0 text-text-muted">{t('tags')}</h3>
                        <p className="m-0 text-sm text-text-secondary break-words">{caseData.Tags?.join(', ')}</p>
                    </div>
                )}
            </section>
        </nav>
    );
}

/** A rail row: bordered on white, filled with the band colour when it is the page shown
 *  (navy light, the band's brown dark; the old ink fill went white in dark mode). */
function RailButton({ current, onClick, plain = false, children }: { current: boolean; onClick: () => void; plain?: boolean; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={current ? 'page' : undefined}
            className={cx(
                'rounded-card',
                'w-full flex gap-2.5 border px-3 py-2.5 text-left cursor-pointer focus-ring',
                plain ? 'items-center' : 'items-start',
                current ? 'lead-rail-current' : 'bg-card text-text border-border hover:border-text-secondary',
            )}
        >
            {children}
            <ChevronRight className={cx('w-4 h-4 shrink-0 self-center', current ? 'lead-rail-current__sub' : 'text-text-muted')} aria-hidden="true" />
        </button>
    );
}
