'use client';

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import { errorToastKey } from '@/lib/utils/data-error';
import { useErrorToast } from '@/app/components/useErrorToast';
import { AddRow, Badge, Button, InlineDataError } from '@/app/components/ui';
import AddMediaModal from '@/app/components/media/AddMediaModal';
import MediaGallery from '@/app/components/media/MediaGallery';
import { ImageUp } from '@/lib/icons';
import type { OwnerGalleryMedia } from '@/lib/db/schema';
import type { MediaOwnerFact, MediaOwnerTable } from '@/lib/db/fact-tables';
import { X } from '@/lib/icons';
import { mediaFactLabel } from './mediaFactLabel';

/**
 * A media (photo / document) gallery for any owner record (family, source, …)
 * backed by Media + MediaLink. Lists attached media as thumbnails and — when
 * `canEdit` — lets the user upload new images and detach existing ones.
 * `canDelete` — permits destructive media/tag actions inside the lightbox;
 * context unlink remains governed by `canEdit`.
 * Used on the family detail page and the source modal (UI follow-up to Slice 1).
 *
 * With `ownerFact` it is that fact's panel (a birth, death or marriage): it lists,
 * adds and removes only that fact's links. Without it, a photo linked to one of the
 * owner's facts shows with the fact's name, and is removed from the fact's panel
 * (ADR 0030).
 */
