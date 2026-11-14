'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { escapeHtml } from '@/lib/validation';
import { useTheme } from '@/app/components/ThemeProvider';
import { getMapStyleUrl, addMapCredit, configureMapLibreWorker } from '@/lib/geo/map-style';
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
  /** Where the pin was before a drag (#56): faded, and never draggable itself. */
  ghost?: boolean;
}

interface LocationMapProps {
  markers: MapMarker[];
  variant?: 'full' | 'mini';
  /** Pixels, or `'100%'` to fill a sized parent (the full-page Places Explore, #56). */
  height?: number | '100%';
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
  /** Which lit pins carry a name chip. Left out, a highlight that lights exactly one
   *  drawn pin names it; Explore passes its own (the selected and the hovered place each
   *  name their pin), so a selection and a hover can both be named at once. */
  labelledIds?: readonly number[];
  /** Extra room around framed pins, as a share of the map's width (sides) and height
   *  (top and bottom), on top of the usual margin: Explore frames a little looser. */
  fitMargin?: number;
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
  /** Space kept clear of pins when framing them, in pixels: the place page's cover lays
   *  its name over the map's foot (#56), so the pins frame above it. */
  insets?: { top: number; right: number; bottom: number; left: number };
  /** Re-frames the pins whenever the map's box changes size, until the reader pans or
   *  zooms it themselves: the Explore map shares its row with a pane that can be dragged
   *  wider or narrower, so a view framed for the old width would cut pins off. */
  refitOnResize?: boolean;
  /** Room covered by something floating over the map — the Explore place card on its
   *  left edge. Kept as camera padding, on top of `insets`: the pins frame beside it and
   *  the view centres in the uncovered part. A change never re-frames or zooms: the view
   *  slides over only as far as it takes to bring the pins out from under it. */
  fitInsets?: { top: number; right: number; bottom: number; left: number };
  /** The pin the reader picked. When it (or, with none, the pins in view) sits under
   *  `fitInsets`, the view slides over to clear it, at the same zoom. */
  focusId?: number | null;
  /** A request to frame these points — a place and the places inside it — in the part of
   *  the map left open by `fitInsets`, zooming in or out to fit them. Each new `n` frames
   *  once; other pins may fall outside. One point is centred at street-level zoom. */
  frameTarget?: { n: number; points: readonly { lat: number; lng: number }[] } | null;
  /** Where a full map's zoom buttons sit. Explore moves them right: its card floats left. */
  controlsCorner?: 'top-left' | 'top-right';
}

/** Room kept around framed pins. A full map's pin stands 40px tall above its point, so
 *  the top keeps more than the sides, or the northernmost pin's head is cut off. The
 *  sides keep a clear margin too, so no pin sits on the map's edge (owner review 2026-11-13). */
function fitPadding(variant: 'full' | 'mini', el?: HTMLElement | null, margin = 0) {
  const base = variant === 'full' ? { top: 88, right: 72, bottom: 56, left: 72 } : 30;
  // Plus `fitMargin` of the map's size, where the caller asks for a looser frame.
  if (!el || margin <= 0 || typeof base === 'number') return base;
  const x = Math.round(el.clientWidth * margin), y = Math.round(el.clientHeight * margin);
  return { top: base.top + y, right: base.right + x, bottom: base.bottom + y, left: base.left + x };
}

type Insets = NonNullable<LocationMapProps['insets']>;
const NO_PADDING: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The camera padding: the cover's insets plus whatever floats over the map. MapLibre adds
 *  it to every fitBounds padding and centres the view in what is left. */
function cameraPadding(insets?: Insets, over?: Insets): Insets {
  const a = insets ?? NO_PADDING, b = over ?? NO_PADDING;
  return { top: a.top + b.top, right: a.right + b.right, bottom: a.bottom + b.bottom, left: a.left + b.left };
}

/** Room kept between a cleared pin and the edge of what covers the map. */
const CLEAR_MARGIN = 48;

