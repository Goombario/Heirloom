'use client';

import { useTranslations } from 'next-intl';
import { ArrowUpRight, ChevronRight, Download, FileText, LinkIcon, Plus, ScanFace, Star, Trash2, UserRound } from '@/lib/icons';
import { Avatar } from '@/app/components/ui/Avatar';
import { CopperPill } from '@/app/components/ui';
import { tagPersonName } from './types';
import type { EvidencePanelProps } from './EvidencePanel';
import { PhotoDateLine } from './PhotoDate';
import { SheetLinkedTo } from './DocumentLinks';

/** What only the phone sheet shows (#1121). */
export interface PhoneEvidenceProps {
    /** Unnamed faces from the photo's metadata (editors only). */
    faceIds: number[];
    onNameFace: (candidateId: number) => void;
    onOpenTag: (tagId: number) => void;
    /** "Amalia's profile picture", when this photo already is it. */
    portraitLabel: string | null;
}

const ROW = 'flex items-center gap-3 w-full min-h-[52px] px-[18px] text-left no-underline transition-colors active:bg-white/10 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-on-dark disabled:opacity-40';
const TILE = 'inline-flex items-center justify-center w-[34px] h-[34px] shrink-0 rounded-[10px] bg-white/10';

/**
 * The expanded Details sheet (#1121): title with Edit, the people in the photo, the
 * unnamed faces as dashed "Who is this?" rows, Tag a face, Download, red Delete, and
 * the copper "Set as X's profile picture". Dark in both themes, like the photo.
 */
