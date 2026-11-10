'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, SyntheticEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useMediaUrl } from '@/lib/media/useMediaUrl';
import { AlertTriangle, Loader2 } from '@/lib/icons';
import { isPdfMedia } from '@/lib/media/allowed-extensions';
import DocumentThumb from '@/app/components/media/DocumentThumb';

interface MediaImgProps {
  mediaId: number;
  treeId?: number | null;
  width?: number;
  alt: string;
  className?: string;
  style?: CSSProperties;
  loading?: 'lazy' | 'eager';
  /** Called after both the local read and the image decode have failed. */
  onFailure?: (retry: () => void) => void;
  /** The row's content type: a PDF document shows its first page instead (#510). */
  contentType?: string | null;
}

/**
 * Renders a media image through useMediaUrl so it works in both the hosted
 * (URL) and local (blob) builds. While a local blob resolves, a neutral
 * placeholder keeps the layout box. In http mode src is always set immediately.
 * A PDF document has no image, so it renders as a DocumentThumb.
 */
export default function MediaImg(props: MediaImgProps) {
  if (isPdfMedia({ ContentType: props.contentType })) {
    const { mediaId, treeId, width, alt, className, style } = props;
    return <DocumentThumb mediaId={mediaId} treeId={treeId} width={width} alt={alt} className={className} style={style} />;
  }
  return <ImageMediaImg {...props} />;
}

function ImageMediaImg({
  mediaId, treeId, width, alt, className, style, loading = 'lazy', onFailure,
}: MediaImgProps) {
  const t = useTranslations('library');
  const {
    src,
    loading: mediaLoading,
    error: mediaError,
    retry,
    fallback,
    usingFullFallback,
    reloadKey,
  } = useMediaUrl(mediaId, { treeId, width });
  const [imageState, setImageState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [imageStateKey, setImageStateKey] = useState<string | null>(null);
  const failureNotifiedFor = useRef<string | null>(null);
  const imageKey = src ? `${src}:${reloadKey}` : null;
  const attemptKey = `${mediaId}:${treeId ?? 'null'}:${width ?? 'full'}:${reloadKey}:${usingFullFallback ? 'fallback' : 'primary'}`;

  // A missing/corrupt thumbnail should not strand a usable original blob. The
  // hook changes the cache key to the full variant; a second failure is final.
  useEffect(() => {
    if (!mediaError) return;
    if (!usingFullFallback) fallback();
  }, [fallback, mediaError, usingFullFallback]);

  const fail = useCallback(() => {
    setImageState('error');
    setImageStateKey(imageKey);
    onFailure?.(retry);
  }, [imageKey, onFailure, retry]);

  useEffect(() => {
    if (!mediaError || !usingFullFallback || failureNotifiedFor.current === attemptKey) return;
    failureNotifiedFor.current = attemptKey;
    onFailure?.(retry);
  }, [attemptKey, mediaError, onFailure, retry, usingFullFallback]);

  const handleLoad = useCallback(async (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    try {
      if (typeof image.decode === 'function') await image.decode();
      setImageState('ready');
      setImageStateKey(imageKey);
    } catch {
      if (!usingFullFallback) {
        fallback();
        return;
      }
      fail();
    }
  }, [fail, fallback, imageKey, usingFullFallback]);

  const handleError = useCallback(() => {
    if (!usingFullFallback) {
      fallback();
      return;
    }
    fail();
  }, [fail, fallback, usingFullFallback]);

  if ((mediaError && usingFullFallback) || (imageState === 'error' && imageStateKey === imageKey)) {
    return (
      <div
        className={`${className ?? ''} flex items-center justify-center gap-1.5 bg-[color:var(--card-alt)] px-2 text-center text-xs text-text-muted`}
        style={style}
        role="img"
        aria-label={t('media_load_failed')}
      >
        <AlertTriangle size={15} aria-hidden="true" />
        <span>{t('media_load_failed')}</span>
      </div>
    );
  }

  if (!src) {
    return (
      <div className={`${className ?? ''} relative flex items-center justify-center bg-[color:var(--card-alt)]`} style={style} aria-label={t('media_loading')}>
        <Loader2 size={18} className="animate-spin text-text-muted" aria-hidden="true" />
      </div>
    );
  }

  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={`${src}:${reloadKey}`}
      src={src}
      alt={alt}
      className={className}
      style={style}
      loading={loading}
      decoding="async"
      onLoad={handleLoad}
      onError={handleError}
    />
  );

  if (imageState === 'ready' && !mediaLoading) return image;

  return (
    <div className="relative h-full w-full" style={style} aria-label={t('media_loading')}>
      {image}
      <span className="absolute inset-0 flex items-center justify-center bg-[color:var(--card-alt)]/75" aria-hidden="true">
        <Loader2 size={18} className="animate-spin text-text-muted" />
      </span>
    </div>
  );
}
