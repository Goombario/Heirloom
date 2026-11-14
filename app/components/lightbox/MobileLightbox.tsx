'use client';

import { useState } from 'react';
import { Drawer } from 'vaul';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/app/components/ui/Avatar';
import { X, Star, ChevronUp, Eye, EyeOff } from '@/lib/icons';
import type { PersonResult } from '@/lib/db/schema';
import type { LightboxTag } from './types';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { tagPersonName } from './types';
import MobileEvidence from './MobileEvidence';
import type { EvidencePanelProps } from './EvidencePanel';
import { PhotoDateLine } from './PhotoDate';
import { linkedPeopleNames } from './DocumentLinks';
import { EditPhotoSheet, TagSheet } from './MobilePhotoSheets';
import { PersonPickerSheet } from '@/app/components/PersonPickerSheet';

/** The phone-only writes and data the Details sheet needs (#1121). */
interface PhonePhotoProps {
    /** Unnamed faces from the photo's metadata; empty for people who can't tag. */
    faceIds: number[];
    onNameFace: (candidateId: number, person: PersonResult) => void;
    /** Moves a face box to someone else. */
    onRetag: (tagId: number, person: PersonResult) => void;
    onSaveDetails: (title: string, date: string) => Promise<boolean>;
    /** Tag a face: the person picked, placed with the portrait crop's circle. */
    onTagFace: (person: PersonResult) => void;
    /** Moves a face tag's circle, with the same crop. */
    onAdjustFace: (tagId: number) => void;
    /** "Amalia's profile picture", when this photo already is it. */
    portraitLabel: string | null;
}

/** Face handlers the photo stage takes from the sheet. */
interface StageHandlers {
    onFace: (candidateId: number) => void;
    onHoldTag?: (tagId: number) => void;
}

interface MobileLightboxProps {
    mediaId: number;
    treeId: number | null;
    alt: string;
    title: string | null;
    counterCurrent: number;
    counterTotal: number;
    tags: LightboxTag[];
    onClose: () => void;
    /** Shared evidence-panel props — rendered as a mobile-native body. */
    evidence: EvidencePanelProps;
    /** Whether the current photo is the gallery person's primary (peek ★ badge). */
    isPersonPrimary: boolean;
    /** Photo stage element (image + face boxes), full-bleed. Faces are tagged and moved
     *  with the portrait crop's circle, not drawn on the photo (phone review of #1117). */
    photo: (handlers: StageHandlers) => React.ReactNode;
    phone: PhonePhotoProps;
}

