'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge } from '@/app/components/ui/Badge';
import { AvatarStack } from '@/app/components/ui/AvatarStack';
import { PROVES_GROUP_FROM, groupProvesRows } from '@/lib/library/proves-groups';
import PersonAvatar from '@/app/components/PersonAvatar';
import { OwnerNotesCard, NoteCount } from '@/app/components/notes/OwnerNotesCard';
import { OwnerMediaCard } from '@/app/components/media/OwnerMediaCard';
import { sourceTypeLabel } from '@/app/library/sourceTypes';
import { citedByLabel } from '@/lib/library/cited-by-label';
import { EVENT_TYPES, getEventDisplayType } from '@/lib/db/schema';
import { familyEventLabel } from '@/app/components/familyEventTypes';
import { formatDateForDisplay } from '@/lib/date-utils';
import { useLanguage } from '@/app/components/LanguageProvider';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { useFocusTrap } from '@/app/hooks/useFocusTrap';
import { ExternalLink as ExternalLinkIcon, ChevronRight, ChevronLeft, FolderSearch, Plus } from '@/lib/icons';
import { ExternalLink } from '@/app/components/ExternalLink';
import { Button } from '@/app/components/ui';
import type { CitedByRow } from '@/lib/db/queries/citations';
import type { Source } from '@/lib/data/types';

type T = ReturnType<typeof useTranslations>;

/** 1–2 uppercase initials from a "First Last" string. */
export function nameInitials(full: string): string {
    const parts = full.trim().split(/\s+/).filter(Boolean);
    const first = parts[0]?.charAt(0) ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (first + last).toUpperCase() || '?';
}

/** Identity block — type pill + serif title + optional URL. */
export function SourceIdentity({ source, titleId, t }: { source: Source; titleId: string; t: T }) {
    return (
        <>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Badge tone="neutral">
                    {sourceTypeLabel(source.Type, t)}
                </Badge>
            </div>
            <h2
                id={titleId}
                className="title-dialog text-text m-0"
            >
                {source.Title || t('untitled_source')}
            </h2>
            {source.Text && (
                <ExternalLink
                    href={source.Text}
                    title={t('external_link_label')}
                    aria-label={t('external_link_label')}
                    className="inline-flex items-center gap-1.5 mt-1.5 text-meta hover:underline"
                    style={{ color: 'var(--link)', wordBreak: 'break-all' }}
                >
                    <ExternalLinkIcon size={13} aria-hidden="true" className="shrink-0" />
                    {source.Text}
                </ExternalLink>
            )}
        </>
    );
}