/**
 * How far (px) to slide the view so pins clear a cover on the map's left (the Explore
 * card). The picked pin is brought into the uncovered part outright, from under the
 * card or from off screen. With none picked, the pins in view slide right only as far
 * as the rightmost can go without leaving the map.
 */
function clearingShift(map: MapInstance, markers: MapMarker[], focusId: number | null, padding: Insets): { x: number; y: number } {
  const el = map.getContainer();
  const w = el.clientWidth, h = el.clientHeight;
  const left = padding.left + CLEAR_MARGIN, right = w - padding.right - CLEAR_MARGIN;
  const top = padding.top + CLEAR_MARGIN, bottom = h - padding.bottom - CLEAR_MARGIN;
  const into = (v: number, lo: number, hi: number) => (v < lo ? lo - v : v > hi ? hi - v : 0);
  const pins = markers.filter((m) => !m.ghost).map((m) => ({ id: m.id, ...map.project([m.lng, m.lat]) }));
  const focus = focusId == null ? undefined : pins.find((p) => p.id === focusId);
  if (focus) return { x: into(focus.x, left, right), y: into(focus.y, top, bottom) };
  const shown = pins.filter((p) => p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h);
  if (shown.length === 0) return { x: 0, y: 0 };
  const minX = Math.min(...shown.map((p) => p.x));
  const room = right - Math.max(...shown.map((p) => p.x));
  return { x: Math.max(0, Math.min(left - minX, room)), y: 0 };
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
  el.className = m.ghost ? 'location-map-pin is-ghost' : 'location-map-pin';

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
  labelledIds,
  fitMargin = 0,
  draggable = false,
  onMarkerDragEnd,
  gestures = false,
  onBackgroundClick,
  insets,
  refitOnResize = false,
  fitInsets,
  controlsCorner = 'top-left',
  focusId = null,
  frameTarget = null,
}: LocationMapProps) {
  const t = useTranslations('common');
  const creditOsm = t('map_credit_osm');
  const creditTiles = t('map_credit_tiles');
  const { resolvedTheme } = useTheme();
  const elRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const h = height ?? (variant === 'mini' ? 160 : 320);

  // Depend on a value-derived key (not array identity) so markers are only re-synced when
  // marker values actually change. Read live markers via ref.
  const markersRef = useRef(markers);
  markersRef.current = markers;
  // Read once, when the map is built: the cover's insets never change.
  const insetsRef = useRef(insets);
  const refitRef = useRef(refitOnResize);
  refitRef.current = refitOnResize;
  // Read once, when the map is built, like the insets.
  const controlsCornerRef = useRef(controlsCorner);
  const fitInsetsRef = useRef(fitInsets);
  fitInsetsRef.current = fitInsets;
  const fitInsetsKey = fitInsets ? `${fitInsets.top},${fitInsets.right},${fitInsets.bottom},${fitInsets.left}` : '';

  // Set once the view has been placed on purpose — a frame request or a slide clear of
  // the card — so a later resize keeps that view instead of re-framing every pin. A drill
  // (a new set of places) releases it.
  const heldRef = useRef(false);
  const markersKey = markers
    .map((m) => `${m.lat},${m.lng},${m.label}|${m.href ?? ''}|${m.id ?? ''}|${m.ghost ? 'g' : ''}`)
    .join(';');
  const hasMarkers = markers.length > 0;

  // Framing keys off marker IDENTITY, not position: re-frame when the map is showing a
  // different set of places (a drill), never because a place MOVED. A dragged pin (#566)
  // or a coordinate typed into the edit field must not yank the viewport out from under
  // the hand doing the dragging — the pin moves, the map holds still.
  // A ghost (a dragged pin's old place) never re-frames the map.
  const identityKey = markers.filter((m) => !m.ghost).map((m) => m.id ?? `@${m.label}`).join(';');
  const identityKeyRef = useRef(identityKey);
  identityKeyRef.current = identityKey;

  // Latest handlers and label formatter, read from long-lived DOM listeners.
  const clickRef = useRef(onMarkerClick);
  clickRef.current = onMarkerClick;
  const hoverRef = useRef(onMarkerHover);
  hoverRef.current = onMarkerHover;
  const highlightedIdsRef = useRef(highlightedIds);
  highlightedIdsRef.current = highlightedIds;
  const fitMarginRef = useRef(fitMargin);
  fitMarginRef.current = fitMargin;
  const labelledIdsRef = useRef(labelledIds);
  labelledIdsRef.current = labelledIds;
  /** The lit keys that get a name chip: the caller's choice, else the one-pin rule. */
  const namedKeys = (lit: ReadonlySet<string>): ReadonlySet<string> => {
    if (labelledIdsRef.current) return keysForIds(labelledIdsRef.current);
    return highlightNamesOne(lit, drawnKeys(registryRef.current)) ? lit : new Set<string>();
  };
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
          attributionControl: false,
        });
        map.on('error', () => { if (!cancelled) setFailed(true); });
        addMapCredit(map, { osm: creditOsm, tiles: creditTiles });
        if (insetsRef.current || fitInsetsRef.current) map.setPadding(cameraPadding(insetsRef.current, fitInsetsRef.current));

        // Pins stop their own clicks, so this is only ever the map itself.
        map.on('click', () => backgroundClickRef.current?.());
        if (variant === 'full') {
          map.addControl(new maplibregl.NavigationControl({ showCompass: false }), controlsCornerRef.current);
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
          map.fitBounds(bounds, { padding: fitPadding(variant, elRef.current, fitMarginRef.current), maxZoom: 14, animate: false });
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
  }, [variant, resolvedTheme, hasMarkers, gestures, creditOsm, creditTiles]);

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
        draggable: draggableRef.current && !data.ghost,
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
    const named = namedKeys(highlightKeysRef.current);
    highlightKeysRef.current.forEach((key) => {
      setHighlighted(registry.get(key), true);
      setLabelled(registry.get(key), named.has(key));
    });

    // Re-frame only when the set of PLACES changed (a drill) — never on a highlight, and
    // never because a pin moved (a drag, or coordinates typed into the edit field).
    if (framedKeyRef.current !== identityKeyRef.current) {
      framedKeyRef.current = identityKeyRef.current;
      heldRef.current = false;
      // Frame for what covers the map NOW: a drill that also opens the Explore card
      // lands in this same commit, before the padding effect below runs.
      map.setPadding(cameraPadding(insetsRef.current, fitInsetsRef.current));
      if (next.length === 1) {
        map.jumpTo({ center: [next[0].lng, next[0].lat], zoom: variant === 'mini' ? 9 : 11 });
      } else if (next.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        next.forEach((m) => bounds.extend([m.lng, m.lat]));
        map.fitBounds(bounds, { padding: fitPadding(variant, elRef.current, fitMarginRef.current), maxZoom: 14, animate: false });
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
    registryRef.current.forEach(({ marker, data }) => {
      const can = draggable && !data.ghost;
      marker.setDraggable(can);
      marker.getElement().classList.toggle('is-draggable', can);
    });
  }, [map, draggable, markersKey]);

  // Highlight: a class toggle on the elements that actually changed. No map API is
  // touched at all. Keyed on the ids' VALUES so a caller re-deriving the array each
  // render does not re-run this — and so a hover that overlaps the previous one (parent
  // then child) leaves the shared pins alone instead of flickering them off and on.
  const highlightKey = [...highlightedIds].sort((a, b) => a - b).join(',');
  const labelKey = labelledIds ? [...labelledIds].sort((a, b) => a - b).join(',') : '-';
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
    const named = namedKeys(next);
    next.forEach((key) => setLabelled(registryRef.current.get(key), named.has(key)));
    highlightKeysRef.current = next;
  }, [map, highlightKey, labelKey]);

  // A map that fills its parent follows the parent's size, not just the window's: the
  // Explore pane beside it can widen (#56), which MapLibre's own resize tracking misses.
  useEffect(() => {
    const el = elRef.current;
    if (!map || !el || typeof ResizeObserver === 'undefined') return;
    // A pan or zoom of the reader's own (it carries an originalEvent; a fit does not)
    // keeps their view through later resizes, until a drill frames a new set of places.
    let moved = false;
    let movedFor = framedKeyRef.current;
    const onMove = (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent) return;
      moved = true;
      movedFor = framedKeyRef.current;
    };
    map.on('movestart', onMove);
    let frame = 0;
    const ro = new ResizeObserver(() => {
      map.resize();
      if (!refitRef.current || heldRef.current) return;
      if (moved && movedFor === framedKeyRef.current) return;
      moved = false;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const gl = glRef.current;
        const pins = markersRef.current.filter((m) => !m.ghost);
        if (!gl || pins.length === 0) return;
        if (pins.length === 1) { map.setCenter([pins[0].lng, pins[0].lat]); return; }
        const bounds = new gl.LngLatBounds();
        pins.forEach((m) => bounds.extend([m.lng, m.lat]));
        map.fitBounds(bounds, { padding: fitPadding(variant, elRef.current, fitMarginRef.current), maxZoom: 14, animate: false });
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      map.off('movestart', onMove);
    };
  }, [map, variant]);

  // What floats over the map changed (the Explore card opened or folded), or the reader
  // picked another place: keep the zoom, and slide the view only as far as it takes to
  // bring the picked pin into the open part — or, with none, the pins in view out from
  // under the card.
  // Never a re-frame, so a pick never zooms out. Not on the first run: the map was just
  // built with this padding.
  //
  // A frame request (a rail pick) wins over that: it fits the place and the places inside
  // it into the open part, zooming as it needs to.
  const paddedForRef = useRef(fitInsetsKey);
  const focusedRef = useRef(focusId);
  const frameTargetRef = useRef(frameTarget);
  frameTargetRef.current = frameTarget;
  const frameN = frameTarget?.n ?? null;
  const framedNRef = useRef(frameN);
  useEffect(() => {
    if (!map) return;
    const padChanged = paddedForRef.current !== fitInsetsKey;
    const frameAsked = framedNRef.current !== frameN && frameN != null;
    if (!padChanged && !frameAsked && focusedRef.current === focusId) return;
    paddedForRef.current = fitInsetsKey;
    focusedRef.current = focusId;
    framedNRef.current = frameN;
    const next = cameraPadding(insetsRef.current, fitInsetsRef.current);
    const points = frameAsked ? frameTargetRef.current?.points ?? [] : [];
    const gl = glRef.current;
    if (points.length === 1) {
      heldRef.current = true;
      map.easeTo({ center: [points[0].lng, points[0].lat], zoom: variant === 'mini' ? 9 : 11, padding: next, duration: 400 });
      return;
    }
    if (points.length > 1 && gl) {
      const bounds = new gl.LngLatBounds();
      points.forEach((pt) => bounds.extend([pt.lng, pt.lat]));
      heldRef.current = true;
      map.setPadding(next);
      map.fitBounds(bounds, { padding: fitPadding(variant, elRef.current, fitMarginRef.current), maxZoom: 14, duration: 400 });
      return;
    }
    const shift = clearingShift(map, markersRef.current, focusId, next);
    if (!padChanged && shift.x === 0 && shift.y === 0) return;
    // The camera centres on the middle of the padded area; pick the centre that leaves
    // every pin where it is on screen, moved by `shift`.
    if (shift.x !== 0 || shift.y !== 0) heldRef.current = true;
    const el = map.getContainer();
    const cx = next.left + (el.clientWidth - next.left - next.right) / 2;
    const cy = next.top + (el.clientHeight - next.top - next.bottom) / 2;
    map.easeTo({ center: map.unproject([cx - shift.x, cy - shift.y]), padding: next, duration: 300 });
  }, [map, fitInsetsKey, focusId, frameN, variant]);

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