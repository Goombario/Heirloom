'use client';

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import MediaImg from '@/app/components/MediaImg';
import { DocumentPageCount } from '@/app/components/media/DocumentThumb';
import MediaLightbox from '@/app/components/lightbox/MediaLightbox';
import { SkeletonGrid } from '@/app/components/SkeletonLoader';
import { useLoadPhase } from '@/app/components/useLoadPhase';
import type { MediaWithPerson } from '@/lib/db/schema';
import { AlertTriangle, Check } from '@/lib/icons';
import { formatMediaBytes } from '@/lib/media/format-bytes';
import { sortableYear } from '@/lib/date-utils';
import { isPdfMedia } from '@/lib/media/allowed-extensions';
import { PHOTO_GRID_COLUMNS_CLASS, PHOTO_GRID_GAP_PX } from './photo-grid-layout';

interface PhotosGridProps {
  photos: MediaWithPerson[];
  loading: boolean;
  treeId: number | null;
  canEdit: boolean;
  canDelete: boolean;
  onPrimaryChanged: () => void;
  /** When true, tile activation selects instead of opening the lightbox. */
  selectionMode?: boolean;
  /** Disable selection mutations while an in-flight delete settles. */
  selectionDisabled?: boolean;
  selectedIds?: ReadonlySet<number>;
  failedIds?: ReadonlySet<number>;
  onToggleSelection?: (id: number) => void;
  /** Show compressed file-size badges for the active Largest-first order. */
  showFileSizes?: boolean;
  /** Rendered when `photos` is empty: the page picks the empty or filtered variant (#696). */
  emptyState: ReactNode;
  /** The phone grid (#1119): three square columns edge to edge with 2px gaps, no
   *  captions, and a tick circle top right while selecting. */
  phone?: boolean;
}

/**
 * Photos tab — responsive grid of media thumbnails opening the shared
 * `MediaLightbox`. Behavior is unchanged from the original `PhotosView`.
 */
