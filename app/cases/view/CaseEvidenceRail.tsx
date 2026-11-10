'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ImageUp, Quote, X } from '@/lib/icons';
import { Badge, Button, DetailRail, SectionHeader, fieldClass } from '@/app/components/ui';
import PersonPicker from '@/app/components/PersonPicker';
import MediaImg from '@/app/components/MediaImg';
import type { CaseCitation } from '@/lib/db/schema';
import { isQuayValue } from '@/lib/citations/quay';
import { sourceTypeLabel } from '@/app/library/sourceTypes';
import type { CaseDetailState } from './useCaseDetail';

/** A rail card with its heading inside: the shared DetailRail recipe (#764). */
function EvidenceSection({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
    return (
        <section className="card p-4">
            <SectionHeader level="rail" title={title} count={count} action={action} />
            {children}
        </section>
    );
}

export default function CaseEvidenceRail({ cd }: { cd: CaseDetailState }) {
    const {
        caseData, canEdit, caseReady, isDraft, activeTreeId, casePeople, handlePeopleChange,
        setShowAttachSource, setShowUploadModal, setLightboxIndex,
        removeMediaFromCase, tagInput, setTagInput, addTag, removeTag, canDelete, t,
        openCaseCitation, setConfirmRemoveCitation,
    } = cd;
    const tl = useTranslations('library');

    if (!caseData) return null;

    return (
        <aside className="self-start">
            <DetailRail>
            {/* People */}
            <EvidenceSection title={t('section_people')} count={casePeople.length}>
                {/* An empty slot that can't take input yet (viewer, or an unsaved draft)
                    reads "none yet" like Sources and Media, not a blank bar (#696, LAY-6). */}
                {casePeople.length === 0 && (!canEdit || !caseReady) ? (
                    <p className="text-xs text-text-muted">{t('no_people')}</p>
                ) : (
                    <div id="case-people-input">
                        <PersonPicker
                            multiple
                            value={casePeople}
                            onChange={handlePeopleChange}
                            showDates
                            treeId={activeTreeId}
                            disabled={!canEdit || !caseReady}
                            linkPersons
                            placeholder={t('add_person')}
                        />
                    </div>
                )}
            </EvidenceSection>

            {/* Sources */}
            <EvidenceSection
                title={t('section_sources')}
                count={caseData.citations.length}
                action={canEdit && !isDraft && (
                    <Button variant="ghost" size="sm" className="shrink-0" icon={<Quote className="w-3.5 h-3.5" aria-hidden="true" />} onClick={() => setShowAttachSource(true)}>
                        {t('cite_source')}
                    </Button>
                )}
            >
                {caseData.citations.length === 0 ? (
                    <p className="text-xs text-text-muted">{t('no_citations')}</p>
                ) : (
                    <div className="flex flex-col gap-1.5">
                        {/* A row opens the citation's preview in place: detail, certainty,
                            transcription, then Open source and Edit citation (#918). */}
                        {caseData.citations.map((cit: CaseCitation) => {
                            const title = cit.sourceTitle ?? `#${cit.SourceId}`;
                            const detail = cit.Page ?? cit.Note;
                            return (
                                <div key={cit.Id} className="flex gap-1 items-center bg-card-alt border border-border rounded-md text-xs">
                                    <button
                                        type="button"
                                        onClick={(e) => openCaseCitation(cit, e.currentTarget)}
                                        className="flex gap-2 items-center flex-1 min-w-0 px-2 py-1.5 text-left rounded-md cursor-pointer hover:bg-[color:var(--color-hover-surface)] focus-ring"
                                    >
                                        <span className="text-[9px] shrink-0 px-1.5 py-0.5 rounded bg-surface-2 text-text-secondary font-medium">{sourceTypeLabel(cit.sourceType, tl)}</span>
                                        <span className="flex-1 min-w-0">
                                            <span className="block font-medium truncate">{title}</span>
                                            {(detail || (cit.Quay && isQuayValue(cit.Quay))) && (
                                                <span className="block text-[10px] text-text-muted truncate">
                                                    {[detail, cit.Quay && isQuayValue(cit.Quay) ? tl(`certainty_short_${cit.Quay}`) : null].filter(Boolean).join(' · ')}
                                                </span>
                                            )}
                                        </span>
                                    </button>
                                    {canEdit && canDelete && (
                                        <button
                                            type="button"
                                            onClick={() => setConfirmRemoveCitation(cit)}
                                            className="shrink-0 inline-flex items-center justify-center min-w-8 min-h-8 text-text-muted hover:text-error rounded focus-ring cursor-pointer"
                                            title={cd.tCommon('remove_named', { name: title })}
                                            aria-label={cd.tCommon('remove_named', { name: title })}
                                        >
                                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </EvidenceSection>

            {/* Media */}
            <EvidenceSection
                title={t('section_media')}
                count={caseData.media.length}
                action={canEdit && caseReady && (
                    <Button variant="ghost" size="sm" icon={<ImageUp className="w-3.5 h-3.5" aria-hidden="true" />} onClick={() => setShowUploadModal(true)}>
                        {t('add_media')}
                    </Button>
                )}
            >
                {caseData.media.length === 0 ? (
                    <p className="text-xs text-text-muted">
                        {canEdit && caseData.people.length === 0 ? t('link_people_first') : t('no_media')}
                    </p>
                ) : (
                    <div className="grid grid-cols-4 gap-1.5">
                        {caseData.media.map((m, idx) => (
                            <div key={m.Id} className="group relative aspect-square rounded-md overflow-hidden bg-card-alt">
                                <button
                                    type="button"
                                    onClick={() => setLightboxIndex(idx)}
                                    className="w-full h-full cursor-pointer border-0 p-0 block"
                                    title={m.Title || t('section_media')}
                                >
                                    <MediaImg mediaId={m.Id} contentType={m.ContentType} treeId={activeTreeId} width={128} alt={m.Title || t('section_media')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                </button>
                                {canEdit && (
                                    <button
                                        type="button"
                                        onClick={() => removeMediaFromCase(m.Id)}
                                        className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/55 flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white transition-opacity cursor-pointer"
                                        title={t('remove_from_case')}
                                        aria-label={t('remove_from_case')}
                                    >
                                        <X className="w-2.5 h-2.5 text-white" aria-hidden="true" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </EvidenceSection>

            {/* Tags */}
            <EvidenceSection title={t('section_tags')}>
                {!caseData.Tags?.length && (!canEdit || !caseReady) ? (
                    <p className="text-xs text-text-muted">{t('no_tags')}</p>
                ) : (
                    <div className="flex flex-wrap gap-1.5">
                        {caseData.Tags?.map(tag => (
                            <Badge key={tag}>
                                {tag}
                                {canEdit && (
                                    <button type="button" onClick={() => removeTag(tag)} className="opacity-60 hover:opacity-100 inline-flex cursor-pointer" title={t('remove_tag')} aria-label={t('remove_tag')}>
                                        <X className="w-2.5 h-2.5" aria-hidden="true" />
                                    </button>
                                )}
                            </Badge>
                        ))}
                    </div>
                )}
                {canEdit && caseReady && (
                    <div className="flex gap-1.5 mt-2">
                        <input
                            type="text"
                            value={tagInput}
                            onChange={e => setTagInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                            placeholder={t('add_a_tag')}
                            aria-label={t('add_a_tag')}
                            className={fieldClass('sm', 'flex-1 min-w-0')}
                        />
                        <Button variant="outline" size="sm" onClick={addTag} disabled={!tagInput.trim()}>{t('add_tag')}</Button>
                    </div>
                )}
            </EvidenceSection>
            </DetailRail>
        </aside>
    );
}
