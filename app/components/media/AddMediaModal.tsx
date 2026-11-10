'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import Modal from '@/app/components/Modal';
import MediaImg from '@/app/components/MediaImg';
import { Banner, Button, DialogHeader, EmptyState, InlineDataError, SegmentedControl, showSuccessToast, cx } from '@/app/components/ui';
import { Input } from '@/app/components/ui/Input';
import { withWriteBatch } from '@/lib/data';
import { FileTooLargeError, RateLimitError, StorageLimitError } from '@/lib/data/errors';
import { errorToastKey } from '@/lib/utils/data-error';
import { isPdfMedia } from '@/lib/media/allowed-extensions';
import { formatMediaBytes } from '@/lib/media/format-bytes';
import { displayFullName } from '@/lib/utils/names';
import { AlertTriangle, ImageUp, Info, Loader2, Search } from '@/lib/icons';
import type { MediaWithPerson } from '@/lib/db/schema';
import type { MediaOwnerFact, MediaOwnerTable } from '@/lib/db/fact-tables';
import type { MediaStorageSummary } from '@/lib/data/types';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { useErrorToast } from '@/app/components/useErrorToast';
import { AddMediaTile, NewFileImage } from './add-media/AddMediaTile';
import { MobileAddMediaSheet } from './add-media/MobileAddMediaSheet';
import { useUploadBatch, type UploadRow } from './add-media/useUploadBatch';
import { useLibraryCandidates, type LibraryScope } from './add-media/useLibraryCandidates';
import { excludeAttached, filterLibrary, splitOwnerRelevant, type MediaKindFilter, type MediaPickerSource } from './add-media/library';
import { mediaFactLabel } from './mediaFactLabel';

/**
 * What Add media attaches to (#1204). `owner` is a person, family, event or source
 * (People with no fact is the person's gallery, the only target that offers Primary);
 * `galleryPersonId` also puts new files in that person's gallery, for a life event.
 * A case brings its own candidates and attach. The Library page has no owner, so it
 * only uploads.
 */
export type AddMediaTarget =
    | { kind: 'owner'; ownerTable: MediaOwnerTable; ownerId?: number; ownerFact?: MediaOwnerFact; galleryPersonId?: number }
    | { kind: 'case'; caseId: number; source: MediaPickerSource }
    | { kind: 'library' };

interface AddMediaModalProps {
    target: AddMediaTarget;
    treeId: number | null;
    /** "To {name}", "Tagged with {name}" and "{name}'s gallery". */
    targetName?: string | null;
    /** An event's label for the "To" line; a vital fact names itself. */
    targetPart?: string | null;
    /** The event's date, shown in the evidence colour. */
    targetDate?: string | null;
    /** People whose tagged media is suggested first (#414). */
    relevantPersonIds?: readonly number[];
    storageSummary?: MediaStorageSummary | null;
    onClose: () => void;
    /** Everything picked is attached and every new file is up. */
    onAdded: () => void;
    /** Refreshes callers after any persisted row, including a partial batch. */
    onMediaChanged?: () => void;
    /** An unsaved event: Add hands the picks back and writes nothing. */
    onStage?: (picks: { files: File[]; mediaIds: number[] }) => void;
    stagedMediaIds?: readonly number[];
}

/** A batch that stopped partway; the remaining count is whatever is still picked. */
interface BatchFailure {
    done: number;
    rateLimited: boolean;
    message: string;
}

interface LibrarySection {
    key: string;
    title: string;
    why: string;
    items: MediaWithPerson[];
}

const EMPTY_IDS: readonly number[] = [];
const ACCEPT = 'image/*,application/pdf,.pdf';

/**
 * Add media (#1204): one surface for every Add media and Attach media entry point.
 * A drop strip for new files sits above a search of the library; whatever is ticked
 * attaches to the owner that opened it. New files arrive ticked; one the library
 * already holds becomes that library item, so it is attached instead of stored
 * twice. Nothing is written until Add, so Cancel leaves the library untouched.
 * On a phone it is a full-height sheet (MobileAddMediaSheet) over the same state.
 */
