'use client';

import { useTranslations } from 'next-intl';
import type { PersonGalleryMedia } from '@/lib/db/schema';
import MediaGallery from '@/app/components/media/MediaGallery';
import { Badge } from '@/app/components/ui';
import { mediaFactLabel } from '@/app/components/media/mediaFactLabel';
import { Star } from '@/lib/icons';

export function PersonGalleryCard({ media, personId, treeId, canEdit, canDelete, onPrimaryChanged }: { media: PersonGalleryMedia[]; personId: number; treeId: number | null; canEdit: boolean; canDelete: boolean; onPrimaryChanged: () => void }) {
    const t = useTranslations('personDetail');
    const ft = useTranslations('faceTags');
    const tm = useTranslations('ownerMedia');

    // The locked board's empty Media section is just its "Add media" row (the
    // page renders it); a reader sees the section only when there is media.
    if (media.length === 0) return null;

    // One row of six squares, the sixth "+N" (locked person board).
    return (
        <MediaGallery
                strip={6}
                items={media}
                treeId={treeId}
                lightbox={{ context: 'person', galleryPersonId: personId, canEdit, canDelete, onPrimaryChanged, onTagsChanged: onPrimaryChanged, onDeleted: onPrimaryChanged }}
                getAlt={(item) => [
                    item.Title ?? t('photo_alt'),
                    item.IsPersonPrimary ? t('primary_badge') : null,
                    item.IsTaggedHere && !item.IsOwned ? ft('tagged_badge') : null,
                    mediaFactLabel(tm, item.OwnerFacts),
                ].filter(Boolean).join(', ')}
                renderBadge={(item) => (
                    <>
                        {/* A star, not a word: the tile's alt text still says "Primary". */}
                        {item.IsPersonPrimary && (
                            <span className="absolute left-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full" title={t('primary_badge')} aria-hidden="true"
                                style={{ background: 'var(--color-media-scrim)', color: 'var(--color-on-media)' }}>
                                <Star className="h-3 w-3" fill="currentColor" />
                            </span>
                        )}
                        {item.IsTaggedHere && !item.IsOwned && <Badge className="absolute right-1 top-1" style={{ padding: '2px 6px', background: 'var(--color-media-scrim)', color: 'var(--color-on-media)' }}>{ft('tagged_badge')}</Badge>}
                    </>
                )}
            />
    );
}