export default function MobileEvidence(props: EvidencePanelProps & PhoneEvidenceProps) {
    const t = useTranslations('mediaLightbox');
    const tp = useTranslations('mobilePhoto');
    const ft = useTranslations('faceTags');
    const tc = useTranslations('common');
    const { canEdit = true, canDelete, title, date, onStartEdit, tags, galleryPersonId, onStartTag,
        showPrimary, isPersonPrimary, onSetPrimary, setPrimaryLabel, downloadHref, onDelete,
        showDeleteAction = canDelete, deleteLabel, busy, errorMessage, faceIds, onNameFace, onOpenTag, portraitLabel, document } = props;
    const td = useTranslations('documents');

    if (document) {
        // A PDF (#510): Linked to in place of the people in the photo, then Link,
        // Open PDF (the phone's own viewer), Download and Delete document.
        return (
            <div className="dark-island flex flex-col h-full text-white">
                <div className="flex-1 overflow-y-auto overscroll-contain pb-4">
                    <div className="px-[18px] pt-1 pb-4">
                        <div className="flex items-start gap-3">
                            <h2 className="m-0 serif text-xl font-semibold leading-tight [overflow-wrap:anywhere] line-clamp-3 min-w-0 flex-1">{title || td('pdf_document')}</h2>
                            {canEdit && (
                                <button type="button" onClick={onStartEdit} disabled={busy}
                                    className="shrink-0 -mr-2 -mt-2 inline-flex items-center justify-center min-h-11 min-w-11 px-2 text-sm text-ink-on-dark rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-on-dark">
                                    {tc('edit')}
                                </button>
                            )}
                        </div>
                        <div className="mt-1 text-meta text-white/60 tabular-nums">{document.meta}</div>
                        <PhotoDateLine date={date} className="mt-1 !text-evidence" />
                    </div>

                    {errorMessage && <div role="alert" className="mx-[18px] mb-3 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">{errorMessage}</div>}

                    <h3 className="m-0 px-[18px] pb-1.5 text-xs font-semibold uppercase tracking-wide text-white/50">{td('linked_to')}</h3>
                    <SheetLinkedTo links={document.links} rowClass={ROW} />

                    <div className="mt-3 border-t border-white/10">
                        {canEdit && (
                            <button type="button" onClick={document.onLink} disabled={busy} className={ROW}>
                                <span className={TILE}><LinkIcon className="w-[18px] h-[18px]" aria-hidden="true" /></span>
                                <span className="flex-1 font-semibold">{td('link_to_person_or_source')}</span>
                                <Plus className="w-4 h-4 text-white/45" aria-hidden="true" />
                            </button>
                        )}
                        <a href={document.fileHref ?? undefined} target="_blank" rel="noopener" className={`${ROW} text-inherit ${canEdit ? 'border-t border-white/10' : ''}`}>
                            <span className={TILE}><FileText className="w-[18px] h-[18px]" aria-hidden="true" /></span>
                            <span className="flex-1 font-semibold">{td('open_pdf')}</span>
                            <ArrowUpRight className="w-4 h-4 text-white/45" aria-hidden="true" />
                        </a>
                        <a href={document.downloadHref ?? undefined} download={document.downloadName} className={`${ROW} text-inherit border-t border-white/10`}>
                            <span className={TILE}><Download className="w-[18px] h-[18px]" aria-hidden="true" /></span>
                            <span className="flex-1 font-semibold">{tc('download')}</span>
                        </a>
                        {showDeleteAction && (
                            <button type="button" onClick={onDelete} disabled={busy} className={`${ROW} border-t border-white/10 text-error`}>
                                <span className={TILE}><Trash2 className="w-[18px] h-[18px]" aria-hidden="true" /></span>
                                <span className="flex-1 font-semibold">{deleteLabel ?? td('delete_document')}</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        // `dark-island`: the sheet is dark in both themes, so the red Delete takes the
        // island's AA-tuned error ink rather than the light theme's dark red.
        <div className="dark-island flex flex-col h-full text-white">
            <div className="flex-1 overflow-y-auto overscroll-contain pb-4">
                <div className="px-[18px] pt-1 pb-4">
                    <div className="flex items-start gap-3">
                        <h2 className="m-0 serif text-xl font-semibold leading-tight [overflow-wrap:anywhere] line-clamp-3 min-w-0 flex-1">{title || t('photo_alt')}</h2>
                        {canEdit && (
                            <button type="button" onClick={onStartEdit} disabled={busy}
                                className="shrink-0 -mr-2 -mt-2 inline-flex items-center justify-center min-h-11 min-w-11 px-2 text-sm text-ink-on-dark rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-on-dark">
                                {tc('edit')}
                            </button>
                        )}
                    </div>
                    <PhotoDateLine date={date} className="mt-1 !text-evidence" />
                </div>

                {errorMessage && <div role="alert" className="mx-[18px] mb-3 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">{errorMessage}</div>}

                <h3 className="m-0 px-[18px] pb-1.5 text-xs font-semibold uppercase tracking-wide text-white/50">{t('people_in_photo')}</h3>
                <ul className="m-0 p-0 list-none">
                    {tags.map((tag) => {
                        const name = tagPersonName(tag, t('photo_alt'));
                        const isPrimaryFace = isPersonPrimary && tag.PersonId === galleryPersonId;
                        const inner = (
                            <>
                                <Avatar name={name} size={34} />
                                <span className="flex-1 min-w-0 truncate text-md">{name}</span>
                                {isPrimaryFace && <Star className="w-3.5 h-3.5 text-white/80 shrink-0" aria-label={t('current_profile_picture')} role="img" />}
                                {canEdit
                                    ? <ChevronRight className="w-4 h-4 text-white/45 shrink-0" aria-hidden="true" />
                                    : <ArrowUpRight className="w-4 h-4 text-white/45 shrink-0" aria-hidden="true" />}
                            </>
                        );
                        return (
                            <li key={tag.Id} className="border-t border-white/10 first:border-t-0">
                                {canEdit
                                    ? <button type="button" onClick={() => onOpenTag(tag.Id)} disabled={busy} className={ROW}>{inner}</button>
                                    : <a href={`/people/view?id=${tag.PersonId}`} className={`${ROW} text-inherit`}>{inner}</a>}
                            </li>
                        );
                    })}
                    {faceIds.map((id) => (
                        <li key={`f${id}`} className="border-t border-white/10 first:border-t-0">
                            <button type="button" onClick={() => onNameFace(id)} disabled={busy} className={ROW}>
                                <span className="inline-flex items-center justify-center w-[34px] h-[34px] shrink-0 rounded-full border-2 border-dashed border-white/50 text-white/60" aria-hidden="true">?</span>
                                <span className="flex-1 min-w-0 truncate text-md text-white/80">{ft('who_is_this')}</span>
                                <ChevronRight className="w-4 h-4 text-white/45 shrink-0" aria-hidden="true" />
                            </button>
                        </li>
                    ))}
                    {tags.length === 0 && faceIds.length === 0 && (
                        <li className="px-[18px] py-3 text-sm text-white/55">{tp('no_one_tagged')}</li>
                    )}
                </ul>

                <div className="mt-3 border-t border-white/10">
                    {canEdit && (
                        <button type="button" onClick={onStartTag} disabled={busy} className={ROW}>
                            <span className={TILE}><ScanFace className="w-[18px] h-[18px]" aria-hidden="true" /></span>
                            <span className="flex-1 font-semibold">{t('tag_a_face')}</span>
                            <Plus className="w-4 h-4 text-white/45" aria-hidden="true" />
                        </button>
                    )}
                    <a href={downloadHref} download className={`${ROW} text-inherit ${canEdit ? 'border-t border-white/10' : ''}`}>
                        <span className={TILE}><Download className="w-[18px] h-[18px]" aria-hidden="true" /></span>
                        <span className="flex-1 font-semibold">{tc('download')}</span>
                    </a>
                    {showPrimary && isPersonPrimary && portraitLabel && (
                        <div className={`${ROW} border-t border-white/10 text-white/70`}>
                            <span className={TILE}><Star className="w-[18px] h-[18px]" aria-hidden="true" /></span>
                            <span className="flex-1">{portraitLabel}</span>
                        </div>
                    )}
                    {showDeleteAction && (
                        <button type="button" onClick={onDelete} disabled={busy} className={`${ROW} border-t border-white/10 text-error`}>
                            <span className={TILE}><Trash2 className="w-[18px] h-[18px]" aria-hidden="true" /></span>
                            <span className="flex-1 font-semibold">{deleteLabel ?? tp('delete_photo')}</span>
                        </button>
                    )}
                </div>
            </div>

            {showPrimary && !isPersonPrimary && (
                <div className="border-t border-white/10 px-[18px] pt-3 shrink-0" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 14px)' }}>
                    <CopperPill onClick={onSetPrimary} disabled={busy} icon={<UserRound aria-hidden="true" />}>{setPrimaryLabel}</CopperPill>
                </div>
            )}
        </div>
    );
}
