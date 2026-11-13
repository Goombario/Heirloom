'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import type { Media, MediaLinkOwner, PersonGalleryMedia, PersonResult } from '@/lib/db/schema';
import { mediaFileUrl } from '@/lib/media-url';
import { type PersonPickerHandle } from '@/app/components/PersonPicker';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import { ConfirmSheet } from '@/app/components/ui/Sheet';
import { showChangeToast } from '@/app/components/ui';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useChange } from '@/app/people/view/mobile/useChange';
import { CropScreen } from '@/app/people/view/mobile/PortraitSheets';
import { getDataClient } from '@/lib/data';
import PhotoStage from './PhotoStage';
import EvidencePanel, { type EvidencePanelProps } from './EvidencePanel';
import MobileLightbox from './MobileLightbox';
import WhoIsThisModal from './WhoIsThisModal';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { useFocusTrap } from '@/app/hooks/useFocusTrap';
import { useDocumentScrollLock } from '@/app/hooks/useDocumentScrollLock';
import { openSheetCount, pushSheet } from '@/app/components/ui/sheetStack';
import { displayFullName } from '@/lib/utils/names';
import { isPdfMedia } from '@/lib/media/allowed-extensions';
import { formatMediaBytes } from '@/lib/media/format-bytes';
import { archiveMediaFilename } from '@/lib/gedcom/media-archive-name';
import { usePdfPreview } from '@/app/components/media/DocumentThumb';
import { useDocumentFile, type DocumentRail } from './DocumentLinks';
import LinkDocumentModal, { type DocumentLinkChoice } from './LinkDocumentModal';
import { overlappedTag, tagPersonName, type LightboxTag, type FaceRegionInput } from './types';

export interface MediaLightboxProps {
    items: Array<Media | PersonGalleryMedia>;
    index: number;
    treeId: number | null;
    /** Show edit actions (tagging, set primary / crop). */
    canEdit?: boolean;
    /** Show destructive actions (remove tags and hard-delete media). */
    canDelete: boolean;
    /**
     * 'library' hides all primary actions (primary management lives only in the
     * person gallery); 'person' enables set-primary. Tagging is available in
     * both. Defaults to 'library'.
     */
    context?: 'library' | 'person';
    /** Person whose gallery is open (person context) — target for tagged-primary. */
    galleryPersonId?: number;
    /** Their name, for the phone's "Set as X's profile picture" (#1121). */
    galleryPersonName?: { FirstName: string | null; LastName: string | null };
    onClose: () => void;
    onChangeIndex: (index: number) => void;
    /** Called after the primary photo / focal point changes so the caller can refresh. */
    onPrimaryChanged?: () => void;
    /** Called after a face tag is added/removed so the caller can refresh. */
    onTagsChanged?: () => void;
    /** Called after a hard delete so the caller refreshes its grid/gallery. */
    onDeleted?: (mediaId: number) => void;
    /**
     * When provided, the danger action *unlinks* the media from the caller's
     * context (e.g. a case) instead of hard-deleting it. The media row itself
     * is kept. Used by the Cases surface so lightbox removal = "remove from
     * case", not permanent delete.
     */
    onRemoveFromContext?: (mediaId: number) => Promise<void> | void;
    /** Permit the supplied context callback (e.g. owner-record unlink). */
    canRemoveFromContext?: boolean;
    /** Label for the unlink action / confirm (e.g. "Remove from case"). */
    removeActionLabel?: string;
    /** Hide the destructive/unlink action for an inferred owner row. */
    showDeleteAction?: boolean;
    /**
     * A family's gallery (#119, ADR 0047): offers "Set as family photo", or marks the
     * current one with a way to stop using it. The caller runs the write and refreshes.
     */
    familyPhoto?: {
        isCurrent: (mediaId: number) => boolean;
        onSet: (mediaId: number) => Promise<unknown>;
        onClear: (mediaId: number) => Promise<unknown>;
    };
}

/**
 * Evidence-rail lightbox shared by the library photo grid and the person
 * gallery. A dark stage shows the photo (PhotoStage) on the left with face-tag
 * drawing + overlay; the EvidencePanel rail on the right holds the title edit,
 * the tagged-people list, and the set-primary / download / delete actions.
 *
 * State machine: 'view' | 'tag'. The legacy 'crop' focal-box mode is gone —
 * primary state is canonical on the person's MediaLink; a face tag supplies
 * optional crop geometry only.
 */
