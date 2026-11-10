'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { escapeHtml } from '@/lib/validation';
import { useTheme } from '@/app/components/ThemeProvider';
import { getMapStyleUrl, collapseCompactAttribution, configureMapLibreWorker } from '@/lib/geo/map-style';
import { pinSvgHtml } from './map-pin';
import { diffMarkers, highlightNamesOne, highlightTransition, keysForIds } from './markerRegistry';
import 'maplibre-gl/dist/maplibre-gl.css';

export interface MapMarker {
  lat: number;
  lng: number;
  label: string;
  href?: string;
  /** Gazetteer place id. Required for a marker to be clickable (selection is id-based),
   *  to report hover, and for `highlightedIds` to be able to address it. */
  id?: number | null;
}

interface LocationMapProps {
  markers: MapMarker[];
  variant?: 'full' | 'mini';
  height?: number;
  className?: string;
  /** Makes pins with an `id` operable: they become focusable buttons that report the
   *  clicked place instead of opening a popup — the caller has somewhere to select into. */
  onMarkerClick?: (id: number) => void;
  /** Reports the pin under the pointer (null on leave), so the caller can warm its detail
   *  the way a hovered list row does. Only fired for pins that carry an id. */
  onMarkerHover?: (id: number | null) => void;
  /** Marks the pins under discussion elsewhere (a hovered list row and, when that row is a
   *  jurisdiction, everything geocoded below it). Changing it mutates those marker elements
   *  only: no re-init, no fitBounds, no tile reload. */
  highlightedIds?: readonly number[];
  /** Lets the pins be dragged (#566). Toggled, not re-mounted — entering edit mode must not
   *  rebuild the map. Only meaningful where a drag has somewhere to write to. */
  draggable?: boolean;
  /** Where a drag ended. Fired on `dragend` only — never per frame. */
  onMarkerDragEnd?: (lat: number, lng: number, id: number | null) => void;
  /** A mini map that still pans and zooms by touch (the phone Explore strip): drag,
   *  pinch and double-tap, without the zoom buttons or rotation. */
  gestures?: boolean;
  /** A tap on the map itself, not on a pin. */
  onBackgroundClick?: () => void;
}

/** Stable empty default — a fresh `[]` in the parameter list would be a new array every
 *  render, and the highlight effect keys off the ids. */
const NO_IDS: readonly number[] = [];

/** The module namespace used by MapLibre GL JS v6's ESM-only distribution. */
type MapLibre = typeof import('maplibre-gl');
type MapInstance = import('maplibre-gl').Map;
type MarkerInstance = import('maplibre-gl').Marker;

interface RegistryEntry {
  marker: MarkerInstance;
  data: MapMarker;
}

/** The pin's DOM. MapLibre owns the ROOT element's transform (it positions markers with
 *  it), so every visual treatment of ours — the highlight scale — lives on the inner
 *  body, never on the root. */
function makePinEl(m: MapMarker): HTMLElement {
  const el = document.createElement('div');
  el.className = 'location-map-pin';

  const body = document.createElement('div');
  body.className = 'location-map-pin-body';
  // eslint-disable-next-line no-restricted-syntax -- MapLibre Marker requires a detached DOM element; innerHTML injects a static, controlled SVG (no user input).
  body.innerHTML = pinSvgHtml();

  // Highlight is SIZE + LABEL, never colour alone: the chip is present from the start
  // (textContent, so a user-entered place name can never be markup) and revealed by the
  // is-highlighted class.
  const chip = document.createElement('span');
  chip.className = 'location-map-pin-label';
  chip.textContent = m.label;
  body.appendChild(chip);

  el.appendChild(body);
  return el;
}

/** Makes a pin operable. MapLibre already gives every marker root `role="button"` and the
 *  generic "Map marker" label when it is added to the map — so a <button> of ours inside
 *  it would nest one button in another and add a second, useless tab stop. We take over
 *  that root instead: a real name, a click, and Enter/Space, which a role="button" div
 *  does not get for free. `tabindex` too: MapLibre only makes a marker focusable when it
 *  has a POPUP, and a selecting pin deliberately has none, so without this the pin would
 *  be pointer-only. Call AFTER `addTo`, which is when MapLibre writes its own attributes. */