export default function PhotosGrid({
  photos,
  loading,
  treeId,
  canEdit,
  canDelete,
  onPrimaryChanged,
  selectionMode = false,
  selectionDisabled = false,
  selectedIds = new Set(),
  failedIds = new Set(),
  onToggleSelection,
  showFileSizes = false,
  emptyState,
  phone = false,
}: PhotosGridProps) {
  const t = useTranslations('library');
  const tDocuments = useTranslations('documents');
  const locale = useLocale();
  // The lightbox keeps the list it opened on, pinned by id (#802, MD-1). Tagging
  // a face refreshes the grid, and under the Untagged filter the photo would
  // otherwise leave the list and close the lightbox mid-way through a group photo.
  const [lightbox, setLightbox] = useState<{ items: MediaWithPerson[]; id: number } | null>(null);
  const lightboxItems = useMemo(() => {
    if (!lightbox) return [];
    const fresh = new Map(photos.map((p) => [p.Id, p]));
    return lightbox.items.map((item) => fresh.get(item.Id) ?? item);
  }, [lightbox, photos]);
  const lightboxIndex = lightbox ? lightboxItems.findIndex((item) => item.Id === lightbox.id) : -1;
  const [mediaFailures, setMediaFailures] = useState<ReadonlySet<number>>(new Set());
  const retryByMediaId = useRef(new Map<number, () => void>());
  const phase = useLoadPhase(loading);

  const handleMediaFailure = useCallback((mediaId: number, retry: () => void) => {
    retryByMediaId.current.set(mediaId, retry);
    setMediaFailures((current) => {
      if (current.has(mediaId)) return current;
      return new Set([...current, mediaId]);
    });
  }, []);

  const retryMedia = useCallback((mediaId: number) => {
    const retry = retryByMediaId.current.get(mediaId);
    retryByMediaId.current.delete(mediaId);
    setMediaFailures((current) => {
      if (!current.has(mediaId)) return current;
      const next = new Set(current);
      next.delete(mediaId);
      return next;
    });
    retry?.();
  }, []);

  const lightboxNode = lightboxIndex >= 0 && (
    <MediaLightbox
      items={lightboxItems}
      index={lightboxIndex}
      treeId={treeId}
      canEdit={canEdit}
      canDelete={canDelete}
      context="library"
      onClose={() => setLightbox(null)}
      onChangeIndex={(i) => setLightbox((lb) => (lb && lb.items[i] ? { ...lb, id: lb.items[i].Id } : lb))}
      onPrimaryChanged={() => { onPrimaryChanged(); }}
      onTagsChanged={() => { onPrimaryChanged(); }}
      onDeleted={(deletedId) => {
        // The lightbox has already stepped to a neighbour; drop the deleted photo
        // from the pinned list, and if it was still showing, show its successor.
        setLightbox((lb) => {
          if (!lb || deletedId == null) return lb;
          const at = lb.items.findIndex((item) => item.Id === deletedId);
          const items = lb.items.filter((item) => item.Id !== deletedId);
          if (items.length === 0) return null;
          const id = lb.id === deletedId ? items[Math.min(at, items.length - 1)].Id : lb.id;
          return { items, id };
        });
        onPrimaryChanged();
      }}
    />
  );

  if (phase === 'loading') {
    return phone
      ? <SkeletonGrid items={12} columns="repeat(3, 1fr)" gap={2} />
      : <SkeletonGrid items={12} columns={null} gap={PHOTO_GRID_GAP_PX} className={PHOTO_GRID_COLUMNS_CLASS} />;
  }
  if (phase === 'pending') {
    return null;
  }
  if (photos.length === 0) {
    return <>{emptyState}{lightboxNode}</>;
  }

  return (
    <>
      <div className={phone ? 'grid grid-cols-3 gap-0.5' : `grid gap-x-3.5 gap-y-[18px] ${PHOTO_GRID_COLUMNS_CLASS}`}>
        {photos.map((m) => {
          // FileSize is zero for placeholder rows; those rows intentionally have no size badge.
          const title = m.Title ?? t('photo_alt');
          const sizeLabel = showFileSizes && m.FileSize != null && m.FileSize > 0
            ? formatMediaBytes(m.FileSize, locale)
            : null;
          const tileLabel = selectionMode
            ? t(selectedIds.has(m.Id) ? 'photo_deselect' : 'photo_select', { title })
            : title;
          const year = phone ? null : sortableYear(m.Date);
          const isDocument = isPdfMedia(m);
          // A document names no faces; its people are the ones it is linked to (#510).
          const people = isDocument ? m.LinkedPersonCount ?? 0 : m.TaggedPersonNames?.length ?? 0;
          return (
          <div key={m.Id}>
          <div className="relative min-h-11">
          <button
            type="button"
            disabled={selectionMode && selectionDisabled}
            onClick={() => {
              if (selectionMode) {
                onToggleSelection?.(m.Id);
                return;
              }
              setLightbox({ items: photos, id: m.Id });
            }}
            aria-pressed={selectionMode ? selectedIds.has(m.Id) : undefined}
            aria-label={sizeLabel ? `${tileLabel}. ${t('photo_size_label', { size: sizeLabel })}` : tileLabel}
            aria-describedby={selectionMode && failedIds.has(m.Id) ? `photo-failure-status-${m.Id}` : mediaFailures.has(m.Id) ? `photo-media-failure-status-${m.Id}` : undefined}
            title={failedIds.has(m.Id) ? t('photo_delete_failed') : undefined}
            className={phone
              ? 'relative block min-h-11 w-full focus-ring-inset'
              : `relative min-h-11 w-full rounded-[8px] focus-ring ${
                selectionMode && selectedIds.has(m.Id)
                  ? 'border-2 border-primary ring-2 ring-primary'
                  : 'border border-transparent'
              }`}
            style={{
              aspectRatio: '1',
              overflow: 'hidden',
              background: 'var(--card-alt)',
              cursor: 'pointer',
              padding: 0,
              fontFamily: 'inherit',
            }}
          >
            <MediaImg
              mediaId={m.Id}
              contentType={m.ContentType}
              treeId={treeId}
              width={256}
              alt={title}
              onFailure={(retry) => handleMediaFailure(m.Id, retry)}
              className={phone ? 'transition-transform motion-reduce:transition-none' : undefined}
              style={{
                width: '100%', height: '100%', objectFit: 'cover',
                ...(phone && selectionMode && selectedIds.has(m.Id) ? { transform: 'scale(0.88)', borderRadius: 6 } : {}),
              }}
            />
            {sizeLabel && !failedIds.has(m.Id) && (
              <span
                aria-hidden="true"
                className="absolute right-2 top-2 rounded-full bg-[color:var(--color-media-scrim)] px-2 py-1 tabular-nums text-[10px] font-semibold text-on-media shadow-sm"
              >
                {sizeLabel}
              </span>
            )}
            {phone && selectionMode && (
              <span
                data-testid={selectedIds.has(m.Id) ? 'selection-check' : undefined}
                aria-hidden="true"
                className={`absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border-2 text-white ${
                  selectedIds.has(m.Id) ? 'border-primary bg-primary' : 'border-white bg-black/25'
                }`}
              >
                {selectedIds.has(m.Id) && <Check size={14} strokeWidth={3} />}
              </span>
            )}
            {!phone && selectionMode && selectedIds.has(m.Id) && (
              <span
                data-testid="selection-check"
                aria-hidden="true"
                className="absolute left-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white shadow-sm"
              >
                <Check size={17} strokeWidth={3} />
              </span>
            )}
            {selectionMode && failedIds.has(m.Id) && (
              <>
                <span
                  id={`photo-failure-status-${m.Id}`}
                  className="sr-only"
                >
                  {t('photo_delete_failed')}
                </span>
                <span
                  data-testid={`photo-failure-${m.Id}`}
                  aria-hidden="true"
                  className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-error text-on-media shadow-sm"
                >
                  <AlertTriangle size={16} />
                </span>
              </>
            )}
          </button>
          {/* Clicks pass through to the tile, so a photo that won't load can
              still open in the lightbox or be selected and deleted (#948);
              only Retry takes them. Inset so the selection ring shows. */}
          {mediaFailures.has(m.Id) && (
            <div
              data-testid={`photo-media-failure-${m.Id}`}
              className="pointer-events-none absolute inset-[3px] flex flex-col items-center justify-center gap-2 rounded-[6px] bg-[color:var(--card-alt)] px-2 text-center text-xs text-text-muted"
            >
              {selectionMode && selectedIds.has(m.Id) && (
                <span
                  data-testid="failure-selection-check"
                  aria-hidden="true"
                  className="absolute left-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white shadow-sm"
                >
                  <Check size={17} strokeWidth={3} />
                </span>
              )}
              <span id={`photo-media-failure-status-${m.Id}`} className="flex items-center gap-1.5">
                <AlertTriangle size={15} aria-hidden="true" />
                {t('media_load_failed')}
              </span>
              <button
                type="button"
                className="pointer-events-auto min-h-11 rounded-[6px] border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-1.5 font-medium text-text-primary focus-ring"
                onClick={(event) => { event.stopPropagation(); retryMedia(m.Id); }}
              >
                {t('media_retry')}
              </button>
            </div>
          )}
          </div>
          {/* Desktop captions sit under the photo, so the photo is the only boxed thing (#1155). */}
          {!phone && (
            <div className="mt-1.5 px-px" data-testid={`photo-caption-${m.Id}`}>
              {m.Title && <div className="line-clamp-2 text-sm leading-snug text-text">{m.Title}</div>}
              <div className="mt-0.5 text-xs tabular-nums text-text-muted">
                {year != null && <>{year} · </>}
                {isDocument ? (
                  <>
                    {tDocuments('pdf')}
                    <DocumentPageCount mediaId={m.Id} treeId={treeId} prefix=" · " />
                    {people > 0
                      ? <> · {t('photo_people', { count: people })}</>
                      : (m.LinkCount ?? 0) === 0 && <> · <span className="text-evidence">{tDocuments('not_linked')}</span></>}
                  </>
                ) : people > 0
                  ? t('photo_people', { count: people })
                  : <span className="text-evidence">{t('photo_filter_untagged')}</span>}
              </div>
            </div>
          )}
          </div>
          );
        })}
      </div>

      {lightboxNode}
    </>
  );
}