export default function MediaLightbox({
    items, index, treeId, canEdit, canDelete, context = 'library', galleryPersonId, galleryPersonName,
    onClose, onChangeIndex, onPrimaryChanged, onTagsChanged, onDeleted,
    onRemoveFromContext, canRemoveFromContext = false, removeActionLabel, showDeleteAction = true, familyPhoto,
}: MediaLightboxProps) {
    const t = useTranslations('mediaLightbox');
    const tc = useTranslations('common');
    const td = useTranslations('documents');
    const locale = useLocale();
    const isMobile = useIsMobile();
    // Desktop overlay is the dialog; on mobile the nested MobileLightbox (Vaul)
    // owns dialog semantics + focus, so the trap only runs on desktop.
    const trapRef = useFocusTrap<HTMLDivElement>(!isMobile);
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [confirmRemoveTagId, setConfirmRemoveTagId] = useState<number | null>(null);
    const [tagError, setTagError] = useState<'tag_update_failed' | 'tag_remove_failed' | null>(null);

    // Drawing state machine: 'tag' draws a free rectangle over a face.
    const [mode, setMode] = useState<'view' | 'tag'>('view');
    // A null target means a newly drawn tag; an id means geometry-only redraw.
    const [drawTargetTagId, setDrawTargetTagId] = useState<number | null>(null);

    // Face tags for the current image.
    const [tags, setTags] = useState<LightboxTag[]>([]);
    const [showNames, setShowNames] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        const saved = window.sessionStorage.getItem('lightbox.showNames');
        // Names are on by default on a phone (#1121); desktop keeps them off until asked.
        return saved != null ? saved === '1' : window.matchMedia?.('(max-width: 767px)').matches === true;
    });
    // Unnamed faces from the photo's metadata (phone editors, #1121).
    const [faces, setFaces] = useState<Array<FaceRegionInput & { Id: number }>>([]);
    const [cropOpen, setCropOpen] = useState(false);
    // Tagging on a phone goes through the portrait crop (the owner's phone review of #1117):
    // whose face, and their tag's region when moving it.
    const [faceCrop, setFaceCrop] = useState<{ person: { Id: number; FirstName: string | null; LastName: string | null }; region: FaceRegionInput | null } | null>(null);
    const { reportError } = useErrorToast();
    // One cross-highlight channel, fed from both directions: hovering a rail row
    // reveals its face box, and hovering (or focusing) a face box highlights its
    // rail row. The old click-to-open popover state is gone with the popover
    // itself (#457) — a face now navigates, so there is no second state to hold.
    const [hoveredTagId, setHoveredTagId] = useState<number | null>(null);

    // Title edit. `titleOverride` reflects a just-saved title locally so the rail
    // updates immediately even if the parent hasn't refetched the items array yet.
    const [editing, setEditing] = useState(false);
    const [formTitle, setFormTitle] = useState('');
    const [titleOverride, setTitleOverride] = useState<string | null>(null);
    const [formDate, setFormDate] = useState('');
    // Like titleOverride; undefined means "not edited here".
    const [dateOverride, setDateOverride] = useState<string | null | undefined>(undefined);

    // Pending tag: a drawn region awaiting a person choice (PersonPicker modal).
    const [pendingRegion, setPendingRegion] = useState<FaceRegionInput | null>(null);
    const pickerRef = useRef<PersonPickerHandle>(null);

    // tagIntent distinguishes a plain tag from one drawn to set primary.
    const [tagIntent, setTagIntent] = useState<'add' | 'primary'>('add');

    const media = items[index];
    // Key tag-loading on the stable media id, not the media object. A refetch
    // after add/remove (onTagsChanged) replaces the items array with new objects;
    // depending on the object would re-run the reset effect and kick the user out
    // of tag mode mid-session.
    const mediaId = media?.Id;
    // A PDF document (#510) has no faces or portrait; it shows what it is linked to.
    const isDocument = isPdfMedia(media);
    const [links, setLinks] = useState<{ mediaId: number; owners: MediaLinkOwner[] } | null>(null);
    const [linking, setLinking] = useState(false);
    const documentFile = useDocumentFile(mediaId, treeId, isDocument);
    const { preview: documentPreview } = usePdfPreview(mediaId ?? 0, treeId, 768, isDocument);

    // Derived primary status — safe to compute before early return (falls back to
    // false when media is undefined, which can never happen in practice since
    // canRemoveTag is only called while a media item is displayed).
    const myTagPre = galleryPersonId != null ? tags.find(tg => tg.PersonId === galleryPersonId) : undefined;
    const isPersonPrimaryPre = media != null
        && 'IsPersonPrimary' in media
        && media.IsPersonPrimary === true;

    // Must be declared before the `if (!media) return null` early return to
    // satisfy react-hooks/rules-of-hooks. Primary removal is confirmed by the
    // shared dialog; it is no longer represented as a lock in the rail.
    const canRemoveTag = useCallback(() => !!canDelete, [canDelete]);

    const loadTags = useCallback(async () => {
        if (mediaId == null) return;
        if (isDocument) { setTags([]); return; }
        try {
            const client = await getDataClient();
            const loaded = await client.media.listTags(mediaId, treeId);
            setTags(loaded);
        } catch {
            /* ignore — tags non-critical */
        }
    }, [mediaId, treeId, isDocument]);

    const loadLinks = useCallback(async () => {
        if (mediaId == null || !isDocument) return;
        try {
            const client = await getDataClient();
            const owners = await client.media.listLinkOwners(mediaId, treeId);
            setLinks({ mediaId, owners });
        } catch {
            setLinks({ mediaId, owners: [] });
        }
    }, [mediaId, treeId, isDocument]);
    useEffect(() => { void loadLinks(); }, [loadLinks]);

    const loadFaces = useCallback(async () => {
        if (mediaId == null || !isMobile || !canEdit || isDocument) { setFaces([]); return; }
        try {
            const client = await getDataClient();
            const { groups } = await client.media.listFaceQueue({ mediaId }, treeId);
            setFaces(groups.flatMap((g) => g.candidates).filter((c) => c.MediaId === mediaId && c.Status === 'pending'));
        } catch {
            setFaces([]); /* the dashed boxes are a convenience; the queue still has them */
        }
    }, [mediaId, isMobile, canEdit, treeId, isDocument]);
    useEffect(() => { void loadFaces(); }, [loadFaces]);

    // Phone writes report through the change toast, with Undo for editors (#1121).
    const run = useChange({
        treeId,
        canUndo: !!canDelete,
        onChanged: async () => { await loadTags(); onTagsChanged?.(); onPrimaryChanged?.(); },
    });

    // Reset transient state and reload tags only when the viewed image changes.
    useEffect(() => {
        setMode('view');
        setHoveredTagId(null);
        setPendingRegion(null);
        setDrawTargetTagId(null);
        setTagIntent('add');
        setTagError(null);
        setEditing(false);
        setTitleOverride(null);
        setDateOverride(undefined);
        setCropOpen(false);
        setFaceCrop(null);
        setLinking(false);
        // Keep prior tags visible during reload to avoid a footer/star flash;
        // loadTags() replaces them when the new image's tags resolve.
        // (Do not setTags([]) here.)
        loadTags();
    }, [mediaId, loadTags]);

    // On a phone the viewer is a full-screen layer, so the phone's Back closes it like a sheet (#1053).
    const onCloseRef = useRef(onClose);
    const sheetOver = useRef(false);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
    useEffect(() => {
        if (!isMobile) return;
        return pushSheet({ requestClose: () => onCloseRef.current() });
    }, [isMobile]);

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            // The link picker takes its own Esc.
            if (confirmDelete || confirmRemoveTagId != null || linking) return;
            // A phone sheet over the viewer (tag, edit, picker, crop) takes Esc itself.
            if (sheetOver.current) return;
            if (e.key === 'Escape') {
                if (pendingRegion) { setPendingRegion(null); }
                else if (mode !== 'view') { setMode('view'); setTagIntent('add'); setDrawTargetTagId(null); }
                else if (editing) { setEditing(false); }
                else onClose();
            } else if (mode === 'view' && !pendingRegion && !editing && e.key === 'ArrowLeft' && index > 0) {
                onChangeIndex(index - 1);
            } else if (mode === 'view' && !pendingRegion && !editing && e.key === 'ArrowRight' && index < items.length - 1) {
                onChangeIndex(index + 1);
            }
        }
        // The sheet closes (and leaves the stack) before this bubbling listener runs, so
        // whether one was open is read first, in the capture phase.
        function onKeyCapture() { sheetOver.current = isMobile && openSheetCount() > 1; }
        window.addEventListener('keydown', onKeyCapture, true);
        document.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKeyCapture, true);
            document.removeEventListener('keydown', onKey);
        };
    }, [index, items.length, onClose, onChangeIndex, mode, pendingRegion, editing, confirmDelete, confirmRemoveTagId, isMobile, linking]);

    useEffect(() => {
        if (pendingRegion) {
            const id = requestAnimationFrame(() => pickerRef.current?.focus());
            return () => cancelAnimationFrame(id);
        }
    }, [pendingRegion]);

    // The mobile sheet runs `modal={false}` (so the photo stays tappable at
    // peek), which means Vaul does not lock scroll itself. Keep the explicit
    // shared lock for both desktop and mobile lightboxes.
    useDocumentScrollLock(true);

    if (!media) return null;

    const downloadHref = mediaFileUrl(media.Id, { treeId });
    const currentTitle = titleOverride ?? media.Title;
    const currentDate = dateOverride !== undefined ? dateOverride : (media.Date ?? null);

    // Per-person primary status + ownership (person context only).
    // Use the pre-early-return derivations (isPersonPrimaryPre / myTagPre) which are
    // guaranteed non-null because we only reach here when media is defined.
    const isPersonPrimary = isPersonPrimaryPre;
    const myTag = myTagPre;
    const showPrimary = context === 'person' && !!canEdit;
    const setPrimaryLabel = t('set_primary');

    const overlayTags = showNames || mode === 'tag';

    async function submitTag(person: PersonResult) {
        if (!canEdit || !media || !pendingRegion) return;
        setSaving(true);
        try {
            const client = await getDataClient();
            await client.media.createTag(media.Id, { PersonId: person.Id, ...pendingRegion }, treeId);
            await loadTags();
            onTagsChanged?.();
        } catch {
            /* ignore */
        } finally {
            setSaving(false);
            setPendingRegion(null);
        }
    }

    async function removeTag(tagId: number) {
        if (!canDelete || !media) return;
        const removedTag = tags.find(tg => tg.Id === tagId);
        setSaving(true);
        try {
            const client = await getDataClient();
            await client.media.removeTag(media.Id, tagId, treeId);
            await loadTags();
            onTagsChanged?.();
            // Fire avatar-refresh only when the removed tag was someone's primary,
            // or when removing the gallery person's own tag (affects their gallery).
            if (removedTag?.PersonId === galleryPersonId || removedTag?.IsPersonPrimary) {
                onPrimaryChanged?.();
            }
            setTagError(null);
        } catch {
            setTagError('tag_remove_failed');
        } finally {
            setSaving(false);
            setHoveredTagId(null);
        }
    }

    function requestRemoveTag(tagId: number) {
        if (!canDelete) return;
        const tag = tags.find(tg => tg.Id === tagId);
        if (tag?.IsPersonPrimary) {
            setTagError(null);
            setConfirmRemoveTagId(tagId);
            return;
        }
        void removeTag(tagId);
    }

    function startRedraw(tagId: number) {
        if (!canEdit) return;
        if (!tags.some(tag => tag.Id === tagId)) return;
        setTagError(null);
        setDrawTargetTagId(tagId);
        setMode('tag');
        setTagIntent('add');
        setHoveredTagId(null);
    }

    async function onDrawComplete(region: FaceRegionInput) {
        if (!canEdit) return;
        if (drawTargetTagId != null && media) {
            const redrawnTag = tags.find(tag => tag.Id === drawTargetTagId);
            setSaving(true);
            try {
                const client = await getDataClient();
                await client.media.updateTag(media.Id, drawTargetTagId, region, treeId);
                await loadTags();
                onTagsChanged?.();
                if (redrawnTag?.IsPersonPrimary) onPrimaryChanged?.();
                setTagError(null);
            } catch {
                setTagError('tag_update_failed');
            } finally {
                setSaving(false);
                setDrawTargetTagId(null);
                setMode('view');
            }
            return;
        }
        if (tagIntent === 'primary' && galleryPersonId != null && media) {
            // Owner had no self-tag: auto-tag them, then set primary.
            setSaving(true);
            try {
                const client = await getDataClient();
                await client.media.createTag(media.Id, { PersonId: galleryPersonId, ...region }, treeId);
                await client.media.setPrimary(media.Id, galleryPersonId, treeId);
                await loadTags();
                onPrimaryChanged?.();
                onTagsChanged?.();
            } catch {
                /* ignore */
            } finally {
                setSaving(false);
                setMode('view');
                setTagIntent('add');
            }
            return;
        }
        setPendingRegion(region); // open PersonPicker "Who is this?"
    }

    async function setPrimary() {
        if (!canEdit || galleryPersonId == null || !media) return;
        if (!myTag) { setMode('tag'); setTagIntent('primary'); return; } // draw first
        setSaving(true);
        try {
            const client = await getDataClient();
            await client.media.setPrimary(media.Id, galleryPersonId, treeId);
            await loadTags();
            onPrimaryChanged?.();
        } catch {
            /* ignore */
        } finally {
            setSaving(false);
        }
    }

    async function saveTitle() {
        if (!canEdit || !media) return;
        setSaving(true);
        try {
            const client = await getDataClient();
            const date = formDate.trim() || null;
            await client.media.update(media.Id, { Title: formTitle, Date: date }, treeId);
            // Reflect the new details locally without depending on a parent refetch.
            setTitleOverride(formTitle);
            setDateOverride(date);
            onTagsChanged?.();
        } catch {
            /* ignore */
        } finally {
            setSaving(false);
            setEditing(false);
        }
    }

    async function doDelete() {
        // Owner-record unlinking is a non-destructive edit, while case removal
        // and removing an unowned library row are destructive operations. Keep
        // those capabilities distinct for contributors.
        const canRemove = onRemoveFromContext ? !!canRemoveFromContext : !!canDelete;
        if (!canRemove || !media) return;
        setSaving(true);
        try {
            if (onRemoveFromContext) {
                // Unlink from the caller's context (e.g. a case) — keep the media row.
                await onRemoveFromContext(media.Id);
            } else {
                const client = await getDataClient();
                await client.media.remove(media.Id, treeId);
            }
            const lastIndex = items.length - 1;
            setConfirmDelete(false);
            if (index < lastIndex) onChangeIndex(index);       // next slides into this index
            else if (index > 0) onChangeIndex(index - 1);
            else onClose();
            onDeleted?.(media.Id);
            // The file goes with the row, so there is nothing to undo: a plain confirmation.
            if (isMobile && !onRemoveFromContext) showChangeToast({ message: isDocument ? td('document_deleted') : t('photo_deleted') });
        } finally {
            setSaving(false);
        }
    }

    const personName = galleryPersonName
        ? `${galleryPersonName.FirstName ?? ''} ${galleryPersonName.LastName ?? ''}`.trim()
        : (myTag ? tagPersonName(myTag, '') : '');

    async function nameFace(candidateId: number, person: PersonResult) {
        if (!canEdit) return;
        setSaving(true);
        try {
            const client = await getDataClient();
            const res = await client.media.confirmFaces([candidateId], person.Id, treeId);
            await Promise.all([loadTags(), loadFaces()]);
            onTagsChanged?.();
            if (res.confirmedCount > 0) {
                showChangeToast({
                    message: t('face_named', { name: displayFullName(person) || tc('unknown') }),
                    onUndo: canDelete ? async () => {
                        try {
                            await client.media.undoFaces([candidateId], treeId);
                            await Promise.all([loadTags(), loadFaces()]);
                            onTagsChanged?.();
                        } catch (e) { reportError(e); }
                    } : undefined,
                });
            }
        } catch (e) {
            reportError(e);
        } finally {
            setSaving(false);
        }
    }

    async function retag(tagId: number, person: PersonResult) {
        const old = tags.find((tg) => tg.Id === tagId);
        if (!canEdit || !media || !old) return;
        setSaving(true);
        await run(async () => {
            const client = await getDataClient();
            const region = { RegionX: old.RegionX, RegionY: old.RegionY, RegionW: old.RegionW, RegionH: old.RegionH };
            await client.media.createTag(media.Id, { PersonId: person.Id, ...region }, treeId);
            await client.media.removeTag(media.Id, tagId, treeId);
            // The removal returns no audit ids to revert, so this is a plain confirmation.
            return { auditIds: [] };
        }, { message: t('face_retagged') });
        setSaving(false);
    }

    async function saveDetailsPhone(title: string, date: string): Promise<boolean> {
        if (!canEdit || !media) return false;
        const next = date.trim() || null;
        return run(async () => {
            const client = await getDataClient();
            const updated = await client.media.update(media.Id, { Title: title, Date: next }, treeId);
            setTitleOverride(title);
            setDateOverride(next);
            return updated;
        }, { message: t('details_saved') });
    }

    async function linkDocument(choice: DocumentLinkChoice) {
        if (!canEdit || !media) return;
        setSaving(true);
        try {
            const client = await getDataClient();
            await client.media.linkToOwner(media.Id, choice.ownerTable, choice.ownerId, treeId, choice.ownerFact);
            setLinking(false);
            await loadLinks();
            onTagsChanged?.();
        } catch (e) {
            reportError(e);
        } finally {
            setSaving(false);
        }
    }

    async function unlinkDocument(owner: MediaLinkOwner) {
        if (!canEdit || !media) return;
        setSaving(true);
        try {
            const client = await getDataClient();
            await client.media.unlinkFromOwner(media.Id, owner.OwnerTable, owner.OwnerId, treeId, owner.OwnerFact ?? undefined);
            await loadLinks();
            onTagsChanged?.();
        } catch (e) {
            reportError(e);
        } finally {
            setSaving(false);
        }
    }

    const documentRail: DocumentRail | undefined = isDocument ? {
        meta: [
            td('pdf'),
            documentPreview ? td('pages', { count: documentPreview.pageCount }) : null,
            media.FileSize ? formatMediaBytes(media.FileSize, locale) : null,
        ].filter(Boolean).join(' · '),
        links: links?.mediaId === media.Id ? links.owners : null,
        onLink: () => setLinking(true),
        onUnlink: (owner) => { void unlinkDocument(owner); },
        fileHref: documentFile.fileHref,
        downloadHref: documentFile.downloadHref,
        downloadName: archiveMediaFilename({ Title: currentTitle, FilePath: media.FilePath || 'document.pdf' }),
    } : undefined;

    // The family photo choice runs through the caller (its Undo toast and refresh).
    const runFamilyPhoto = async (write: (mediaId: number) => Promise<unknown>) => {
        setSaving(true);
        try { await write(media.Id); } finally { setSaving(false); }
    };
    const familyPhotoRail = familyPhoto && canEdit && !isDocument ? {
        current: familyPhoto.isCurrent(media.Id),
        onSet: () => { void runFamilyPhoto(familyPhoto.onSet); },
        onClear: () => { void runFamilyPhoto(familyPhoto.onClear); },
    } : undefined;

    const evidenceProps: EvidencePanelProps = {
        canEdit: !!canEdit,
        canDelete,
        title: currentTitle,
        date: currentDate,
        editing,
        formTitle,
        formDate,
        onStartEdit: () => { setFormTitle(currentTitle ?? ''); setFormDate(currentDate ?? ''); setEditing(true); },
        onChangeTitle: setFormTitle,
        onChangeDate: setFormDate,
        onSaveEdit: saveTitle,
        onCancelEdit: () => setEditing(false),
        tags,
        galleryPersonId,
        showNames,
        onToggleNames: () => setShowNames(v => {
            const next = !v;
            if (typeof window !== 'undefined') {
                window.sessionStorage.setItem('lightbox.showNames', next ? '1' : '0');
            }
            return next;
        }),
        onHoverTag: setHoveredTagId,
        canRemoveTag,
        onStartRedraw: startRedraw,
        onRemoveTag: requestRemoveTag,
        onStartTag: () => { setTagError(null); setDrawTargetTagId(null); setMode('tag'); setTagIntent('add'); setHoveredTagId(null); },
        showPrimary,
        isPersonPrimary: !!isPersonPrimary,
        // On a phone, Set as profile picture goes through the portrait crop (#1121).
        onSetPrimary: isMobile && 'IsPersonPrimary' in media ? () => setCropOpen(true) : setPrimary,
        setPrimaryLabel: isMobile && personName ? t('set_primary_named', { name: personName }) : setPrimaryLabel,
        downloadHref,
        onDelete: () => setConfirmDelete(true),
        showDeleteAction: (onRemoveFromContext ? !!canRemoveFromContext : !!canDelete) && showDeleteAction,
        deleteLabel: removeActionLabel,
        busy: saving,
        errorMessage: tagError ? t(tagError) : null,
        document: documentRail,
        familyPhoto: familyPhotoRail,
    };
    const evidencePanel = <EvidencePanel {...evidenceProps} />;

    // Portalled to <body>: mounted inline, an ancestor stacking context (the
    // timeline's `.tl-med { isolation: isolate }`) capped its z-60 below the sticky
    // person rail, which then painted over the photo and the panel's actions.
    return createPortal(
        <div
            ref={trapRef}
            {...(isMobile ? {} : { role: 'dialog' as const, 'aria-modal': true, 'aria-label': currentTitle ?? t('photo_alt'), tabIndex: -1 })}
            className="animate-backdrop-in fixed inset-0 z-60 flex backdrop-blur-md outline-none"
            // Slightly transparent scrim (page faintly visible behind) + click the
            // empty backdrop to dismiss (issue #161). Children stopPropagation via
            // the e.target === e.currentTarget guard.
            style={{ background: 'radial-gradient(120% 120% at 50% 0%, color-mix(in srgb, var(--color-lightbox-stage-top) 88%, transparent) 0%, color-mix(in srgb, var(--color-lightbox-stage-bottom) 88%, transparent) 100%)' }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            {/* Desktop: photo column + rail. Mobile handled by MobileLightbox.
                Gate on !isMobile (not just `hidden md:flex`) so the desktop PhotoStage
                — its own Embla + ResizeObserver — never mounts on mobile alongside the
                MobileLightbox stage (double-mount = wasted work). */}
            {!isMobile && (
                <div className="hidden md:flex flex-1 min-w-0">
                    <PhotoStage
                        items={items}
                        index={index}
                        onChangeIndex={onChangeIndex}
                        treeId={treeId}
                        alt={currentTitle ?? t('photo_alt')}
                        tags={tags}
                        overlayTags={overlayTags}
                        tagMode={mode === 'tag'}
                        drawTargetTagId={drawTargetTagId}
                        hoveredTagId={hoveredTagId}
                        onHoverTag={setHoveredTagId}
                        onDrawComplete={onDrawComplete}
                        counterCurrent={index + 1}
                        counterTotal={items.length}
                        ctxNoun={context === 'person' ? t('back_to_gallery') : t('back_to_library')}
                        onClose={onClose}
                        onDoneTagging={() => { setMode('view'); setTagIntent('add'); setDrawTargetTagId(null); }}
                    />
                    <div className="hidden md:flex shrink-0">{evidencePanel}</div>
                </div>
            )}

            <MobileLightbox
                mediaId={media.Id}
                treeId={treeId}
                alt={currentTitle ?? t('photo_alt')}
                title={currentTitle}
                counterCurrent={index + 1}
                counterTotal={items.length}
                tags={tags}
                onClose={onClose}
                evidence={evidenceProps}
                isPersonPrimary={!!isPersonPrimary}
                phone={{
                    faceIds: faces.map((f) => f.Id),
                    onNameFace: nameFace,
                    onRetag: retag,
                    onSaveDetails: saveDetailsPhone,
                    onTagFace: (p) => setFaceCrop({ person: { Id: p.Id, FirstName: p.FirstName, LastName: p.LastName }, region: null }),
                    onAdjustFace: (tagId) => {
                        const tag = tags.find((tg) => tg.Id === tagId);
                        if (!tag) return;
                        setFaceCrop({
                            person: { Id: tag.PersonId, FirstName: tag.PersonFirstName, LastName: tag.PersonLastName },
                            region: { RegionX: tag.RegionX, RegionY: tag.RegionY, RegionW: tag.RegionW, RegionH: tag.RegionH },
                        });
                    },
                    portraitLabel: personName ? t('portrait_of', { name: personName }) : t('current_profile_picture'),
                }}
                photo={({ onFace, onHoldTag }) => (
                    <PhotoStage
                        bare
                        items={items}
                        index={index}
                        onChangeIndex={onChangeIndex}
                        treeId={treeId}
                        alt={currentTitle ?? t('photo_alt')}
                        tags={tags}
                        overlayTags={overlayTags}
                        tagMode={mode === 'tag'}
                        drawTargetTagId={drawTargetTagId}
                        hoveredTagId={hoveredTagId}
                        onHoverTag={setHoveredTagId}
                        onDrawComplete={onDrawComplete}
                        counterCurrent={index + 1}
                        counterTotal={items.length}
                        ctxNoun=""
                        onClose={onClose}
                        onDoneTagging={() => { setMode('view'); setTagIntent('add'); setDrawTargetTagId(null); }}
                        faces={faces}
                        onFace={onFace}
                        onHoldTag={onHoldTag}
                    />
                )}
            />

            {isMobile && galleryPersonId != null && 'IsPersonPrimary' in media && (
                <CropScreen
                    open={cropOpen}
                    target={{ media: media as PersonGalleryMedia }}
                    person={{ Id: galleryPersonId, FirstName: galleryPersonName?.FirstName ?? personName, LastName: galleryPersonName?.LastName ?? null }}
                    treeId={treeId}
                    run={run}
                    onBack={() => setCropOpen(false)}
                    onDone={() => setCropOpen(false)}
                />
            )}

            {isMobile && faceCrop && (
                <CropScreen
                    open
                    purpose="tag"
                    key={`${media.Id}:${faceCrop.person.Id}`}
                    target={{ media: {
                        Id: media.Id, FocalX: media.FocalX, FocalY: media.FocalY,
                        TagRegionX: faceCrop.region?.RegionX, TagRegionY: faceCrop.region?.RegionY,
                        TagRegionW: faceCrop.region?.RegionW, TagRegionH: faceCrop.region?.RegionH,
                    } }}
                    person={faceCrop.person}
                    treeId={treeId}
                    run={run}
                    onBack={() => setFaceCrop(null)}
                    onDone={() => setFaceCrop(null)}
                />
            )}

            <ConfirmSheet
                open={isMobile && confirmDelete}
                title={onRemoveFromContext ? (removeActionLabel ?? tc('remove')) : isDocument ? td('delete_document_title') : t('delete_photo')}
                body={onRemoveFromContext
                    ? t('remove_from_context_body')
                    : isDocument ? td('delete_document_body')
                    : <>
                        {t('delete_body_phone', { count: tags.length, names: tags.map((tg) => tagPersonName(tg, tc('unknown'))).join(', ') })}
                        {isPersonPrimary && galleryPersonId != null && <> {t('delete_primary_warning_generic')}</>}
                    </>}
                confirmLabel={onRemoveFromContext ? (removeActionLabel ?? tc('remove')) : isDocument ? td('delete_document') : t('delete_photo_action')}
                busy={saving}
                onConfirm={doDelete}
                onClose={() => setConfirmDelete(false)}
            />
            <ConfirmSheet
                open={isMobile && confirmRemoveTagId != null}
                title={t('remove_primary_tag_title')}
                body={t('remove_primary_tag_warning')}
                confirmLabel={tc('remove')}
                busy={saving}
                onConfirm={async () => {
                    const tagId = confirmRemoveTagId;
                    setConfirmRemoveTagId(null);
                    if (tagId != null) await removeTag(tagId);
                }}
                onClose={() => setConfirmRemoveTagId(null)}
            />

            <ConfirmDialog
                open={!isMobile && confirmDelete}
                variant="calm"
                tone="danger"
                title={onRemoveFromContext ? (removeActionLabel ?? tc('remove')) : isDocument ? td('delete_document_title') : t('delete_photo')}
                body={onRemoveFromContext
                    ? t('remove_from_context_body')
                    : isDocument ? td('delete_document_body')
                    : t('delete_body', { title: currentTitle ?? t('photo_alt'), count: tags.length })}
                warning={!onRemoveFromContext && isPersonPrimary && galleryPersonId != null
                    ? t('delete_primary_warning_generic')
                    : undefined}
                confirmLabel={onRemoveFromContext ? (removeActionLabel ?? tc('remove')) : tc('delete')}
                busy={saving}
                elevated
                onConfirm={doDelete}
                onCancel={() => setConfirmDelete(false)}
            />

            <ConfirmDialog
                open={!isMobile && confirmRemoveTagId != null}
                variant="calm"
                tone="danger"
                title={t('remove_primary_tag_title')}
                body={t('remove_primary_tag_body')}
                warning={t('remove_primary_tag_warning')}
                confirmLabel={tc('remove')}
                busy={saving}
                elevated
                onConfirm={async () => {
                    const tagId = confirmRemoveTagId;
                    setConfirmRemoveTagId(null);
                    if (tagId != null) await removeTag(tagId);
                }}
                onCancel={() => setConfirmRemoveTagId(null)}
            />

            {linking && (
                <LinkDocumentModal treeId={treeId} busy={saving} onPick={(choice) => { void linkDocument(choice); }} onCancel={() => setLinking(false)} />
            )}

            {/* Person picker for a freshly drawn face box. */}
            {pendingRegion && (
                <WhoIsThisModal
                    pickerRef={pickerRef}
                    excludeIds={tags.map(tg => tg.PersonId)}
                    treeId={treeId}
                    mediaId={media.Id}
                    region={pendingRegion}
                    busy={saving}
                    overlapName={(() => {
                        const hit = overlappedTag(pendingRegion, tags);
                        return hit ? tagPersonName(hit, tc('unknown')) : null;
                    })()}
                    onPick={submitTag}
                    onCancel={() => setPendingRegion(null)}
                />
            )}
        </div>,
        document.body,
    );
}