/** Catalog details + the source's text, then the evidence ledger, notes and media. */
export function SourceDetailBody({ source, citedBy, isMobile, t, canEdit, canDelete, treeId, onCiteOn, citeOnRef }: {
    source: Source; citedBy: CitedByRow[]; isMobile: boolean; t: T; canEdit: boolean; canDelete: boolean; treeId: number | null;
    /** Opens "Cite on…" (#799); omitted for readers who can't edit. */
    onCiteOn?: () => void;
    citeOnRef?: React.Ref<HTMLButtonElement>;
}) {
    const tNotes = useTranslations('notes');
    const tMedia = useTranslations('ownerMedia');
    const [noteCount, setNoteCount] = React.useState(0);
    // Cases use a source; they aren't facts it proves, so they sit apart and
    // stay out of the count (#755).
    const isResearch = (row: CitedByRow) => row.factTable === 'Cases' || row.factTable === 'CaseComments';
    const factRows = citedBy.filter(row => !isResearch(row));
    const caseRows = citedBy.filter(isResearch);
    return (
        <>
            {/* Catalog details first: what the source is, before the facts it proves (#907).
                The ONLY place metadata renders. */}
            <div className="mb-5.5">
                <div className="eyebrow mb-2.5">
                    {t('catalog_details')}
                </div>
                <div
                    className="border border-[color:var(--border)] rounded-[12px] py-3.5 px-4 grid grid-cols-[96px_1fr] gap-y-[9px] gap-x-3 text-meta"
                    style={{ background: 'var(--card-alt)' }}
                >
                    <span style={{ color: 'var(--text-muted)' }}>{t('field_type')}</span>
                    <span>{sourceTypeLabel(source.Type, t)}</span>
                    {source.Author && (
                        <>
                            <span style={{ color: 'var(--text-muted)' }}>{t('field_author')}</span>
                            <span>{source.Author}</span>
                        </>
                    )}
                    {source.RepositoryName && (
                        <>
                            <span style={{ color: 'var(--text-muted)' }}>{t('field_repository')}</span>
                            <span>{source.RepositoryName}</span>
                        </>
                    )}
                    {source.CallNumber && (
                        <>
                            <span style={{ color: 'var(--text-muted)' }}>{t('detail_call_no')}</span>
                            <span style={{ fontFamily: 'var(--font-mono)' }}>{source.CallNumber}</span>
                        </>
                    )}
                    {source.PublicationInfo && (
                        <>
                            <span style={{ color: 'var(--text-muted)' }}>{t('detail_published')}</span>
                            <span>{source.PublicationInfo}</span>
                        </>
                    )}
                </div>

                {/* The source's text, for every type (#470) */}
                {source.Contents && (
                    <div className="mt-3.5">
                        <div className="eyebrow tracking-[0.06em] text-xs mb-1.5" style={{ textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                            {t('field_contents_label')}
                        </div>
                        <p className="text-sm leading-relaxed m-0" style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
                            {source.Contents}
                        </p>
                    </div>
                )}
            </div>

            {/* What this source proves */}
            <div className="flex items-center gap-2 mb-3">
                <h3 className="rail-title text-text m-0">
                    {t('proves_title')}
                </h3>
                {factRows.length > 0 && (
                    <Badge tone="evidence">{t('facts_count', { count: factRows.length })}</Badge>
                )}
                {onCiteOn && (
                    <Button ref={citeOnRef} variant="outline" size="sm" className="ml-auto" icon={<Plus size={14} aria-hidden="true" />} onClick={onCiteOn}>
                        {t('cite_on')}
                    </Button>
                )}
            </div>

            {citedBy.length === 0 ? (
                <div
                    className="text-center text-text-muted border border-dashed border-[color:var(--border)] rounded-[12px] p-6 text-sm"
                >
                    {t('nothing_cites')}
                </div>
            ) : (
                <div>
                    {factRows.length > 0 && <ProvesList rows={factRows} isMobile={isMobile} t={t} treeId={treeId} />}
                    {caseRows.length > 0 && (
                        <>
                            <h4 className={`rel-group-label mb-2 ${factRows.length > 0 ? 'mt-4' : 'mt-0'}`}>
                                {t('used_in_research')} <span>· {caseRows.length}</span>
                            </h4>
                            <div className="overflow-hidden border border-[color:var(--border)] rounded-[12px]">
                                {caseRows.map((row, i) => (
                                    <CitedByRowItem key={row.citationId} row={row} label={null} last={i === caseRows.length - 1} showChevron={!isMobile} treeId={treeId} />
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Notes */}
            <div className="mt-[18px]">
                <div className="eyebrow tracking-[0.06em] text-xs mb-2" style={{ textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                    {tNotes('section_title')} <NoteCount count={noteCount} />
                </div>
                <OwnerNotesCard
                    ownerTable="Sources"
                    ownerId={source.Id}
                    treeId={treeId}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    onNotesChange={(notes) => setNoteCount(notes.length)}
                />
            </div>

            {/* Media */}
            <div className="mt-[18px]">
                <div className="eyebrow tracking-[0.06em] text-xs mb-2" style={{ textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                    {tMedia('section_title')}
                </div>
                <OwnerMediaCard ownerTable="Sources" ownerId={source.Id} treeId={treeId} canEdit={canEdit} canDelete={canDelete} />
            </div>
        </>
    );
}

/** Full-screen mobile shell — fixed, slide-in, above the bottom tab bar (z-60). */
export function MobilePanel({ labelledBy, children }: { labelledBy?: string; children: React.ReactNode }) {
    const trapRef = useFocusTrap<HTMLDivElement>();
    return (
        <div
            ref={trapRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            className="md:hidden fixed inset-0 z-60 flex flex-col bg-card animate-push-in outline-none"
        >
            {children}
        </div>
    );
}

/** "‹ Library" back control — ≥44px touch target. */
export function MobileBackButton({ onBack, backLabel, ariaBack }: { onBack: () => void; backLabel: string; ariaBack: string }) {
    return (
        <button
            type="button"
            onClick={onBack}
            title={ariaBack}
            aria-label={ariaBack}
            className="inline-flex items-center gap-1 min-h-[44px] -ml-1 pr-2 rounded text-text-secondary hover:text-text transition text-base"
        >
            <ChevronLeft size={20} aria-hidden="true" />
            {backLabel}
        </button>
    );
}

/** Loading / not-found header with just the back control. */
export function MobilePanelHeader({ onBack, backLabel, ariaBack }: { onBack: () => void; backLabel: string; ariaBack: string }) {
    return (
        <div
            className="flex items-center gap-1.5 border-b border-border bg-card"
            style={{ padding: 'max(env(safe-area-inset-top), 18px) 14px 12px' }}
        >
            <MobileBackButton onBack={onBack} backLabel={backLabel} ariaBack={ariaBack} />
        </div>
    );
}

/**
 * A fact's label, the way the timeline labels it: "Education", never the raw
 * GEDCOM tag (#755). Null for a case, which is named by its title.
 */
function useFactLabel(t: T) {
    const tTypes = useTranslations('eventTypes');
    const tEvent = useTranslations('eventEdit');
    return (row: CitedByRow): string | null => {
        const { kind } = citedByLabel(row);
        if (kind === 'case') return null;
        if (kind !== 'event') return t(`kind_${kind}`);
        const type = row.eventType ?? '';
        if (row.personId == null && row.familyId != null) return familyEventLabel(type, tEvent);
        return EVENT_TYPES[type] ? tTypes(type as Parameters<typeof tTypes>[0]) : getEventDisplayType(type);
    };
}

/**
 * The facts a source proves (#911). The query orders them by year, then by
 * person. Below PROVES_GROUP_FROM they stay one flat list; from there they group by
 * fact type, groups in label order, collapsed to their counts, with Expand all.
 */
function ProvesList({ rows, isMobile, t, treeId }: { rows: CitedByRow[]; isMobile: boolean; t: T; treeId: number | null }) {
    const { language } = useLanguage();
    const labelOf = useFactLabel(t);
    const baseId = React.useId();
    const [open, setOpen] = React.useState<ReadonlySet<string>>(() => new Set());
    const box = 'overflow-hidden border border-[color:var(--border)] rounded-[12px]';
    const list = (items: CitedByRow[]) => items.map((row, i) => (
        <CitedByRowItem key={row.citationId} row={row} label={labelOf(row)} last={i === items.length - 1} showChevron={!isMobile} treeId={treeId} />
    ));

    if (rows.length < PROVES_GROUP_FROM) return <div className={box}>{list(rows)}</div>;

    const groups = groupProvesRows(rows, (row) => labelOf(row) ?? t('kind_unknown'), language);
    const allOpen = groups.every(([label]) => open.has(label));
    const toggle = (label: string) => setOpen((cur) => {
        const next = new Set(cur);
        if (next.has(label)) next.delete(label); else next.add(label);
        return next;
    });

    return (
        <div>
            <div className="flex justify-end mb-1.5">
                <Button variant="ghost" size="sm" onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map(([label]) => label)))}>
                    {allOpen ? t('collapse_all') : t('expand_all')}
                </Button>
            </div>
            <div className={box}>
                {groups.map(([label, items], gi) => {
                    const expanded = open.has(label);
                    const regionId = `${baseId}-group-${gi}`;
                    return (
                        <div key={label} className={gi === groups.length - 1 ? '' : 'border-b border-b-[color:var(--border-light)]'}>
                            <button
                                type="button"
                                aria-expanded={expanded}
                                aria-controls={regionId}
                                onClick={() => toggle(label)}
                                className="flex w-full items-center gap-2 min-h-[44px] px-3.5 py-2 bg-transparent border-0 text-left text-sm cursor-pointer transition-colors hover:bg-[color:var(--color-hover-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
                            >
                                <ChevronRight size={15} aria-hidden="true" className={`shrink-0 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`} />
                                <span className="font-semibold text-text">{label}</span>
                                <span className="text-text-muted tabular-nums">· {items.length}</span>
                            </button>
                            {expanded && (
                                <div id={regionId} className="border-t border-t-[color:var(--border-light)]">
                                    {list(items)}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/** One evidence-ledger row — avatar/case tile + serif label + kind pill + chevron (desktop only). */
function CitedByRowItem({ row, label, last, showChevron, treeId }: { row: CitedByRow; label: string | null; last: boolean; showChevron: boolean; treeId: number | null }) {
    const { language } = useLanguage();
    const dateWords = useDateQualifierWords();
    const { kind, subject, detail, date: eventDate, href } = citedByLabel(row);
    // Every dated fact shows its date now that the list is ordered by it (#911).
    const date = row.factDate ?? eventDate;
    const isCase = kind === 'case';
    const isFamily = row.personId == null && row.familyId != null;

    // Both partners of a cited family or family event, in the order the query returns them.
    const familyPartners = isFamily
        ? [
              { id: 1, name: row.familyPartner1Name, sex: row.familyPartner1Sex, mediaId: row.familyPartner1MediaId },
              { id: 2, name: row.familyPartner2Name, sex: row.familyPartner2Sex, mediaId: row.familyPartner2MediaId },
          ].filter((p): p is { id: number; name: string; sex: string | null; mediaId: number | null } => !!p.name)
        : [];

    const inner = (
        <div
            className={`flex items-center gap-2.5 min-h-[44px] py-2.5 px-3.5 ${last ? '' : 'border-b border-b-[color:var(--border-light)]'}`}
        >
            {isCase ? (
                <span
                    className="shrink-0 inline-flex items-center justify-center w-[30px] h-[30px] rounded-[8px]"
                    style={{ background: 'var(--evidence-bg)' }}
                >
                    <FolderSearch size={15} aria-hidden="true" style={{ color: 'var(--evidence)' }} />
                </span>
            ) : isFamily && familyPartners.length > 0 ? (
                <AvatarStack
                    people={familyPartners}
                    treeId={treeId}
                    size={30}
                    max={2}
                    className="shrink-0"
                />
            ) : (
                // Person and event rows both resolve to the subject person, so
                // they get that person's photo and sex rather than bare initials.
                <PersonAvatar
                    mediaId={row.personMediaId}
                    treeId={treeId}
                    sex={row.personSex}
                    name={subject}
                    initials={nameInitials(subject)}
                    size={30}
                />
            )}

            <div className="flex-1 min-w-0">
                <div className="text-sm">
                    {label && <><span className="font-semibold">{label}</span><span className="text-text-muted"> · </span></>}
                    <span className={label ? 'text-text-muted' : 'font-semibold'}>{subject}</span>
                </div>
                {detail && <div className="text-xs text-text-muted">{detail}</div>}
            </div>

            {date && <span className="date-mono text-meta shrink-0">{formatDateForDisplay(date, language, dateWords)}</span>}
            {href && showChevron && (
                <ChevronRight size={15} aria-hidden="true" className="shrink-0" style={{ color: 'var(--text-muted)' }} />
            )}
        </div>
    );

    if (!href) return inner;
    return (
        <Link
            href={href}
            // These rows navigate, so they need to look like it: the whole row is
            // the target, hence a row-wide hover surface plus an inset focus ring.
            className="block no-underline transition-colors hover:bg-[color:var(--color-hover-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
            style={{ color: 'inherit' }}
        >
            {inner}
        </Link>
    );
}
