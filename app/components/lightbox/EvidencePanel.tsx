'use client';

import { useTranslations } from 'next-intl';
import { Pencil, Eye, EyeOff, Star, Lock, X, Plus, Download, Trash2, UserRound, ExternalLink, LinkIcon, ImageIcon } from '@/lib/icons';
import { Avatar } from '@/app/components/ui/Avatar';
import { Input } from '@/app/components/ui/Input';
import { Button } from '@/app/components/ui/Button';
import type { LightboxTag } from './types';
import { tagPersonName } from './types';
import { PhotoDateField, PhotoDateLine } from './PhotoDate';
import { RailLinkedTo, type DocumentRail } from './DocumentLinks';

export interface EvidencePanelProps {
    /** Permit metadata and face-tag mutation controls. */
    canEdit?: boolean;
    /** Permit destructive tag/media actions. Context unlinking is handled separately by the caller. */
    canDelete: boolean;
    title: string | null;
    /** When the photo was taken (#802). */
    date?: string | null;
    editing: boolean;
    formTitle: string;
    formDate: string;
    onStartEdit: () => void;
    onChangeTitle: (v: string) => void;
    onChangeDate: (v: string) => void;
    onSaveEdit: () => void;
    onCancelEdit: () => void;
    tags: LightboxTag[];
    galleryPersonId?: number;
    showNames: boolean;
    onToggleNames: () => void;
    onHoverTag: (id: number | null) => void;
    canRemoveTag: (t: LightboxTag) => boolean;
    onStartRedraw: (id: number) => void;
    onRemoveTag: (id: number) => void;
    onStartTag: () => void;
    showPrimary: boolean;          // context==='person' && canEdit
    isPersonPrimary: boolean;
    onSetPrimary: () => void;
    setPrimaryLabel: string;
    downloadHref: string;
    onDelete: () => void;
    /** Hide destructive/unlink action for read-only or inferred owner rows. */
    showDeleteAction?: boolean;
    /** Label for the danger button (defaults to common "Delete"). */
    deleteLabel?: string;
    busy: boolean;
    errorMessage?: string | null;
    /** Set for a PDF (#510): Linked to and the file's actions replace faces and portraits. */
    document?: DocumentRail;
    /** A family's gallery (#119): set this photo as the family photo, or stop using it. */
    familyPhoto?: { current: boolean; onSet: () => void; onClear: () => void };
}