function makeClickable(
  el: HTMLElement,
  selectLabel: string,
  onClick: () => void,
): void {
  el.classList.add('is-clickable');
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', selectLabel);
  el.addEventListener('click', (e) => {
    // Without this the map handles the pin click as a canvas click too.
    e.stopPropagation();
    onClick();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
}

/** Reports the pointer entering and leaving a pin. Separate from `makeClickable` on
 *  purpose: hovering is meaningful to a caller that only wants to know what is being
 *  pointed at (to warm its detail, #570), whether or not that caller also takes clicks.
 *  Focus counts as pointing, matching the drill rows. */
function makeHoverable(el: HTMLElement, onHover: (over: boolean) => void): void {
  el.addEventListener('mouseenter', () => onHover(true));
  el.addEventListener('mouseleave', () => onHover(false));
  el.addEventListener('focus', () => onHover(true));
  el.addEventListener('blur', () => onHover(false));
}

/** Popup body for a pin that has nothing to select into. Place names are user-entered →
 *  escape before they reach the popup's innerHTML, and only internal ("/") hrefs are
 *  allowed (no javascript:/external). */
function popupHtml(m: MapMarker): string {
  const safeLabel = escapeHtml(m.label);
  const internalHref = m.href && m.href.startsWith('/') ? m.href : null;
  return internalHref ? `<a href="${escapeHtml(internalHref)}">${safeLabel}</a>` : safeLabel;
}

function updatePinEl(el: HTMLElement, m: MapMarker, selectLabel: string): void {
  const chip = el.querySelector('.location-map-pin-label');
  if (chip) chip.textContent = m.label;
  if (el.classList.contains('is-clickable')) el.setAttribute('aria-label', selectLabel);
}

function setHighlighted(entry: RegistryEntry | undefined, on: boolean): void {
  entry?.marker.getElement().classList.toggle('is-highlighted', on);
}

/** The name chip is shown only when the highlight is ONE pin — pointing at a single place
 *  names it, while pointing at a jurisdiction lights everything inside it and five chips
 *  in one county would overlap into an unreadable stack. Size still carries the cue in
 *  both cases, so this never leaves colour on its own. */
function setLabelled(entry: RegistryEntry | undefined, on: boolean): void {
  entry?.marker.getElement().classList.toggle('show-label', on);
}

/** Keys of the pins actually drawn — what a highlight has to resolve against. */
const drawnKeys = (registry: Map<string, RegistryEntry>): ReadonlySet<string> =>
  new Set(registry.keys());

export default function LocationMap({
  markers,
  variant = 'full',
  height,
  className,
  onMarkerClick,
  onMarkerHover,
  highlightedIds = NO_IDS,
  draggable = false,
  onMarkerDragEnd,
  gestures = false,
  onBackgroundClick,
}: LocationMapProps) {
  const t = useTranslations('common');
  const { resolvedTheme } = useTheme();
  const elRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const h = height ?? (variant === 'mini' ? 160 : 320);

  // Depend on a value-derived key (not array identity) so markers are only re-synced when
  // marker values actually change. Read live markers via ref.
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const markersKey = markers
    .map((m) => `${m.lat},${m.lng},${m.label}|${m.href ?? ''}|${m.id ?? ''}`)
    .join(';');
  const hasMarkers = markers.length > 0;

  // Framing keys off marker IDENTITY, not position: re-frame when the map is showing a
  // different set of places (a drill), never because a place MOVED. A dragged pin (#566)
  // or a coordinate typed into the edit field must not yank the viewport out from under
  // the hand doing the dragging — the pin moves, the map holds still.
  const identityKey = markers.map((m) => m.id ?? `@${m.label}`).join(';');
  const identityKeyRef = useRef(identityKey);
  identityKeyRef.current = identityKey;

  // Latest handlers and label formatter, read from long-lived DOM listeners.
  const clickRef = useRef(onMarkerClick);
  clickRef.current = onMarkerClick;
  const hoverRef = useRef(onMarkerHover);
  hoverRef.current = onMarkerHover;
  const highlightedIdsRef = useRef(highlightedIds);
  highlightedIdsRef.current = highlightedIds;
  const draggableRef = useRef(draggable);
  draggableRef.current = draggable;
  const dragEndRef = useRef(onMarkerDragEnd);
  dragEndRef.current = onMarkerDragEnd;
  const backgroundClickRef = useRef(onBackgroundClick);
  backgroundClickRef.current = onBackgroundClick;
  const selectLabel = (label: string) => t('map_select_place', { place: label });
  const labelRef = useRef(selectLabel);
  labelRef.current = selectLabel;

  // The map instance, published only once it has finished loading — markers are added
  // after the basemap's first full render, otherwise the pin DOM paints over a blank
  // canvas before the tiles arrive (a distracting pin-then-background flash).
  const [map, setMap] = useState<MapInstance | null>(null);
  const glRef = useRef<MapLibre | null>(null);
  const registryRef = useRef<Map<string, RegistryEntry>>(new Map());
  /** identityKey the view was last framed for — re-frame only when the set of PLACES
   *  changes, never when one of them moves. */
  const framedKeyRef = useRef<string | null>(null);
  const highlightKeysRef = useRef<ReadonlySet<string>>(new Set());

  // Map lifecycle. Deliberately NOT keyed on markers: the instance has to survive marker
  // changes so a highlight or a drill does not refetch every tile. Theme still re-inits
  // (a style swap is a genuine rebuild).
  useEffect(() => {
    let map: MapInstance | null = null;
    let cancelled = false;
    const registry = registryRef.current;
    const current = markersRef.current;
    // Captured together: the key must describe `current`, the set actually framed below.
    // Reading it after the dynamic import instead would record a set the view was never
    // fitted to if the markers changed while the chunk downloaded, and the sync effect's
    // "already framed this" guard would then suppress the correction for good.
    const currentKey = identityKeyRef.current;
    if (current.length === 0 || !elRef.current) return;

    (async () => {
      try {
        const maplibregl = await import('maplibre-gl');
        if (cancelled || !elRef.current) return;
        configureMapLibreWorker(maplibregl);
        glRef.current = maplibregl;
        map = new maplibregl.Map({
          container: elRef.current,
          style: getMapStyleUrl(resolvedTheme),
          center: [current[0].lng, current[0].lat],
          zoom: variant === 'mini' ? 9 : 11,
          attributionControl: { compact: true },
        });
        map.on('error', () => { if (!cancelled) setFailed(true); });
        collapseCompactAttribution(map);

        // Pins stop their own clicks, so this is only ever the map itself.
        map.on('click', () => backgroundClickRef.current?.());
        if (variant === 'full') {
          map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
        } else if (gestures) {
          // Pans and zooms like the full map, but stays north-up and keeps the wheel for the page.
          map.scrollZoom.disable();
          map.dragRotate.disable();
          map.touchZoomRotate.disableRotation();
          map.touchPitch.disable();
          map.keyboard.disable();
        } else {
          // Mini map is a calm thumbnail: disable all gesture handlers so it never
          // captures page scroll / touch-pan on mobile (popups stay clickable).
          map.scrollZoom.disable();
          map.dragPan.disable();
          map.touchZoomRotate.disable();
          map.doubleClickZoom.disable();
          map.boxZoom.disable();
          map.keyboard.disable();
        }

        // Frame the view synchronously (before tiles load) so the basemap fetches the
        // right tiles up front. Single marker: the constructor already centered + zoomed
        // on it. Multiple: fit them all. Recording the key here is what stops the marker
        // effect from re-framing the same set a second time after 'load'.
        if (current.length > 1) {
          const bounds = new maplibregl.LngLatBounds();
          current.forEach((m) => bounds.extend([m.lng, m.lat]));
          // animate:false — snap to the framed view instead of a long zoom-out fly on load.
          map.fitBounds(bounds, { padding: 30, maxZoom: 14, animate: false });
        }
        framedKeyRef.current = currentKey;

        map.on('load', () => {
          if (!cancelled) setMap(map);
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      setMap(null);
      registry.clear();
      framedKeyRef.current = null;
      highlightKeysRef.current = new Set();
      map?.remove();
      map = null;
    };
  }, [variant, resolvedTheme, hasMarkers, gestures]);

  // Marker sync: add / remove / move individual markers on the live instance.
  useEffect(() => {
    const maplibregl = glRef.current;
    if (!map || !maplibregl) return;
    const registry = registryRef.current;
    const next = markersRef.current;

    const before = new Map([...registry].map(([key, entry]) => [key, entry.data]));
    const { added, removed, updated } = diffMarkers(before, next);

    removed.forEach((key) => {
      registry.get(key)?.marker.remove();
      registry.delete(key);
    });

    added.forEach(({ key, marker: data }) => {
      // Selection is id-based, so only a pin that resolves to a real place can be
      // clickable; an id-less pin keeps the popup, which is all it can offer.
      const clickable = data.id != null && clickRef.current != null;
      const id = data.id;
      const marker = new maplibregl.Marker({
        element: makePinEl(data),
        anchor: 'bottom',
        draggable: draggableRef.current,
      }).setLngLat([data.lng, data.lat]);
      // dragend only — never `drag`. The coordinates field is the source of truth and a
      // per-frame write would thrash it (and its validation) sixty times a second.
      marker.on('dragend', () => {
        // .wrap() — MapLibre stops normalising a marker's longitude once it is on screen,
        // so dragging on a repeated world copy reports 181.5 rather than -178.5, which is
        // out of range for every consumer (and for our own coordinate validation).
        const { lat, lng } = marker.getLngLat().wrap();
        dragEndRef.current?.(lat, lng, data.id ?? null);
      });

      // Mini map is a static 160px thumbnail — a popup can't fit in it and gets clipped
      // off-screen, and the place name is already shown in the event text above it. On a
      // map that can select, the click IS the affordance and the detail surface is the
      // popup (#466), so a clickable pin gets no popup either.
      if (variant === 'full' && !clickable) {
        marker.setPopup(new maplibregl.Popup({ offset: 30 }).setHTML(popupHtml(data)));
      }

      marker.addTo(map);
      if (id != null) {
        if (clickable) {
          makeClickable(marker.getElement(), labelRef.current(data.label), () => clickRef.current?.(id));
        }
        makeHoverable(marker.getElement(), (over) => hoverRef.current?.(over ? id : null));
      }
      registry.set(key, { marker, data });
    });

    updated.forEach(({ key, marker: data }) => {
      const entry = registry.get(key);
      if (!entry) return;
      entry.marker.setLngLat([data.lng, data.lat]);
      updatePinEl(entry.marker.getElement(), data, labelRef.current(data.label));
      // A relabelled or re-linked marker keeps its popup — refresh its body too, or the
      // pin would show its new name and open a popup still holding the old one.
      entry.marker.getPopup()?.setHTML(popupHtml(data));
      entry.data = data;
    });

    // A marker that was rebuilt starts unhighlighted; re-assert the current highlight.
    const named = highlightNamesOne(highlightKeysRef.current, drawnKeys(registry));
    highlightKeysRef.current.forEach((key) => {
      setHighlighted(registry.get(key), true);
      setLabelled(registry.get(key), named);
    });

    // Re-frame only when the set of PLACES changed (a drill) — never on a highlight, and
    // never because a pin moved (a drag, or coordinates typed into the edit field).
    if (framedKeyRef.current !== identityKeyRef.current) {
      framedKeyRef.current = identityKeyRef.current;
      if (next.length === 1) {
        map.jumpTo({ center: [next[0].lng, next[0].lat], zoom: variant === 'mini' ? 9 : 11 });
      } else if (next.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        next.forEach((m) => bounds.extend([m.lng, m.lat]));
        map.fitBounds(bounds, { padding: 30, maxZoom: 14, animate: false });
      }
    } else if (next.length === 1 && !map.getBounds().contains([next[0].lng, next[0].lat])) {
      // Same place, moved right off the screen — typed coordinates can do that, where a
      // drag cannot. Pan to it rather than re-framing: the zoom the reader chose is kept,
      // and a pin they can no longer see is worse than a viewport that follows it.
      map.easeTo({ center: [next[0].lng, next[0].lat], duration: 300 });
    }
  }, [map, markersKey, variant]);

  // Draggability is toggled on the LIVE markers (#566): entering edit mode must not
  // rebuild the map, which is exactly what a re-mount would cost.
  useEffect(() => {
    if (!map) return;
    registryRef.current.forEach(({ marker }) => {
      marker.setDraggable(draggable);
      marker.getElement().classList.toggle('is-draggable', draggable);
    });
  }, [map, draggable, markersKey]);

  // Highlight: a class toggle on the elements that actually changed. No map API is
  // touched at all. Keyed on the ids' VALUES so a caller re-deriving the array each
  // render does not re-run this — and so a hover that overlaps the previous one (parent
  // then child) leaves the shared pins alone instead of flickering them off and on.
  const highlightKey = [...highlightedIds].sort((a, b) => a - b).join(',');
  useEffect(() => {
    if (!map) return;
    const next = keysForIds(highlightedIdsRef.current);
    const { off, on } = highlightTransition(highlightKeysRef.current, next);
    off.forEach((key) => {
      setHighlighted(registryRef.current.get(key), false);
      setLabelled(registryRef.current.get(key), false);
    });
    on.forEach((key) => setHighlighted(registryRef.current.get(key), true));
    // Applied to the whole set, not just the newly-lit: growing a one-pin highlight into a
    // jurisdiction has to take the chip off the pin that was already on.
    const named = highlightNamesOne(next, drawnKeys(registryRef.current));
    next.forEach((key) => setLabelled(registryRef.current.get(key), named));
    highlightKeysRef.current = next;
  }, [map, highlightKey]);

  if (failed) {
    return (
      <div
        className={`${className ?? ''} flex items-center justify-center`}
        style={{ height: h }}
      >
        <span className="text-text-muted text-meta">{t('map_unavailable')}</span>
      </div>
    );
  }

  return (
    <div
      ref={elRef}
      className={`${className ?? ''} overflow-hidden rounded-[8px]`}
      style={{ height: h }}
    />
  );
}