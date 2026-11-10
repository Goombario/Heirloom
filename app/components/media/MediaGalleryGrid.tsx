'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { Media, PersonGalleryMedia } from '@/lib/db/schema';
import MediaImg from '@/app/components/MediaImg';

export type MediaGalleryItem = Media | PersonGalleryMedia;

export interface MediaGalleryGridProps<T extends MediaGalleryItem = MediaGalleryItem> {
    items: T[];
    treeId: number | null;
    onOpen: (mediaId: number) => void;
    renderBadge?: (item: T) => ReactNode;
    renderAction?: (item: T) => ReactNode;
    getAlt?: (item: T) => string;
}

/** The presentation-only, wrapping thumbnail grid shared by owner surfaces. */
export function MediaGalleryGrid<T extends MediaGalleryItem>({
    items, treeId, onOpen, renderBadge, renderAction, getAlt,
}: MediaGalleryGridProps<T>) {
    const t = useTranslations('ownerMedia');

    return (
        <div
            data-testid="media-gallery-grid"
            className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2 p-3"
        >
            {items.map((item) => {
                const alt = getAlt?.(item) ?? item.Title ?? t('photo_alt');
                return (
                    <figure key={item.Id} className="relative m-0 min-w-0">
                        <button
                            type="button"
                            onClick={() => onOpen(item.Id)}
                            aria-label={alt}
                            title={item.Title ?? undefined}
                            className="group relative block aspect-square min-h-11 min-w-11 w-full cursor-pointer overflow-hidden rounded-btn border border-border bg-card-alt p-0 font-sans transition-colors hover:border-text-muted focus-ring"
                        >
                            <MediaImg
                                mediaId={item.Id}
                                contentType={item.ContentType}
                                treeId={treeId}
                                width={256}
                                alt={alt}
                                loading="lazy"
                                className="h-full w-full object-cover transition-transform duration-(--dur-base) group-hover:scale-[1.04] motion-reduce:group-hover:scale-100"
                            />
                            {renderBadge?.(item)}
                        </button>
                        {renderAction?.(item)}
                        {item.Title && (
                            <figcaption className="mt-1.5 truncate text-center text-xs text-text-muted">
                                {item.Title}
                            </figcaption>
                        )}
                    </figure>
                );
            })}
        </div>
    );
}

export default MediaGalleryGrid;