export default function AddMediaModal({
    target, treeId, targetName, targetPart, targetDate, relevantPersonIds = EMPTY_IDS, storageSummary,
    onClose, onAdded, onMediaChanged, onStage, stagedMediaIds = EMPTY_IDS,
}: AddMediaModalProps) {
    const t = useTranslations('addMedia');
    const tu = useTranslations('upload');
    const tc = useTranslations('common');
    const to = useTranslations('ownerMedia');
    const locale = useLocale();
    const router = useRouter();
    const titleId = useId();
    const isMobile = useIsMobile();
    const { redirectIfUnauthorized } = useErrorToast();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const draft = onStage != null;
    const owner = target.kind === 'owner' ? target : null;
    const isGallery = owner?.ownerTable === 'People' && owner.ownerFact == null;
    const showPrimary = isGallery && !draft;
    const scope = useMemo<LibraryScope>(() => (
        target.kind === 'owner'
            ? { kind: 'owner', ownerTable: target.ownerTable, ownerId: target.ownerId, ownerFact: target.ownerFact }
            : target.kind === 'case' ? { kind: 'source', source: target.source } : { kind: 'none' }
    ), [target]);

    const batch = useUploadBatch({ treeId, swapDuplicates: target.kind !== 'library' });
    const library = useLibraryCandidates(scope, treeId);
    const [picked, setPicked] = useState<Set<number>>(() => new Set());
    const [query, setQuery] = useState('');
    const [kind, setKind] = useState<MediaKindFilter>('all');
    const [busy, setBusy] = useState(false);
    const [uploadingId, setUploadingId] = useState<string | null>(null);
    const [failure, setFailure] = useState<BatchFailure | null>(null);
    const [dragOver, setDragOver] = useState(false);

    const attachedIds = library.attachedIds;
    const part = targetPart ?? (owner?.ownerFact ? mediaFactLabel(to, [owner.ownerFact]) : null);

    // A new file standing for a library item it duplicates (#592) attaches that item;
    // one the owner already has is shown but can't be picked.
    const alreadyHere = (row: UploadRow) => row.libraryId != null && (attachedIds?.has(row.libraryId) || stagedMediaIds.includes(row.libraryId));
    const toUpload = batch.rows.filter(r => r.selected && !r.done && r.libraryId == null);
    const swappedIds = batch.rows.filter(r => r.selected && !r.done && r.libraryId != null && !alreadyHere(r)).map(r => r.libraryId!);
    const linkIds = [...new Set([...picked, ...swappedIds])];
    const pickedCount = linkIds.length + toUpload.length;
    const needsAttached = library.enabled && (picked.size > 0 || swappedIds.length > 0);
    const canAdd = pickedCount > 0 && !busy && !batch.scanning && (!needsAttached || attachedIds != null);

    const candidates = useMemo(() => {
        if (!library.all || !attachedIds) return null;
        return excludeAttached(library.all, new Set([...attachedIds, ...stagedMediaIds]));
    }, [library.all, attachedIds, stagedMediaIds]);

    const taggedTitle = targetName ? t('section_tagged', { name: targetName }) : t('section_tagged_here');
    const sourceTitle = target.kind === 'case' ? target.source.sectionTitle : undefined;
    const sections = useMemo<LibrarySection[] | null>(() => {
        if (!candidates) return null;
        const visible = filterLibrary(candidates, query, kind);
        const { tagged, rest } = splitOwnerRelevant(visible, relevantPersonIds);
        if (query.trim()) {
            if (visible.length === 0) return [];
            return [{ key: 'matches', title: t('section_matches'), why: tagged.length > 0 ? t('why_tagged_first', { title: taggedTitle }) : '', items: [...tagged, ...rest] }];
        }
        const out: LibrarySection[] = [];
        if (tagged.length > 0) out.push({ key: 'tagged', title: taggedTitle, why: t('why_shown_first'), items: tagged });
        if (rest.length > 0) out.push({ key: 'rest', title: tagged.length > 0 ? t('section_rest') : sourceTitle ?? t('section_library'), why: '', items: rest });
        return out;
    }, [candidates, query, kind, relevantPersonIds, t, taggedTitle, sourceTitle]);

    const emptyLibrary = library.enabled && library.all != null && library.all.length === 0;
    const allAttached = !emptyLibrary && candidates != null && candidates.length === 0;
    const showSearch = library.enabled && !emptyLibrary && !allAttached;
    const noMatches = showSearch && sections != null && sections.length === 0;

    // The phone opens its photo picker at once when there is nothing to pick from
    // (#1124): the Library page's upload, or an empty library.
    const pickerOpened = useRef(false);
    const openPickerAtOnce = isMobile && (target.kind === 'library' || emptyLibrary);
    useEffect(() => {
        if (!openPickerAtOnce || pickerOpened.current) return;
        pickerOpened.current = true;
        fileInputRef.current?.click();
    }, [openPickerAtOnce]);

    function browse() {
        if (!busy) fileInputRef.current?.click();
    }

    function addFiles(files: FileList | null) {
        if (busy || !files || files.length === 0) return;
        // A new intent: drop a stale "stopped" banner that counts a different batch.
        setFailure(null);
        batch.addFiles(files);
    }

    function toggleLibrary(id: number) {
        if (busy || attachedIds == null) return;
        setPicked(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    function clearPicks() {
        if (busy) return;
        setPicked(new Set());
        batch.unselectAll();
    }

    function uploadInput(row: UploadRow) {
        const base = { file: row.file };
        if (target.kind === 'case') return { ...base, caseId: target.caseId };
        if (target.kind === 'library' || target.ownerId == null) return base;
        if (isGallery) return { ...base, personId: target.ownerId, isPrimary: row.primary && !row.document ? true : undefined };
        return {
            ...base,
            ownerTable: target.ownerTable,
            ownerRecordId: target.ownerId,
            ownerFact: target.ownerFact,
            personId: target.galleryPersonId,
        };
    }

    async function add() {
        if (!canAdd) return;
        if (draft) {
            onStage?.({ files: toUpload.map(r => r.file), mediaIds: linkIds });
            onClose();
            return;
        }
        setBusy(true);
        setFailure(null);
        let done = 0;
        let facesFound = 0;
        // A box, not a bare `let`: TypeScript doesn't see the batch callback assign it.
        const current: { row: (typeof toUpload)[number] | null } = { row: null };
        try {
            // One IndexedDB flush for the whole batch, not one per photo (#1259).
            await withWriteBatch(async (client) => {
                for (const row of toUpload) {
                    current.row = row;
                    setUploadingId(row.id);
                    const media = await client.media.upload(uploadInput(row), treeId);
                    facesFound += media.FacesFound ?? 0;
                    done++;
                    batch.markDone(row.id);
                }
                current.row = null;
                setUploadingId(null);
                if (linkIds.length > 0) {
                    if (target.kind === 'case') {
                        await target.source.attach(linkIds);
                        done += linkIds.length;
                    } else if (target.kind === 'owner' && target.ownerId != null) {
                        for (const id of linkIds) {
                            await client.media.linkToOwner(id, target.ownerTable, target.ownerId, treeId, target.ownerFact);
                            done++;
                            // A retry after a failure must not link the same item twice.
                            setPicked(prev => { const next = new Set(prev); next.delete(id); return next; });
                            for (const row of batch.rowsRef.current) if (row.libraryId === id) batch.markDone(row.id);
                        }
                    }
                }
            });
            if (done > 0) onMediaChanged?.();
            onAdded();
            // Batch total, not one toast per photo (#487), and nothing when no photo
            // carried face data.
            if (facesFound > 0) {
                showSuccessToast(tu('faces_found', { count: facesFound }), {
                    label: tu('faces_review'),
                    onClick: () => router.push('/library?tab=faces'),
                });
            }
        } catch (e) {
            if (redirectIfUnauthorized(e)) return;
            // A batch that stops partway skips the faces toast: don't celebrate a
            // batch the user still sees as failed. The faces wait in the queue anyway.
            if (done > 0) onMediaChanged?.();
            const storageMessage = e instanceof StorageLimitError
                && e.usedBytes != null && e.limitBytes != null && e.remainingBytes != null
                ? tu('storage_limit_details', {
                    used: formatMediaBytes(e.usedBytes, locale),
                    limit: formatMediaBytes(e.limitBytes, locale),
                    remaining: formatMediaBytes(e.remainingBytes, locale),
                })
                : tc('error_storage_full');
            setFailure({
                done,
                rateLimited: e instanceof RateLimitError,
                // Raw errors can carry PGlite/IndexedDB details; keep the surface on
                // translated copy. The typed storage error keeps its specific wording.
                message: e instanceof StorageLimitError
                    ? storageMessage
                    // The same limit the drop zone states (#1215).
                    : e instanceof FileTooLargeError
                    ? tu('file_too_large', {
                        name: current.row?.file.name ?? '',
                        limit: formatMediaBytes(e.limitBytes ?? 10 * 1024 * 1024, locale),
                    })
                    : e instanceof Error ? tc('error_generic') : tu('upload_failed'),
            });
        } finally {
            setBusy(false);
            setUploadingId(null);
        }
    }

    const quotaWarning = storageSummary?.quotaMode === 'tree'
        && storageSummary.limitBytes != null
        && storageSummary.percentUsed != null
        && storageSummary.percentUsed >= 80
        ? {
            full: storageSummary.percentUsed >= 100,
            used: formatMediaBytes(storageSummary.usedBytes, locale),
            limit: formatMediaBytes(storageSummary.limitBytes, locale),
        }
        : null;

    const toLine = targetName ? (
        <>
            {t.rich('to_line', { name: targetName, b: (chunks) => <b className="font-semibold text-text-secondary">{chunks}</b> })}
            {(part ?? (isGallery ? t('to_gallery') : owner?.ownerTable === 'Families' ? t('to_family') : null)) && (
                <> · {part ?? (isGallery ? t('to_gallery') : t('to_family'))}</>
            )}
            {targetDate && <> · <span className="date-mono">{targetDate}</span></>}
        </>
    ) : null;

    const dropLine = (() => {
        if (target.kind === 'library') return t('drop_to_library');
        if (target.kind === 'case') return t('drop_to_case');
        const galleryName = isGallery || target.galleryPersonId != null || target.ownerFact != null ? targetName : null;
        if (isGallery) return galleryName ? t('drop_to_gallery', { name: galleryName }) : t('drop_to_person');
        if (part && galleryName && (target.ownerTable === 'People' || target.galleryPersonId != null)) return t('drop_to_part_and_gallery', { part, name: galleryName });
        if (part) return t('drop_to_part', { part });
        if (target.ownerTable === 'Families') return t('drop_to_family');
        if (target.ownerTable === 'Sources') return t('drop_to_source');
        return t('drop_to_event');
    })();

    const swappedRows = batch.rows.filter(r => r.libraryId != null && r.duplicate?.kind === 'in-tree');
    const swapNote = swappedRows.length === 1
        ? (swappedRows[0].duplicate?.title
            ? t('swap_note_named', { file: swappedRows[0].file.name, title: swappedRows[0].duplicate.title })
            : t('swap_note_unnamed', { file: swappedRows[0].file.name }))
        : swappedRows.length > 1 ? t('swap_note_many', { count: swappedRows.length }) : null;
    const skippedNote = target.kind === 'library' && batch.rows.some(r => r.duplicate?.kind === 'in-tree')
        ? t('library_dup_note', { count: batch.rows.filter(r => r.duplicate?.kind === 'in-tree').length })
        : null;

    const uploadingIndex = uploadingId ? toUpload.findIndex(r => r.id === uploadingId) : -1;
    const uploadingRow = uploadingIndex >= 0 ? toUpload[uploadingIndex] : null;
    const status = busy
        ? (uploadingRow ? t('status_uploading', { file: uploadingRow.file.name, n: uploadingIndex + 1, total: toUpload.length }) : t('status_attaching'))
        : pickedCount === 0 ? ''
            : toUpload.length > 0 && !draft
                ? t('status_picked_new', { count: pickedCount, files: toUpload.length })
                : t('status_picked', { count: pickedCount });

    function rowState(row: UploadRow): { flag: { text: string; ink?: boolean } | null; label: string; progress: 'waiting' | 'uploading' | 'done' | null } {
        const progress = row.done ? 'done' : busy && row.selected && row.libraryId == null ? (row.id === uploadingId ? 'uploading' : 'waiting') : null;
        if (alreadyHere(row)) return { flag: { text: t('flag_already_here'), ink: true }, label: t('tile_already_here', { name: row.file.name }), progress };
        if (row.libraryId != null) return { flag: { text: t('flag_in_library'), ink: true }, label: t('tile_in_library', { name: row.file.name }), progress };
        if (row.duplicate?.kind === 'in-tree') return { flag: { text: t('flag_in_library'), ink: true }, label: t('tile_in_library_skipped', { name: row.file.name }), progress };
        if (row.duplicate?.kind === 'in-batch') return { flag: { text: tu('state_picked_twice') }, label: t('tile_picked_twice', { name: row.file.name }), progress };
        return { flag: progress ? null : { text: t('flag_new') }, label: t('tile_new', { name: row.file.name }), progress };
    }

    function libraryMeta(m: MediaWithPerson): string {
        const document = isPdfMedia(m);
        const names = document ? (m.LinkedPersonNames ?? []) : (m.TaggedPersonNames ?? []);
        const person = target.kind === 'case' && names.length === 0
            ? displayFullName({ FirstName: m.PersonFirstName, LastName: m.PersonLastName, EffectiveFirstName: m.PersonEffectiveFirstName, Nickname: m.PersonNickname })
            : null;
        const who = person || (names.length === 1 ? names[0] : names.length > 1 ? t('meta_people', { count: names.length })
            : document && m.LinkCount === 0 ? t('meta_not_linked') : document ? null : t('meta_untagged'));
        return [document ? t('meta_document') : t('meta_photo'), who].filter(Boolean).join(' · ');
    }

    const fileInput = (
        <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            aria-label={t('browse_label')}
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
    );

    const errors = (
        <>
            {library.mediaError != null && (
                <InlineDataError message={String(tc(errorToastKey(library.mediaError)))} retryLabel={String(tc('retry'))} onRetry={library.loadMedia} />
            )}
            {library.attachedError != null && (
                <InlineDataError message={String(tc(errorToastKey(library.attachedError)))} retryLabel={String(tc('retry'))} onRetry={library.loadAttached} />
            )}
        </>
    );

    const failureBanner = failure && (
        <Banner tone="error" icon={<AlertTriangle className="w-4 h-4" />}>
            <p className="font-semibold">{tu('batch_stopped')}</p>
            <p className="mt-0.5">{t('batch_partial', { done: failure.done, remaining: pickedCount })}</p>
            <p className="mt-0.5">{failure.rateLimited ? tu('batch_rate_limited') : failure.message}</p>
        </Banner>
    );

    const quotaBanner = quotaWarning && (
        <Banner tone={quotaWarning.full ? 'error' : 'warning'} icon={<AlertTriangle className="w-4 h-4" />}>
            {tu(quotaWarning.full ? 'storage_full' : 'storage_near_limit', { used: quotaWarning.used, limit: quotaWarning.limit })}
        </Banner>
    );

    const kindOptions = [
        { v: 'all', l: t('kind_all') },
        { v: 'photos', l: t('kind_photos') },
        { v: 'documents', l: t('kind_documents') },
    ];

    if (isMobile) {
        return (
            <>
                {fileInput}
                <MobileAddMediaSheet
                    toLine={toLine}
                    rows={batch.rows}
                    rowState={rowState}
                    sections={sections}
                    picked={picked}
                    treeId={treeId}
                    loading={library.enabled && sections == null && library.mediaError == null && library.attachedError == null}
                    emptyLibrary={emptyLibrary}
                    emptyLabel={target.kind === 'case' ? target.source.emptyLabel ?? null : null}
                    allAttached={allAttached}
                    showSearch={showSearch}
                    noMatches={noMatches}
                    query={query}
                    kind={kind}
                    kindOptions={kindOptions}
                    swapNote={swapNote ?? skippedNote}
                    banners={<>{quotaBanner}{failureBanner}{errors}</>}
                    scanning={batch.scanning}
                    busy={busy}
                    canAdd={canAdd}
                    addLabel={busy ? t('adding_n', { n: Math.max(uploadingIndex + 1, 1), total: Math.max(toUpload.length, 1) }) : t('add_n', { count: pickedCount })}
                    showPrimary={showPrimary}
                    onBrowse={browse}
                    onToggleRow={batch.toggle}
                    onSetPrimary={batch.setPrimary}
                    onToggleLibrary={toggleLibrary}
                    onQuery={setQuery}
                    onKind={(v) => setKind(v as MediaKindFilter)}
                    onAdd={() => void add()}
                    onClose={() => { if (!busy) onClose(); }}
                />
            </>
        );
    }

    const hasRows = batch.rows.length > 0;
    const bigDrop = !hasRows && (target.kind === 'library' || emptyLibrary);
    const strip = (
        <button
            type="button"
            onClick={browse}
            disabled={busy}
            onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            className={cx(
                // A drop target, not a card: the dashed edge is its own token (#1204).
                'flex w-full items-center gap-3.5 rounded-xl border-2 border-dashed text-left cursor-pointer transition-colors focus-ring disabled:cursor-default disabled:opacity-55',
                'bg-card-alt',
                dragOver ? 'border-text' : 'border-drop-edge',
                bigDrop ? 'flex-col justify-center gap-2 px-6 py-11 text-center' : hasRows ? 'px-3.5 py-2.5' : 'px-4 py-3.5',
            )}
        >
            <span aria-hidden="true" className={cx('grid shrink-0 place-items-center rounded-full bg-surface-2 text-text-secondary', bigDrop ? 'w-14 h-14' : hasRows ? 'w-8 h-8' : 'w-10 h-10')}>
                <ImageUp className="w-5 h-5" />
            </span>
            <span className="min-w-0">
                <span className="block text-base font-semibold text-text">
                    {t.rich(hasRows ? 'drop_more' : 'drop_title', { browse: (chunks) => <span className="font-medium text-link underline underline-offset-2">{chunks}</span> })}
                </span>
                <span className="block text-meta text-text-muted">{dropLine}</span>
            </span>
            <span className={cx('text-meta text-text-muted', !bigDrop && 'ml-auto shrink-0')}>{t('drop_limit')}</span>
        </button>
    );

    return (
        <Modal open onClose={onClose} size="xl" disableClose={busy} labelledBy={titleId} elevated>
            <div className="bg-card rounded-2xl shadow-xl overflow-hidden flex flex-col h-[86vh] max-h-[720px]">
                <DialogHeader
                    title={t('title')}
                    titleId={titleId}
                    subtitle={toLine}
                    onClose={onClose}
                    closeDisabled={busy}
                    className="px-6 pt-5 pb-4 border-b border-border"
                />
                {fileInput}

                {/* A file dropped anywhere in the body joins the batch, not a new browser tab. */}
                <div
                    className="flex-1 min-h-0 overflow-y-auto scroll-area px-6 py-4 flex flex-col gap-4"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                >
                    {quotaBanner}
                    {/* Above the grid, not below it: an interrupted batch further down
                        read as "nothing happened" (#593). */}
                    {failureBanner}
                    {strip}

                    {showSearch && (
                        <div className={cx('flex items-center gap-3', busy && 'opacity-55 pointer-events-none')}>
                            <div className="flex-1 min-w-0">
                                <Input
                                    icon={<Search size={16} aria-hidden="true" />}
                                    type="search"
                                    placeholder={t('search_placeholder')}
                                    aria-label={t('search_placeholder')}
                                    value={query}
                                    disabled={busy}
                                    onChange={(e) => setQuery(e.target.value)}
                                />
                            </div>
                            <SegmentedControl value={kind} options={kindOptions} onChange={(v) => setKind(v as MediaKindFilter)} aria-label={t('kind_label')} disabled={busy} />
                        </div>
                    )}

                    {errors}

                    {emptyLibrary && !hasRows && (
                        <p className="m-0 text-center text-sm text-text-muted">{target.kind === 'case' && target.source.emptyLabel ? target.source.emptyLabel : t('empty_library')}</p>
                    )}
                    {allAttached && <p className="m-0 text-center text-sm text-text-muted">{t('all_attached')}</p>}

                    {hasRows && (
                        <section aria-label={t('section_new')}>
                            <SectionHead title={t('section_new')} count={batch.rows.length} why={batch.scanning ? tu('scanning') : busy ? '' : t('why_untick')} live={batch.scanning} />
                            {(swapNote ?? skippedNote) && <Note>{swapNote ?? skippedNote}</Note>}
                            <div className="grid grid-cols-5 gap-x-3.5 gap-y-4">
                                {batch.rows.map(row => {
                                    const state = rowState(row);
                                    return (
                                        <AddMediaTile
                                            key={row.id}
                                            variant="desktop"
                                            image={<NewFileImage preview={row.preview} document={row.document} />}
                                            caption={row.libraryId != null && row.duplicate?.title ? row.duplicate.title : row.file.name}
                                            meta={state.progress === 'done' ? t('meta_uploaded') : row.libraryId != null ? t('meta_from_file', { file: row.file.name }) : formatMediaBytes(row.file.size, locale)}
                                            label={state.label}
                                            selected={row.selected || row.done}
                                            disabled={busy || row.done || alreadyHere(row)}
                                            onToggle={() => batch.toggle(row.id)}
                                            documentBadge={row.document ? t('badge_pdf') : null}
                                            flag={state.flag}
                                            primary={showPrimary && !row.document && row.libraryId == null && row.selected
                                                ? { on: row.primary, label: tu('primary'), setLabel: tu('set_primary'), onToggle: () => batch.setPrimary(row.primary ? null : row.id) }
                                                : null}
                                            progress={state.progress}
                                            waitingLabel={t('waiting')}
                                        />
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    {library.enabled && sections == null && library.mediaError == null && library.attachedError == null && (
                        <p className="m-0 py-6 text-center text-sm text-text-muted">{tc('loading')}</p>
                    )}

                    {noMatches && (
                        <EmptyState
                            variant="filtered"
                            title={query.trim() ? t('no_match_title', { query: query.trim() }) : t('no_match_kind', { kind })}
                            message={t('no_match_hint')}
                            clearLabel={tc('clear_search')}
                            onClear={() => { setQuery(''); setKind('all'); }}
                        />
                    )}

                    {sections?.map(section => (
                        <section key={section.key} aria-label={section.title} className={cx(busy && 'opacity-55 pointer-events-none')}>
                            <SectionHead title={section.title} count={section.items.length} why={section.why} />
                            <div className="grid grid-cols-5 gap-x-3.5 gap-y-4">
                                {section.items.map(m => (
                                    <AddMediaTile
                                        key={m.Id}
                                        variant="desktop"
                                        image={<MediaImg mediaId={m.Id} contentType={m.ContentType} treeId={treeId} width={256} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                        caption={m.Title || t('untitled')}
                                        meta={libraryMeta(m)}
                                        label={m.Title || t('untitled')}
                                        selected={picked.has(m.Id)}
                                        disabled={busy || attachedIds == null}
                                        onToggle={() => toggleLibrary(m.Id)}
                                        documentBadge={isPdfMedia(m) ? t('badge_pdf') : null}
                                    />
                                ))}
                            </div>
                        </section>
                    ))}
                </div>

                <div className="flex items-center gap-3 px-6 py-3.5 border-t border-border bg-card-alt">
                    {/* Clear sits at the far left so it never moves; nothing shows here
                        while nothing is picked. */}
                    <div className="flex flex-1 min-w-0 items-center gap-2 text-sm text-text-secondary" role="status" aria-live="polite">
                        {pickedCount > 0 && !busy && <Button variant="outline" onClick={clearPicks}>{t('clear')}</Button>}
                        {busy && <Loader2 className="w-4 h-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                        <span className="truncate tabular-nums">{status}</span>
                    </div>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
                    <Button
                        variant="primary"
                        onClick={() => void add()}
                        disabled={!canAdd}
                        icon={busy ? <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : undefined}
                    >
                        {busy ? t('adding') : t('add_n', { count: pickedCount })}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function SectionHead({ title, count, why, live }: { title: string; count: number; why: string; live?: boolean }) {
    return (
        <div className="mb-2.5 flex items-baseline gap-2">
            <h3 className="m-0 eyebrow">{title}{' '}<span className="ml-1 font-mono font-normal tracking-normal">{count}</span></h3>
            <span className="ml-auto text-meta text-text-muted" role={live ? 'status' : undefined}>{why}</span>
        </div>
    );
}

function Note({ children }: { children: React.ReactNode }) {
    return (
        <div className="mb-3 flex items-start gap-2.5 rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-text-secondary">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-link" aria-hidden="true" />
            <span>{children}</span>
        </div>
    );
}
