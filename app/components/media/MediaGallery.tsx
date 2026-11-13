'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { Media, PersonGalleryMedia } from '@/lib/db/schema';
import MediaLightbox, { type MediaLightboxProps } from '@/app/components/lightbox/MediaLightbox';
import MediaGalleryGrid, { type MediaGalleryItem } from './MediaGalleryGrid';

interface MediaGalleryLightbox<T extends MediaGalleryItem = MediaGalleryItem>
    extends Pick<MediaLightboxProps, 'context' | 'canEdit' | 'canDelete' | 'canRemoveFromContext' | 'galleryPersonId' | 'onPrimaryChanged' | 'onTagsChanged' | 'onDeleted' | 'removeActionLabel'> {
    /** Context-specific unlink callback. MediaGallery only passes it for the active item when allowed. */
    onRemoveFromContext?: (mediaId: number) => Promise<void> | void;
    canRemoveItem?: (item: T) => boolean;
    showDeleteAction?: (item: T) => boolean;
}

export interface MediaGalleryProps<T extends MediaGalleryItem = MediaGalleryItem> {
    items: T[];
    treeId: number | null;
    lightbox: MediaGalleryLightbox<T>;
    renderBadge?: (item: T) => ReactNode;
    renderAction?: (item: T) => ReactNode;
    getAlt?: (item: T) => string;
    /** One row of this many squares (the v1.1 person page): see `MediaGalleryGrid`. */
    strip?: number;
}

/** Shared wrapping gallery with lightbox selection pinned to a media id. */
export function MediaGallery<T extends MediaGalleryItem>({
    items, treeId, lightbox, renderBadge, renderAction, getAlt, strip,
}: MediaGalleryProps<T>) {
    const [lightboxId, setLightboxId] = useState<number | null>(null);
    const lightboxIndex = lightboxId == null ? -1 : items.findIndex((item) => item.Id === lightboxId);
    const activeItem = lightboxIndex >= 0 ? items[lightboxIndex] : undefined;

    // An item removed by a refresh must clear the selection, otherwise a later
    // refresh that reintroduces the same id would unexpectedly reopen the modal.
    useEffect(() => {
        if (lightboxId != null && !items.some((item) => item.Id === lightboxId)) {
            // The collection is an external refresh; clear the stale selection
            // after it disappears so a later restore cannot reopen the modal.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setLightboxId(null);
        }
    }, [items, lightboxId]);

    return (
        <>
            <MediaGalleryGrid
                items={items}
                treeId={treeId}
                onOpen={setLightboxId}
                renderBadge={renderBadge}
                renderAction={renderAction}
                getAlt={getAlt}
                strip={strip}
            />
            {activeItem && (
                <MediaLightbox
                    items={items as Array<Media | PersonGalleryMedia>}
                    index={lightboxIndex}
                    treeId={treeId}
                    canEdit={lightbox.canEdit}
                    canDelete={lightbox.canDelete}
                    canRemoveFromContext={lightbox.canRemoveFromContext}
                    context={lightbox.context}
                    galleryPersonId={lightbox.galleryPersonId}
                    onClose={() => setLightboxId(null)}
                    onChangeIndex={(index) => setLightboxId(items[index]?.Id ?? null)}
                    onPrimaryChanged={lightbox.onPrimaryChanged}
                    onTagsChanged={lightbox.onTagsChanged}
                    onDeleted={lightbox.onDeleted}
                    onRemoveFromContext={
                        lightbox.onRemoveFromContext && lightbox.canRemoveItem?.(activeItem)
                            ? lightbox.onRemoveFromContext
                            : undefined
                    }
                    removeActionLabel={lightbox.removeActionLabel}
                    showDeleteAction={lightbox.showDeleteAction ? lightbox.showDeleteAction(activeItem) : true}
                />
            )}
        </>
    );
}

export default MediaGallery;
