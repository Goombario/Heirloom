'use client';

import { useEffect, useRef, useState } from 'react';
import { escapeHtml } from '@/lib/validation';
import { useTheme } from '@/app/components/ThemeProvider';
import { getMapStyleUrl, collapseCompactAttribution, configureMapLibreWorker } from '@/lib/geo/map-style';
import { numberedPinSvgHtml } from './map-pin';
import type { JourneyStop } from './LocationJourneyModal';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * The journey map: numbered pins joined by a dashed line, fitted to the stops. Shared
 * by the desktop journey dialog and the phone's Journey page (#1052). `focusStop`
 * flies to a stop and opens its popup.
 */
export function useJourneyMap(stops: JourneyStop[]) {
  const { resolvedTheme } = useTheme();
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('maplibre-gl').Map | null>(null);
  const markerRefs = useRef<import('maplibre-gl').Marker[]>([]);
  const [failed, setFailed] = useState(false);
  // Callers rebuild the stops on every render; the map only rebuilds when they change.
  const key = JSON.stringify(stops);
  const stopsRef = useRef(stops);
  useEffect(() => { stopsRef.current = stops; });

  useEffect(() => {
    const stops = stopsRef.current;
    let cancelled = false;
    if (stops.length === 0 || !elRef.current) return;
    (async () => {
      try {
        const maplibregl = await import('maplibre-gl');
        if (cancelled || !elRef.current) return;
        configureMapLibreWorker(maplibregl);
        const map = new maplibregl.Map({
          container: elRef.current,
          style: getMapStyleUrl(resolvedTheme),
          center: [stops[0].lng, stops[0].lat],
          zoom: stops.length === 1 ? 9 : 5, // single stop: framed by the constructor; many: fitBounds below
          attributionControl: { compact: true },
        });
        mapRef.current = map;
        map.on('error', () => { if (!cancelled) setFailed(true); });
        collapseCompactAttribution(map);

        const coords: [number, number][] = stops.map((s) => [s.lng, s.lat]);
        const linkColor =
          getComputedStyle(document.documentElement).getPropertyValue('--color-link').trim() || '#274A85';

        // The journey line depends on the style being loaded — add it on 'load'.
        map.on('load', () => {
          if (cancelled) return;
          map.addSource('journey', {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
          });
          map.addLayer({
            id: 'journey-line',
            type: 'line',
            source: 'journey',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': linkColor, 'line-width': 2, 'line-dasharray': [2, 1.5], 'line-opacity': 0.9 },
          });
        });

        markerRefs.current = stops.map((s, i) => {
          const el = document.createElement('div');
          el.className = 'journey-pin';
          // eslint-disable-next-line no-restricted-syntax -- MapLibre Marker requires a detached DOM element; innerHTML injects a static, controlled SVG (no user input).
          el.innerHTML = numberedPinSvgHtml(i + 1);
          const datePart = s.date ? `<div>${escapeHtml(s.date)}</div>` : '';
          const popup = new maplibregl.Popup({ offset: 32 }).setHTML(
            `<strong>${escapeHtml(s.title)}</strong>${datePart}<div>${escapeHtml(s.label)}</div>`,
          );
          return new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([s.lng, s.lat])
            .setPopup(popup)
            .addTo(map);
        });

        // Single stop is already framed by the constructor (center + zoom 9);
        // multiple stops get fit into view.
        if (coords.length > 1) {
          const bounds = coords.reduce(
            (b, c) => b.extend(c),
            new maplibregl.LngLatBounds(coords[0], coords[0]),
          );
          map.fitBounds(bounds, { padding: 80, maxZoom: 12 });
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRefs.current = [];
    };
  }, [key, resolvedTheme]);

  const focusStop = (i: number) => {
    const map = mapRef.current;
    const marker = markerRefs.current[i];
    if (!map || !marker) return;
    map.flyTo({ center: marker.getLngLat(), zoom: Math.max(map.getZoom(), 7) });
    const popup = marker.getPopup();
    if (popup && !popup.isOpen()) marker.togglePopup();
  };

  return { elRef, failed, focusStop };
}
