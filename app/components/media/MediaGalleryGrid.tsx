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
    /**
     * The v1.1 person page's strip (locked board): one row of this many squares,
     * edge to edge with no captions, the last darkened with "+N" when more remain.
     */
    strip?: number;
}

/** The presentation-only, wrapping thumbnail grid shared by owner surfaces. */
export function MediaGalleryGrid<T extends MediaGalleryItem>({
    items, treeId, onOpen, renderBadge, renderAction, getAlt, strip,
}: MediaGalleryGridProps<T>) {
    const t = useTranslations('ownerMedia');

    if (strip) {
        const many = items.length > strip;
        const shown = many ? items.slice(0, strip) : items;
        return (
            <div data-testid="media-gallery-grid" className="media-strip" style={{ gridTemplateColumns: `repeat(${strip}, minmax(0, 1fr))` }}>
                {shown.map((item, i) => {
                    const more = many && i === strip - 1 ? items.length - (strip - 1) : 0;
                    const alt = getAlt?.(item) ?? item.Title ?? t('photo_alt');
                    return (
                        <button key={item.Id} type="button" onClick={() => onOpen(item.Id)} title={item.Title ?? undefined}
                            aria-label={more ? t('more_count', { count: more }) : alt}
                            className="media-strip__tile focus-ring">
                            <MediaImg mediaId={item.Id} contentType={item.ContentType} treeId={treeId} width={256} alt={more ? '' : alt} loading="lazy"
                                className="h-full w-full object-cover" />
                            {!more && renderBadge?.(item)}
                            {more > 0 && <span className="media-strip__more" aria-hidden="true">+{more}</span>}
                        </button>
                    );
                })}
            </div>
        );
    }

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