export function OwnerMediaCard({
    ownerTable,
    ownerId,
    ownerFact,
    treeId,
    canEdit,
    canDelete,
    header,
    relevantPersonIds,
    galleryPersonId,
    targetName,
    targetPart,
    targetDate,
    onChanged,
    look = 'card',
    onCount,
}: {
    /**
     * `strip`: the v1.1 desktop record page's Media section (#119): one row of six
     * squares with "+N", no card, and a plain "Add media" line under it.
     */
    look?: 'card' | 'strip';
    /** Reports how many items the owner has, for the section's count. */
    onCount?: (count: number) => void;
    ownerTable: MediaOwnerTable;
    ownerId: number;
    /** The owner's vital fact this card is the panel for. Set from context, never chosen. */
    ownerFact?: MediaOwnerFact;
    treeId: number | null;
    canEdit: boolean;
    canDelete: boolean;
    /** Optional heading rendered inside the card top (rail sections pass one). */
    header?: ReactNode;
    /** Already-loaded people whose tagged photos should be suggested first. */
    relevantPersonIds?: readonly number[];
    /** A life event's person: new uploads also go in their gallery (#1204). */
    galleryPersonId?: number;
    /** Add media's "To {name} · {part} · {date}" line. */
    targetName?: string | null;
    targetPart?: string | null;
    targetDate?: string | null;
    /** Called after a photo is added or removed here, for a parent that shows the same photos elsewhere. */
    onChanged?: () => void;
}) {
    const t = useTranslations('ownerMedia');
    const tc = useTranslations('common');
    const scopeKey = `${ownerTable}:${ownerId}:${ownerFact ?? ''}:${treeId ?? 'default'}`;
    const [media, setMedia] = useState<OwnerGalleryMedia[] | null>(null);
    const [mediaKey, setMediaKey] = useState(scopeKey);
    const [busy, setBusy] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [loadError, setLoadError] = useState<unknown>(null);
    const [loadErrorKey, setLoadErrorKey] = useState<string | null>(null);
    const loadGeneration = useRef(0);
    const { reportError, redirectIfUnauthorized } = useErrorToast();

    const load = useCallback(async () => {
        const generation = ++loadGeneration.current;
        setLoadError(null);
        setLoadErrorKey(null);
        try {
            const client = await getDataClient();
            const loaded = await client.media.listGalleryForOwner(ownerTable, ownerId, treeId, ownerFact);
            if (generation === loadGeneration.current) {
                setMedia(loaded);
                setMediaKey(scopeKey);
            }
        } catch (e) {
            if (redirectIfUnauthorized(e)) return;
            if (generation === loadGeneration.current) {
                setLoadError(e);
                setLoadErrorKey(scopeKey);
            }
        }
    }, [ownerTable, ownerId, ownerFact, treeId, redirectIfUnauthorized, scopeKey]);

    useEffect(() => { load(); }, [load]);

    async function unlink(id: number) {
        if (busy) return;
        setBusy(true);
        try {
            const client = await getDataClient();
            await client.media.unlinkFromOwner(id, ownerTable, ownerId, treeId, ownerFact);
            setMedia((prev) => {
                const current = prev?.find((m) => m.Id === id);
                // A family row can be both explicitly linked and inferred from
                // tagged family members, and a record's photo can also be linked
                // to one of its facts. Removing only the record link must leave
                // that row visible and read-only.
                if (!ownerFact && (current?.IsInferred || (current?.OwnerFacts?.length ?? 0) > 0)) {
                    return (prev ?? []).map((m) => m.Id === id ? { ...m, IsExplicit: false } : m);
                }
                return (prev ?? []).filter((m) => m.Id !== id);
            });
            onChanged?.();
        } catch (e) {
            reportError(e);
        } finally {
            setBusy(false);
        }
    }

    const visibleMedia = mediaKey === scopeKey ? media : null;
    const visibleLoadError = loadErrorKey === scopeKey ? loadError : null;
    const hasMedia = visibleMedia && visibleMedia.length > 0;
    const count = visibleMedia?.length ?? null;
    useEffect(() => { if (count != null) onCount?.(count); }, [count, onCount]);

    const lightbox = {
        context: 'library' as const,
        canEdit,
        canDelete,
        canRemoveFromContext: canEdit,
        onRemoveFromContext: canEdit ? unlink : undefined,
        canRemoveItem: (item: OwnerGalleryMedia) => item.IsExplicit && canEdit,
        showDeleteAction: (item: OwnerGalleryMedia) => item.IsExplicit && canEdit,
        removeActionLabel: t('remove'),
    };
    const addModal = addOpen && (
        <AddMediaModal
            target={{ kind: 'owner', ownerTable, ownerId, ownerFact, galleryPersonId }}
            treeId={treeId}
            targetName={targetName}
            targetPart={targetPart}
            targetDate={targetDate}
            relevantPersonIds={relevantPersonIds}
            onClose={() => setAddOpen(false)}
            onMediaChanged={() => { load(); onChanged?.(); }}
            onAdded={() => setAddOpen(false)}
        />
    );

    if (look === 'strip') {
        return (
            <div>
                {visibleLoadError != null && (
                    <InlineDataError className="mb-3" message={String(tc(errorToastKey(visibleLoadError)))} retryLabel={String(tc('retry'))} onRetry={load} />
                )}
                {hasMedia && (
                    <MediaGallery items={visibleMedia} treeId={treeId} strip={6} lightbox={lightbox}
                        getAlt={(item) => [item.Title ?? t('photo_alt'), ownerFact ? null : mediaFactLabel(t, item.OwnerFacts)].filter(Boolean).join(', ')} />
                )}
                {canEdit && (
                    <div className={hasMedia ? 'ledger-foot mt-3.5' : 'ledger-foot'}>
                        <AddRow label={t('add_button')} onClick={() => setAddOpen(true)} disabled={busy} />
                    </div>
                )}
                {addModal}
            </div>
        );
    }

    return (
        <div className="card" style={{ overflow: 'hidden' }}>
            {header && <div className="pt-[14px] px-4 pb-[6px]">{header}</div>}
            {visibleMedia === null && visibleLoadError == null ? (
                <div className="muted py-3 px-[14px] text-meta">{tc('loading')}</div>
            ) : (
                <>
                    {visibleLoadError != null && (
                        <InlineDataError
                            className="m-3"
                            message={String(tc(errorToastKey(visibleLoadError)))}
                            retryLabel={String(tc('retry'))}
                            onRetry={load}
                        />
                    )}
                    {!hasMedia && visibleLoadError == null && (
                        <div className="serif muted py-3 px-[14px] text-base" style={{ fontStyle: 'italic' }}>
                            {canEdit ? t('empty_edit') : t('empty')}
                        </div>
                    )}
                    {hasMedia && (
                        <MediaGallery
                            items={visibleMedia}
                            treeId={treeId}
                            lightbox={{
                                context: 'library',
                                canEdit,
                                canDelete,
                                canRemoveFromContext: canEdit,
                                onRemoveFromContext: canEdit ? unlink : undefined,
                                canRemoveItem: (item) => item.IsExplicit && canEdit,
                                showDeleteAction: (item) => item.IsExplicit && canEdit,
                                removeActionLabel: t('remove'),
                            }}
                            getAlt={(item) => [item.Title ?? t('photo_alt'), ownerFact ? null : mediaFactLabel(t, item.OwnerFacts)].filter(Boolean).join(', ')}
                            renderBadge={ownerFact ? undefined : (item) => {
                                const label = mediaFactLabel(t, item.OwnerFacts);
                                return label ? <Badge tone="neutral" className="absolute left-1 bottom-1 px-1.5 py-0.5">{label}</Badge> : null;
                            }}
                            renderAction={(item) => item.IsExplicit && canEdit ? (
                                <button
                                    type="button"
                                    onClick={() => unlink(item.Id)}
                                    disabled={busy}
                                    aria-label={t('remove')}
                                    title={t('remove')}
                                    className="group/remove absolute right-0 top-0 z-10 grid h-11 w-11 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-on-media disabled:cursor-not-allowed disabled:opacity-50 focus-ring"
                                >
                                    {/* Compact overlay (#651): a 22px scrim dot inside a 44px touch target. */}
                                    <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-media-scrim shadow-sm transition-colors group-hover/remove:bg-black/80 group-focus-visible/remove:bg-black/80">
                                        <X className="h-3 w-3" aria-hidden="true" />
                                    </span>
                                </button>
                            ) : null}
                        />
                    )}
                </>
            )}

            {canEdit && (
                <div className="py-3 px-[14px] gap-2" style={{ borderTop: hasMedia ? '1px solid var(--border-light)' : 'none', display: 'flex', flexWrap: 'wrap' }}>
                    <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} disabled={busy}>
                        <ImageUp className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('add_button')}
                    </Button>
                </div>
            )}

            {addModal}
        </div>
    );
}
