'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import MediaImg from '@/app/components/MediaImg';
import MediaLightbox from '@/app/components/lightbox/MediaLightbox';
import type { Media } from '@/lib/db/schema';

const MAX_THUMBS = 4;
const THUMB = 55;

/**
 * Read-only inline strip of an event's attached photos, shown in a timeline row's
 * `extra` slot. Up to four 44px thumbnails + a "+N" overflow chip; clicking opens
 * the shared lightbox. Renders nothing when the event has no media. Attaching /
 * detaching happens in the event editor's OwnerMediaCard, not here.
 */
export default function EventMediaStrip({ media, treeId, variant = 'strip' }: {
    media: Media[];
    treeId: number | null;
    /**
     * `ledger`: the v1.1 timeline's right column (locked person board): up to three
     * 52px squares, the third darkened with "+N" when there are more.
     */
    variant?: 'strip' | 'ledger';
}) {
    const t = useTranslations('ownerMedia');
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

    if (!media || media.length === 0) return null;

    const lightbox = lightboxIndex !== null && (
        <MediaLightbox
            items={media}
            index={lightboxIndex}
            treeId={treeId}
            canEdit={false}
            canDelete={false}
            context="library"
            onClose={() => setLightboxIndex(null)}
            onChangeIndex={setLightboxIndex}
        />
    );

    if (variant === 'ledger') {
        const many = media.length > 3;
        const tiles = many ? media.slice(0, 3) : media;
        return (
            <>
                {tiles.map((m, i) => {
                    const more = many && i === 2 ? media.length - 2 : 0;
                    return (
                        <button key={m.Id} type="button" onClick={() => setLightboxIndex(i)} title={m.Title ?? undefined}
                            aria-label={more ? t('more_count', { count: more }) : m.Title ?? t('photo_alt')}
                            className="ledger-thumb focus-ring">
                            <MediaImg mediaId={m.Id} contentType={m.ContentType} treeId={treeId} width={256} alt="" loading="lazy"
                                className="object-cover" style={{ width: '100%', height: '100%' }} />
                            {more > 0 && <span className="ledger-thumb__more" aria-hidden="true">+{more}</span>}
                        </button>
                    );
                })}
                {lightbox}
            </>
        );
    }

    const shown = media.slice(0, MAX_THUMBS);
    const overflow = media.length - shown.length;

    return (
        <div className="mt-1.5">
            <div className="flex gap-1.5 flex-wrap items-center">
                {shown.map((m, i) => (
                    <button
                        key={m.Id}
                        type="button"
                        onClick={() => setLightboxIndex(i)}
                        title={m.Title ?? undefined}
                        aria-label={m.Title ?? t('photo_alt')}
                        style={{
                            width: THUMB, height: THUMB, background: 'var(--card-alt)',
                            padding: 0, flexShrink: 0,
                        }}
                        className="rounded-[6px] overflow-hidden border border-[color:var(--border)] cursor-pointer focus-ring"
                    >
                        <MediaImg
                            mediaId={m.Id}
                            contentType={m.ContentType}
                            treeId={treeId}
                            width={256}
                            alt={m.Title ?? t('photo_alt')}
                            loading="lazy"
                            className="object-cover"
                            style={{ width: '100%', height: '100%' }}
                        />
                    </button>
                ))}
                {overflow > 0 && (
                    <button
                        type="button"
                        onClick={() => setLightboxIndex(MAX_THUMBS)}
                        style={{
                            width: THUMB, height: THUMB, flexShrink: 0,
                            background: 'var(--card-alt)',
                            color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums',
                        }}
                        className="rounded-[6px] border border-[color:var(--border)] text-meta cursor-pointer focus-ring"
                        aria-label={t('more_count', { count: overflow })}
                    >
                        +{overflow}
                    </button>
                )}
            </div>

            {lightbox}
        </div>
    );
}
