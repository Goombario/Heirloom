'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTheme } from '@/app/components/ThemeProvider';
import { getMapStyleUrl, collapseCompactAttribution, configureMapLibreWorker } from '@/lib/geo/map-style';
import { pinSvgHtml } from './map-pin';
import 'maplibre-gl/dist/maplibre-gl.css';

export const HEADER_PREVIEW_ZOOM = 5; // regional view (country/region context)

interface StaticMapPreviewProps {
  lat: number;
  lng: number;
  label: string;
  zoom?: number;
  onClick?: () => void;
  className?: string;
  /** Stretch to fill the parent's height instead of a fixed 4:3 box. */
  fill?: boolean;
}

export default function StaticMapPreview({
  lat,
  lng,
  label,
  zoom = HEADER_PREVIEW_ZOOM,
  onClick,
  className,
  fill,
}: StaticMapPreviewProps) {
  const t = useTranslations('common');
  const { resolvedTheme } = useTheme();
  const elRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let map: import('maplibre-gl').Map | null = null;
    let cancelled = false;
    if (!elRef.current) return;

    (async () => {
      try {
        const maplibregl = await import('maplibre-gl');
        if (cancelled || !elRef.current) return;
        configureMapLibreWorker(maplibregl);
        map = new maplibregl.Map({
          container: elRef.current,
          style: getMapStyleUrl(resolvedTheme),
          center: [lng, lat],
          zoom,
          interactive: false,
          attributionControl: { compact: true },
        });
        map.on('error', () => { if (!cancelled) setFailed(true); });
        // Some basemap styles (OpenFreeMap) reference sprite icons like "circle-11"
        // that aren't in the shipped sprite, spamming a console warning on every
        // load. Register a 1×1 transparent placeholder for any missing image so the
        // warning is silenced without altering the map's appearance.
        map.setMissingStyleImageResolver((id) => {
            if (map && !map.hasImage(id)) {
                map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
            }
        });
        collapseCompactAttribution(map);

        // Pin tip (bottom-center) anchored on the exact point — native centering
        // replaces the old 3×3 tile-grid translate trick.
        const pinEl = document.createElement('div');
        // eslint-disable-next-line no-restricted-syntax -- MapLibre Marker requires a detached DOM element; innerHTML injects a static, controlled SVG (no user input).
        pinEl.innerHTML = pinSvgHtml();
        new maplibregl.Marker({ element: pinEl, anchor: 'bottom' })
          .setLngLat([lng, lat])
          .addTo(map);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
      map = null;
    };
  }, [lat, lng, zoom, resolvedTheme]);

  const boxStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    ...(fill ? { flex: '1 1 0', minHeight: 120 } : { aspectRatio: '4 / 3' }),
    borderRadius: 8,
    overflow: 'hidden',
    border: '1px solid var(--color-glass-border)',
    padding: 0,
    display: 'block',
    background: 'rgba(255,255,255,0.04)',
  };
  // "View journey" is its own button laid over the map, a sibling of the map
  // rather than its parent: MapLibre mounts the credits ⓘ (a button) inside the
  // map, and a button inside a button is invalid and ambiguous to a screen reader
  // (axe nested-interactive, #740). The credits sit above this overlay, so a click
  // on them expands the credits and never opens the journey.
  const journeyButton = onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('view_journey')}
      title={label}
      className="hero-journey-btn focus-ring-inset"
      style={{ position: 'absolute', inset: 0, zIndex: 1, width: '100%', height: '100%', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
    >
      <span className="hero-journey-hint">{t('view_journey')}</span>
    </button>
  ) : null;

  if (failed) {
    return (
      <div
        title={onClick ? undefined : label}
        className={className}
        style={{ ...boxStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <span className="text-text-muted text-meta">{t('map_unavailable')}</span>
        {journeyButton}
      </div>
    );
  }

  return (
    <div title={onClick ? undefined : label} className={className} style={boxStyle}>
      {/* pointerEvents:none so clicks pass through the non-interactive map to the
          journey button; the credits control re-enables its own pointer events. */}
      <div ref={elRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      {journeyButton}
    </div>
  );
}