export default function EvidencePanel(props: EvidencePanelProps) {
    const t = useTranslations('mediaLightbox');
    const ft = useTranslations('faceTags');
    const tc = useTranslations('common');
    const { canEdit = true, canDelete, title, date, editing, formTitle, formDate, onStartEdit, onChangeTitle, onChangeDate, onSaveEdit, onCancelEdit,
        tags, galleryPersonId, showNames, onToggleNames, onHoverTag, canRemoveTag, onStartRedraw, onRemoveTag,
        onStartTag, showPrimary, isPersonPrimary, onSetPrimary, setPrimaryLabel,
        downloadHref, onDelete, showDeleteAction = canDelete, deleteLabel, busy, errorMessage, document, familyPhoto } = props;
    const td = useTranslations('documents');
    const fallbackTitle = document ? td('pdf_document') : t('photo_alt');

    return (
        <div
            // `dark-island` carries the AA-tuned white-on-dark FG token scale (shared
            // with .hero-dark); base text colour flows from it. The rail stays dark in
            // BOTH themes on purpose — see the --color-lightbox-* note in globals.css.
            className="dark-island w-[320px] lg:w-[360px] shrink-0 border-l border-white/10 flex flex-col"
            // Opaque rail (only the area behind the photo is the transparent scrim).
            style={{ background: 'var(--color-lightbox-panel)' }}
        >
            <div className="flex-1 overflow-y-auto p-[18px_20px] flex flex-col gap-[18px]">
                {/* header */}
                {!editing ? (
                    // The title takes the rail's full width and wraps (camera filenames have no
                    // spaces, hence overflow-wrap:anywhere); Edit sits on the date row (#894).
                    <div className="flex flex-col gap-1">
                        <div className="serif text-xl font-semibold leading-tight [overflow-wrap:anywhere] line-clamp-3" title={title || fallbackTitle}>{title || fallbackTitle}</div>
                        {document && <div className="text-meta text-white/60 tabular-nums">{document.meta}</div>}
                        {(date || canEdit) && (
                            <div className="flex justify-between items-center gap-[10px]">
                                <PhotoDateLine date={date} className="min-w-0" />
                                {canEdit && <button type="button" onClick={onStartEdit} aria-label={t('edit_details')}
                                    className="shrink-0 ml-auto inline-flex items-center gap-[6px] text-meta rounded-lg px-[11px] py-[7px] bg-white/10 border border-white/20">
                                    <Pencil className="w-[13px] h-[13px]" aria-hidden="true" />{tc('edit')}
                                </button>}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col gap-[11px]">
                        <div className="flex items-center gap-[7px]">
                            <Pencil className="w-[14px] h-[14px] text-white/80" aria-hidden="true" />
                            <span className="text-sm font-semibold">{t('edit_details')}</span>
                        </div>
                        <label className="block">
                            <span className="block text-[9.5px] uppercase tracking-wide text-white/50 mb-[5px]">{t('title_label')}</span>
                            <Input value={formTitle} onChange={(e) => onChangeTitle(e.target.value)} placeholder={t('title_placeholder')} />
                        </label>
                        <PhotoDateField value={formDate} onChange={onChangeDate} />
                        <div className="flex gap-[8px] mt-[2px]">
                            <Button type="button" variant="outline" onClick={onCancelEdit} disabled={busy} className="flex-1 text-meta text-white border-white/25 hover:bg-white/10">{tc('cancel')}</Button>
                            <Button type="button" variant="primary" onClick={onSaveEdit} disabled={busy} className="flex-1 text-meta">{t('save')}</Button>
                        </div>
                    </div>
                )}

                {errorMessage && <div role="alert" className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">{errorMessage}</div>}

                {document && (
                    <div>
                        <div className="flex justify-between items-center mb-[10px]">
                            <span className="text-xs uppercase tracking-wide text-white/50">{td('linked_to')}</span>
                            <span className="tabular-nums text-xs text-white/40">{document.links?.length ?? ''}</span>
                        </div>
                        <RailLinkedTo links={document.links} canEdit={canEdit} busy={busy} onUnlink={document.onUnlink} />
                        {canEdit && <button type="button" onClick={document.onLink} disabled={busy}
                            className="mt-[10px] w-full min-h-11 inline-flex items-center justify-center gap-1.5 text-meta text-link border border-dashed border-link/40 rounded-md py-1.75 cursor-pointer transition-colors hover:bg-white/10 hover:border-link focus-ring">
                            <LinkIcon className="w-[13px] h-[13px]" aria-hidden="true" />{td('link_to_person_or_source')}
                        </button>}
                    </div>
                )}

                {/* people */}
                {!document && <div>
                    <div className="flex justify-between items-center mb-[10px]">
                        <span className="text-[9.5px] uppercase tracking-wide text-white/50">{t('people_in_photo')}</span>
                        <div className="flex items-center gap-[9px]">
                            {tags.length > 0 && (
                                <button type="button" onClick={onToggleNames}
                                    aria-label={showNames ? t('hide_boxes') : t('show_boxes')}
                                    title={showNames ? t('hide_boxes') : t('show_boxes')}
                                    className="inline-flex items-center justify-center w-11 h-11 -m-2 rounded-md opacity-80 transition-colors hover:opacity-100 focus-ring">
                                    {showNames ? <Eye className="w-[15px] h-[15px]" aria-hidden="true" /> : <EyeOff className="w-[15px] h-[15px]" aria-hidden="true" />}
                                </button>
                            )}
                            <span className="tabular-nums text-xs text-white/40">{tags.length}</span>
                        </div>
                    </div>
                    <div className="flex flex-col gap-[8px]">
                        {tags.map((tag) => {
                            const name = tagPersonName(tag, t('photo_alt'));
                            const isPrimaryFace = isPersonPrimary && tag.PersonId === galleryPersonId;
                            const removable = canDelete && canRemoveTag(tag);
                            return (
                                <div key={tag.Id} onMouseEnter={() => onHoverTag(tag.Id)} onMouseLeave={() => onHoverTag(null)}
                                    className="flex items-center gap-[9px] rounded-md p-1.5 -mx-1.5 transition-colors hover:bg-white/10">
                                    {/* The row had a hover background but no click target — it
                                        looked clickable and wasn't (#457). The avatar and name are
                                        now one link; the remove button stays a sibling, since a
                                        button nested inside an anchor is invalid. */}
                                    <a href={`/people/view?id=${tag.PersonId}`}
                                        onFocus={() => onHoverTag(tag.Id)} onBlur={() => onHoverTag(null)}
                                        className="flex items-center gap-[9px] flex-1 min-w-0 rounded-md no-underline text-inherit focus-ring">
                                        <Avatar name={name} size={28} />
                                        <span className="serif text-base flex-1 min-w-0 truncate">{name}</span>
                                    </a>
                                    {isPrimaryFace && <span title={t('current_profile_picture')} aria-label={t('current_profile_picture')} role="img" className="inline-flex"><Star className="w-3.25 h-3.25 text-white/80" aria-hidden="true" /></span>}
                                    {canEdit && <div className="flex items-center shrink-0">
                                        <button type="button" onClick={() => onStartRedraw(tag.Id)} disabled={busy}
                                            aria-label={t('redraw_tag')} title={t('redraw_tag')}
                                            className="inline-flex items-center justify-center w-11 h-11 -m-2 rounded-md opacity-70 transition-colors hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40 focus-ring">
                                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                        </button>
                                        {canDelete && (removable ? <button type="button" onClick={() => onRemoveTag(tag.Id)} disabled={busy}
                                            aria-label={ft('remove_tag')} title={ft('remove_tag')}
                                            className="inline-flex items-center justify-center w-11 h-11 -m-2 rounded-md opacity-60 transition-colors hover:opacity-100 hover:text-error focus-visible:opacity-100 focus-visible:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error disabled:opacity-40">
                                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                                        </button> : <span title={ft('cant_untag_primary')} aria-label={ft('cant_untag_primary')} role="img" className="inline-flex"><Lock className="w-3.25 h-3.25 opacity-40" aria-hidden="true" /></span>)}
                                    </div>}
                                </div>
                            );
                        })}
                        {tags.length === 0 && (
                            <div className="text-meta text-white/45 italic leading-relaxed">{t('no_one_tagged')}</div>
                        )}
                    </div>
                    {canEdit && <button type="button" onClick={onStartTag}
                        className="mt-[10px] w-full min-h-11 inline-flex items-center justify-center gap-1.5 text-meta text-link border border-dashed border-link/40 rounded-md py-1.75 cursor-pointer transition-colors hover:bg-white/10 hover:border-link focus-ring">
                        <Plus className="w-[13px] h-[13px]" aria-hidden="true" />{t('tag_a_face')}
                    </button>}
                </div>}
            </div>

            {/* footer */}
            <div className="border-t border-white/10 p-[13px_16px] flex flex-col gap-[9px]">
                {showPrimary && !document && (isPersonPrimary
                    ? <div className="inline-flex items-center justify-center gap-[6px] text-meta rounded-lg px-[11px] py-[7px] bg-white/15 text-white border border-white/25">
                        <Star className="w-[14px] h-[14px]" aria-hidden="true" />{t('current_profile_picture')}
                      </div>
                    : <Button type="button" variant="primary" onClick={onSetPrimary} disabled={busy} className="w-full text-meta">
                        <UserRound className="w-[14px] h-[14px]" aria-hidden="true" />{setPrimaryLabel}
                      </Button>)}
                {familyPhoto && !document && (familyPhoto.current
                    ? <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-[6px] text-meta rounded-lg px-[11px] py-[7px] bg-white/15 text-white border border-white/25">
                            <Star className="w-[14px] h-[14px]" aria-hidden="true" />{t('current_family_photo')}
                        </span>
                        <button type="button" onClick={familyPhoto.onClear} disabled={busy}
                            className="text-meta text-white/80 underline-offset-2 hover:underline cursor-pointer bg-transparent border-0 p-0 disabled:opacity-50 focus-ring">
                            {t('stop_family_photo')}
                        </button>
                      </div>
                    : <Button type="button" variant="primary" onClick={familyPhoto.onSet} disabled={busy} className="w-full text-meta">
                        <ImageIcon className="w-[14px] h-[14px]" aria-hidden="true" />{t('set_family_photo')}
                      </Button>)}
                <div className="flex gap-[9px]">
                    {/* Delete is quiet red text on the left, never a second fill beside
                        the panel's actions (CT-3); its confirm keeps the danger button. */}
                    {showDeleteAction && (
                        <Button type="button" variant="danger-text" onClick={onDelete} disabled={busy} className="text-meta -ml-3">
                            <Trash2 className="w-[14px] h-[14px]" aria-hidden="true" />{deleteLabel ?? tc('delete')}
                        </Button>
                    )}
                    {document ? (
                        <>
                            <a href={document.fileHref ?? undefined} target="_blank" rel="noopener" aria-disabled={document.fileHref == null}
                                className="flex-1 justify-center inline-flex items-center gap-[6px] text-meta rounded-lg px-[11px] py-[7px] bg-white/10 border border-white/20 text-white">
                                <ExternalLink className="w-[14px] h-[14px]" aria-hidden="true" />{td('open_in_new_tab')}
                            </a>
                            <a href={document.downloadHref ?? undefined} download={document.downloadName} aria-label={tc('download')} title={tc('download')}
                                aria-disabled={document.downloadHref == null}
                                className="w-[38px] justify-center inline-flex items-center rounded-lg bg-white/10 border border-white/20 text-white">
                                <Download className="w-[14px] h-[14px]" aria-hidden="true" />
                            </a>
                        </>
                    ) : (
                        <a href={downloadHref} download className="flex-1 justify-center inline-flex items-center gap-[6px] text-meta rounded-lg px-[11px] py-[7px] bg-white/10 border border-white/20 text-white">
                            <Download className="w-[14px] h-[14px]" aria-hidden="true" />{tc('download')}
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
}