export default function MobileLightbox({
    treeId, alt, title, counterCurrent, counterTotal, tags,
    onClose, evidence, isPersonPrimary, photo, phone,
}: MobileLightboxProps) {
    const t = useTranslations('mediaLightbox');
    const tp = useTranslations('mobilePhoto');
    const tc = useTranslations('common');
    const ft = useTranslations('faceTags');
    const td = useTranslations('documents');
    // The small sheets live here, not in the Details body, so a face held or tapped on
    // the photo opens them with the sheet at peek.
    const [tagSheetId, setTagSheetId] = useState<number | null>(null);
    const [picking, setPicking] = useState<{ face: number } | { tag: number } | { add: true } | null>(null);
    const [editOpen, setEditOpen] = useState(false);
    const sheetTag = tags.find((tg) => tg.Id === tagSheetId) ?? null;
    const lastTag = useLastNonNull(sheetTag);
    // The peek is its content (handle, title, people row: 140px, one line more with a
    // date) over the home indicator, so it sits low and the photo gets the rest (the owner's
    // phone review of #1117; it was 212px, mostly empty). PEEK_PX also drives the
    // photo-area bottom reserve (below) so the image floats just above the sheet.
    // FULL is a fraction so the top bar + a sliver of photo stay visible. Drive the
    // sheet off a stable `expanded` boolean.
    const bottomInset = useBottomInset();
    const doc = evidence.document;
    // A document's peek always has its second line, "PDF · pages · size" (#510).
    const PEEK_PX = (evidence.date || doc ? 158 : 140) + Math.max(bottomInset, 6);
    const PEEK = `${PEEK_PX}px`;
    const FULL = 0.88;
    const SNAP_POINTS: (string | number)[] = [PEEK, FULL];
    const [expanded, setExpanded] = useState(false);
    const snap = expanded ? FULL : PEEK;
    const setSnap = (v: number | string | null) => setExpanded(v === FULL);

    // Gate rendering on mobile (<768px) so the always-open Drawer.Portal does not
    // escape into document.body on desktop (portaled content ignores md:hidden).
    const isMobile = useIsMobile();

    // Early return AFTER all hooks — safe per rules-of-hooks.
    if (!isMobile) return null;

    const docPeople = doc?.links ? linkedPeopleNames(doc.links, tc('unknown')) : [];
    const docSources = doc?.links?.filter((l) => l.OwnerTable === 'Sources' || l.OwnerTable === 'Citation').length ?? 0;
    const names = doc ? docPeople : tags.map(tg => tagPersonName(tg, alt));
    const canEdit = evidence.canEdit !== false;
    const handlers: StageHandlers = {
        onFace: (id) => setPicking({ face: id }),
        onHoldTag: canEdit ? setTagSheetId : undefined,
    };
    const countLine = doc
        ? (doc.links == null ? ''
            : doc.links.length === 0 ? td('not_linked')
            : [docPeople.length > 0 ? t('people_count', { count: docPeople.length }) : null,
                docSources > 0 ? td('sources_count', { count: docSources }) : null].filter(Boolean).join(' · ') || td('linked_count', { count: doc.links.length }))
        : phone.faceIds.length > 0
        ? tp('people_unnamed', { people: tags.length, unnamed: phone.faceIds.length })
        : t('people_count', { count: tags.length });

    return (
        <div className="md:hidden fixed inset-0 z-60 flex flex-col"
            style={{ background: 'radial-gradient(120% 120% at 50% 0%, var(--color-lightbox-stage-top) 0%, var(--color-lightbox-stage-bottom) 100%)' }}>
            {/* top bar */}
            <div className="flex items-center justify-between px-3.5 pt-[max(env(safe-area-inset-top),0.875rem)] pb-1.5 min-h-[52px] z-[6]">
                <button type="button" onClick={onClose} aria-label={tc('close')} title={tc('close')}
                    className="w-11 h-11 rounded-full bg-white/12 border border-white/20 flex items-center justify-center">
                    <X className="w-[19px] h-[19px] text-white" aria-hidden="true" />
                </button>
                <span className="tabular-nums text-xs text-white/55">{t('photo_counter', { current: counterCurrent, total: counterTotal })}</span>
                <span className="w-[38px]" aria-hidden="true" />
            </div>

            {/* full-bleed photo — bare PhotoStage must fill height (it centers the
                image internally); items-center here would collapse it to ~0 height
                and the ResizeObserver would then cap the image to 0. Embla owns swipe. */}
            <div className="flex-1 min-h-0 flex" style={{ paddingBottom: PEEK_PX + 4 }}>
                {photo(handlers)}
            </div>

            <Drawer.Root
                open
                modal={false}
                snapPoints={SNAP_POINTS}
                activeSnapPoint={snap}
                setActiveSnapPoint={setSnap}
                dismissible={false}
            >
                <Drawer.Portal>
                    {/* Drawer.Content stays h-full so Vaul's px snap-point math
                        (offset = windowHeight − peek) resolves correctly — a shorter
                        fixed height pushes every snap down by (windowHeight − height),
                        which is what made the peek render ~101px too short (bug 1).
                        The inner shell is capped to the expanded height so the footer
                        still rests at the viewport bottom. */}
                    <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[66] rounded-t-[20px] bg-lightbox-sheet border-t border-white/10 outline-none h-full">
                        <div className="flex flex-col h-[88dvh]">
                            {/* grab handle = drag + tap-to-collapse affordance */}
                            <button type="button" onClick={() => setExpanded(v => !v)}
                                aria-label={expanded ? t('collapse') : t('details')}
                                className="shrink-0 w-full h-11 -mb-3 flex items-start justify-center pt-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-on-dark">
                                <span className="w-[38px] h-1 rounded-full bg-white/30" aria-hidden="true" />
                            </button>
                            <Drawer.Title className="sr-only">{title || t('photo_alt')}</Drawer.Title>

                            {/* peek header — only while collapsed; tap to expand */}
                            {!expanded && (
                                <div className="relative px-[18px] pt-1 pb-3.5 shrink-0">
                                    {/* full-area expand target behind the content */}
                                    <button type="button" onClick={() => setExpanded(true)} aria-label={t('details')}
                                        className="absolute inset-0 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50" />
                                    {/* content: taps fall through to the expand button, except the eye */}
                                    <div className="relative pointer-events-none">
                                        <div className="flex items-center gap-2">
                                            {evidence.showPrimary && isPersonPrimary && (
                                                <Star className="w-[15px] h-[15px] text-white/80 shrink-0" aria-hidden="true" />
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <div className="serif text-xl font-semibold leading-tight text-white truncate">{title || (doc ? td('pdf_document') : t('photo_alt'))}</div>
                                                {doc
                                                    ? <div className="mt-0.5 text-meta text-white/60 tabular-nums">{doc.meta}</div>
                                                    : <PhotoDateLine date={evidence.date} className="mt-0.5 !text-evidence" />}
                                            </div>
                                            {tags.length > 0 && (
                                                <button type="button"
                                                    onClick={(e) => { e.stopPropagation(); evidence.onToggleNames(); }}
                                                    aria-label={evidence.showNames ? t('hide_boxes') : t('show_boxes')}
                                                    title={evidence.showNames ? t('hide_boxes') : t('show_boxes')}
                                                    className="pointer-events-auto inline-flex items-center justify-center w-11 h-11 -mr-2 rounded-full text-white/80 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-on-dark">
                                                    {evidence.showNames ? <Eye className="w-[18px] h-[18px]" aria-hidden="true" /> : <EyeOff className="w-[18px] h-[18px]" aria-hidden="true" />}
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2.5 mt-3">
                                            <div className="flex">
                                                {names.slice(0, 4).map((name, i) => (
                                                    <span key={i} style={{ marginLeft: i === 0 ? 0 : -9 }} className="rounded-full border-2 border-lightbox-sheet">
                                                        <Avatar name={name} size={30} />
                                                    </span>
                                                ))}
                                            </div>
                                            <span className="text-meta text-white/70">{countLine}</span>
                                            <span className="ml-auto inline-flex items-center gap-1 text-meta text-ink-on-dark">
                                                {t('details')}<ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* full content — only while expanded (no duplicate title).
                                No border-t: the grab handle is the separator (bug 3). */}
                            {expanded && (
                                <div className="flex-1 min-h-0 overflow-hidden">
                                    <MobileEvidence {...evidence} onStartEdit={() => setEditOpen(true)} onStartTag={() => setPicking({ add: true })}
                                        faceIds={phone.faceIds} onNameFace={handlers.onFace} onOpenTag={setTagSheetId} portraitLabel={phone.portraitLabel} />
                                </div>
                            )}
                        </div>
                    </Drawer.Content>
                </Drawer.Portal>
            </Drawer.Root>

            {lastTag && (
                <TagSheet open={sheetTag != null} onClose={() => setTagSheetId(null)}
                    name={tagPersonName(lastTag, alt)} personId={lastTag.PersonId} canRemove={evidence.canRemoveTag(lastTag)}
                    onRedraw={() => { setTagSheetId(null); phone.onAdjustFace(lastTag.Id); }}
                    onRetag={() => { setTagSheetId(null); setPicking({ tag: lastTag.Id }); }}
                    onRemove={() => { setTagSheetId(null); evidence.onRemoveTag(lastTag.Id); }} />
            )}
            <PersonPickerSheet open={picking != null} onClose={() => setPicking(null)}
                title={picking && 'tag' in picking ? tp('tag_someone_else') : ft('who_is_this')}
                treeId={treeId} excludeIds={tags.map((tg) => tg.PersonId)}
                onPick={([p]) => {
                    const target = picking;
                    setPicking(null);
                    if (!target || p?.kind !== 'existing') return;
                    if ('face' in target) phone.onNameFace(target.face, p.person);
                    else if ('tag' in target) phone.onRetag(target.tag, p.person);
                    else phone.onTagFace(p.person);
                }} />
            <EditPhotoSheet open={editOpen} onClose={() => setEditOpen(false)}
                title={title ?? ''} date={evidence.date ?? ''} onSave={phone.onSaveDetails} />
        </div>
    );
}

/** The home indicator's height (the bottom safe-area inset), which a px snap point can't read from CSS. */
function useBottomInset(): number {
    // Measured once: the viewer only mounts in the browser (it portals into <body>).
    const [inset] = useState(() => {
        if (typeof document === 'undefined') return 0;
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none';
        document.body.appendChild(probe);
        const h = probe.offsetHeight;
        probe.remove();
        return h;
    });
    return inset;
}

/** The last non-null value, so a closing sheet keeps its content while it slides away. */
function useLastNonNull<T>(value: T | null): T | null {
    const [last, setLast] = useState(value);
    if (value != null && value !== last) setLast(value);
    return value ?? last;
}
