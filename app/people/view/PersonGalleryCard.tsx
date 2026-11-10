'use client';

import { useTranslations } from 'next-intl';
import type { PersonGalleryMedia } from '@/lib/db/schema';
import MediaGallery from '@/app/components/media/MediaGallery';
import { Badge, Button } from '@/app/components/ui';
import { Plus } from '@/lib/icons';
import { mediaFactLabel } from '@/app/components/media/mediaFactLabel';

export function PersonGalleryCard({ media, personId, treeId, canEdit, canDelete, onPrimaryChanged, onAddPhoto }: { media: PersonGalleryMedia[]; personId: number; treeId: number | null; canEdit: boolean; canDelete: boolean; onPrimaryChanged: () => void; /** Opens the upload modal — the empty state's call to action (#437). */ onAddPhoto?: () => void }) {
    const t = useTranslations('personDetail');
    const ft = useTranslations('faceTags');
    const tm = useTranslations('ownerMedia');

    if (media.length === 0) {
        // A bare line of muted text in the page flow read as a broken section next to
        // every other panel's proper empty state (#437). Same card + centred shape as
        // the timeline and relationships ones, and it carries the upload affordance so
        // the empty state is also the way out of it.
        return (
            <div className="card card-pad p-9 text-center">
                <div className="serif text-lg font-semibold mb-1.5">{t('no_photos_title')}</div>
                <p className="muted text-sm mb-0">{t('no_photos_desc')}</p>
                {canEdit && onAddPhoto && (
                    <Button variant="outline" size="sm" icon={<Plus className="w-4 h-4" aria-hidden="true" />} className="mt-3.5" onClick={onAddPhoto}>
                        {t('add_picture')}
                    </Button>
                )}
            </div>
        );
    }

    // The same grid at every count: #765's strip of 80px thumbnails left one to
    // three photos looking lost (#780). px-1 + the grid's p-3 meets the
    // DetailSection header's 16px edge.
    return (
        <div className="card px-1 pb-1">
            <MediaGallery
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
                        {item.IsPersonPrimary && <Badge tone="neutral" className="absolute left-1 top-1" style={{ padding: '2px 6px' }}>{t('primary_badge')}</Badge>}
                        {item.IsTaggedHere && !item.IsOwned && <Badge className="absolute right-1 top-1" style={{ padding: '2px 6px', background: 'var(--color-media-scrim)', color: 'var(--color-on-media)' }}>{ft('tagged_badge')}</Badge>}
                    </>
                )}
            />
        </div>
    );
}
