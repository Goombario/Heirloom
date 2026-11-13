'use client';

// Composes the full-page Explore workspace (#56): builds the tree, runs useExploreState,
// and lays out three panes that each scroll on their own: the list rail, the selected
// place, and the map filling the rest.
//
// The map tracks the CURRENT JURISDICTION (state.currentNode): it re-fits only when you drill
// into a different level — a click on a parent entry — never on hover or a leaf select. Combined
// with LocationMap keying off marker *values* + fitBounds animate:false, that means no burst of
// basemap tile loads while browsing.
//
// Desktop and tablet only: phones get MobilePlacesExplore (#1118).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import LocationMap from '@/app/components/LocationMap';
import { collapseEmptyIntermediaries, type PlaceTreeNode } from '@/lib/places/hierarchy';
import { findNodeById, useExploreState } from './useExploreState';
import { ExploreDrill } from './ExploreDrill';
import { ExploreDetail, type ExploreOverview } from './ExploreDetail';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { ScrollArea } from '@/app/components/ui/ScrollArea';
import { collectPins } from './collectPins';
import { MapPin } from '@/lib/icons';
import { usePrefetchPlaceDetail } from '@/lib/places/prefetch';
import { placeHref } from '@/lib/places/place-key';

export interface ExploreViewProps {
  /** The UNFILTERED jurisdiction tree (page.tsx built it via buildPlaceTree). Explore
   *  applies the query itself, inside the drill, so it can match globally. */
  roots: PlaceTreeNode[];
  treeId: number | null;
  /** The bar's filter query. */
  search: string;
  /** Clears the bar's filter (the rail's "no matches" line). */
  onClearSearch?: () => void;
}

export function ExploreView({ roots, treeId, search, onClearSearch }: ExploreViewProps) {
  const t = useTranslations('places');
  const router = useRouter();
  // Skip fact-less pass-through jurisdictions (e.g. New York with no own records) so the
  // drill goes straight from United States → Brooklyn.
  const displayRoots = useMemo(() => collapseEmptyIntermediaries(roots), [roots]);
  const state = useExploreState(displayRoots);

  const markers = useMemo(
    () => collectPins(state.currentNode ? [state.currentNode] : displayRoots),
    [state.currentNode, displayRoots],
  );

  const openFullPage = (node: PlaceTreeNode) =>
    router.push(placeHref(node));

  // Select inline — EXCEPT for a place with no gazetteer row. Selection is
  // id-based (it round-trips through ?sel=<id>), so an id-less row could only ever
  // select "nothing": the click cleared the pane and looked broken. Global search
  // made those rows reachable from any jurisdiction, so send them to the full page,
  // which can also address a place by name.
  const onRowClick = (node: PlaceTreeNode) => (node.id == null ? openFullPage(node) : state.select(node));

  // A pin click is the same act as a row click — same rules — so it goes through the same handler rather than calling
  // state.goTo: goTo would drill INTO a leaf, emptying the list, where select keeps the
  // leaf's siblings on screen. Markers only carry ids for places that have one.
  const onMarkerClick = (id: number) => {
    const node = findNodeById(displayRoots, id);
    if (node) onRowClick(node);
  };

  // Which pin the drill is pointing at. Hover only: it never changes selection or the URL.
  //
  // The hover is STAMPED with the row list it came from — the level, and whether a search
  // is filtering — and read back only while that stamp still matches. Swapping the rows
  // out from under the pointer (the drill a row click causes) fires no mouseleave, so a
  // plain id would survive it and light that pin up again, with nothing hovered, the
  // moment the level came back into view.
  //
  // The two pointing surfaces keep SEPARATE state. Sharing one slot meant a pin blurring
  // — which happens on the very next Tab after a pin click — cleared a highlight the
  // pointer was still resting on a row to produce.
  const rowsKey = `${state.currentNode?.id ?? ''}|${search.trim()}`;
  // BOTH carry the stamp. A pin needs it as much as a row: clicking a pin that has
  // children drills, which removes that pin from the map with no mouseleave to follow —
  // and a tap on a touch tablet never sends one at all — so an unstamped pin hover would
  // stick, holding the highlight against every later row hover.
  const [rowHover, setRowHover] = useState<{ rows: string; id: number } | null>(null);
  const [pinHover, setPinHover] = useState<{ rows: string; id: number } | null>(null);
  const current = (h: { rows: string; id: number } | null) => (h && h.rows === rowsKey ? h.id : null);
  const onRowHover = (node: PlaceTreeNode | null) =>
    setRowHover(node?.id != null ? { rows: rowsKey, id: node.id } : null);
  // A pin under the pointer wins: it is a direct hit on the map, where a row hover is a
  // pointer resting somewhere else entirely.
  const hoveredId = current(pinHover) ?? current(rowHover);

  // A hovered row lights the pins it OWNS OR CONTAINS, not just its own (#570). The pin
  // rule drops a jurisdiction's own coordinate whenever anything below it is geocoded —
  // that is what keeps a country centroid from blowing out the fitted bounds — so at the
  // root, where every row is a jurisdiction, matching one id lit nothing at all.
  const highlightedIds = useMemo(() => {
    const node = findNodeById(displayRoots, hoveredId);
    if (!node) return [];
    const out: number[] = [];
    const walk = (n: PlaceTreeNode) => {
      if (n.id != null && n.latitude != null && n.longitude != null) out.push(n.id);
      n.children.forEach(walk);
    };
    walk(node);
    return out;
  }, [displayRoots, hoveredId]);

  // Pointing at a pin does what pointing at its row does: the pin takes the highlight, and
  // the place's detail is warmed so the click paints from cache rather than flashing the
  // skeleton (#570). The drill row itself is not marked — the map is what lights up.
  const prefetch = usePrefetchPlaceDetail();
  const onMarkerHover = (id: number | null) => {
    setPinHover(id == null ? null : { rows: rowsKey, id });
    if (id == null) return;
    const node = findNodeById(displayRoots, id);
    if (node) prefetch(node.id ?? node.name);
  };

  // The place pane stays up whether or not a place is picked (#56 review), so picking
  // one never moves the map. Beside the map on wide windows, its width dragged by the
  // edge; under the map below lg, so the map never drops out, its height dragged instead.
  const stacked = useIsMobile('lg');
  const [paneW, setPaneW] = usePaneSize(WIDTH_KEY, PANE_W);
  const [paneH, setPaneH] = usePaneSize(HEIGHT_KEY, PANE_H);
  const workRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = workRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The map always keeps room of its own: the pane stops short of it.
  const maxW = Math.max(PANE_W_MIN, box.w - RAIL_W - MAP_MIN);
  const maxH = Math.max(PANE_H_MIN, box.h - MAP_MIN_H);
  const width = clamp(paneW, PANE_W_MIN, maxW);
  const height = clamp(paneH, PANE_H_MIN, maxH);

  const overview = useMemo<ExploreOverview>(() => {
    const all: PlaceTreeNode[] = [];
    const walk = (ns: PlaceTreeNode[]) => ns.forEach((n) => { if (n.children.length === 0 && n.id != null) all.push(n); walk(n.children); });
    walk(displayRoots);
    return {
      records: displayRoots.reduce((sum, n) => sum + n.rolledCount, 0),
      top: all.sort((a, b) => b.rolledCount - a.rolledCount).slice(0, 6),
    };
  }, [displayRoots]);

  const pane = (
    <ScrollArea className="flex-1 min-h-0">
      <ExploreDetail
        placeName={state.selected?.name ?? null}
        placeId={state.selected?.id ?? null}
        treeId={treeId}
        overview={overview}
        onPickPlace={(id) => { const node = findNodeById(displayRoots, id); if (node) state.reveal(node); }}
      />
    </ScrollArea>
  );
  const map = (
    <div className="relative min-h-0 min-w-0 flex-1" style={{ background: 'var(--map-well-bg)' }}>
      {markers.length === 0 ? (
        // No place in view has coordinates (most GEDCOMs carry none): a line saying
        // how to get one instead of an empty map (FR-5).
        <p className="absolute inset-0 m-0 flex items-center justify-center gap-2 p-6 text-sm text-text-muted text-center">
          <MapPin size={16} className="shrink-0" aria-hidden="true" />
          {t('map_none_explore')}
        </p>
      ) : (
        <LocationMap
          markers={markers}
          variant="full"
          height="100%"
          className="rounded-none!"
          onMarkerClick={onMarkerClick}
          onMarkerHover={onMarkerHover}
          highlightedIds={highlightedIds}
          refitOnResize
        />
      )}
    </div>
  );

  return (
    // Three panes, each scrolling on its own (#56): the list rail, the place pane and
    // the map. Below lg the pane docks under the map instead of beside it.
    <div ref={workRef} className="explore-workspace flex-1 min-h-0 grid" style={{ gridTemplateColumns: `${stacked ? RAIL_W_NARROW : RAIL_W}px minmax(0,1fr)` }}>
      <div className="min-h-0 flex flex-col bg-card border-r border-border">
        <ExploreDrill
          state={state}
          search={search}
          onRowClick={onRowClick}
          onRowHover={onRowHover}
          onClearSearch={onClearSearch}
        />
      </div>
      {stacked ? (
        <div className="min-h-0 min-w-0 flex flex-col">
          {map}
          <PaneResizer orientation="horizontal" value={height} min={PANE_H_MIN} max={maxH} onChange={setPaneH} label={t('pane_resize')} invert />
          <div className="shrink-0 min-h-0 flex flex-col bg-card" style={{ height }}>{pane}</div>
        </div>
      ) : (
        <div className="min-h-0 min-w-0 flex">
          <div className="shrink-0 min-h-0 flex flex-col bg-card" style={{ width }}>{pane}</div>
          <PaneResizer orientation="vertical" value={width} min={PANE_W_MIN} max={maxW} onChange={setPaneW} label={t('pane_resize')} />
          {map}
        </div>
      )}
    </div>
  );
}

const RAIL_W = 320;
const RAIL_W_NARROW = 300;
/** The place pane's width beside the map: 420 to start, never under 360. */
const PANE_W = 420;
const PANE_W_MIN = 360;
/** The pane's height docked under the map. */
const PANE_H = 360;
const PANE_H_MIN = 200;
/** What the map keeps, whichever way the pane is dragged. */
const MAP_MIN = 320;
const MAP_MIN_H = 200;
const WIDTH_KEY = 'places-explore-pane-width';
const HEIGHT_KEY = 'places-explore-pane-height';

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** A dragged pane size, kept as a preference on this device. */
function usePaneSize(key: string, initial: number): [number, (n: number) => void] {
  // A lazy read is hydration-safe here: Explore only renders after the client-side fetch.
  const [size, setSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      return Number.isFinite(saved) && saved > 0 ? saved : initial;
    } catch {
      return initial;
    }
  });
  const save = useCallback((n: number) => {
    setSize(n);
    try { localStorage.setItem(key, String(Math.round(n))); } catch { /* ignore */ }
  }, [key]);
  return [size, save];
}

/**
 * The pane's draggable edge: a window splitter (role="separator") the pointer drags and the
 * arrow keys step, 16px at a time (Home and End go to the limits). `invert` is for a pane
 * BELOW its edge, which grows as the edge moves up.
 */
function PaneResizer({ orientation, value, min, max, onChange, label, invert = false }: {
  orientation: 'vertical' | 'horizontal'; value: number; min: number; max: number;
  onChange: (n: number) => void; label: string; invert?: boolean;
}) {
  const start = useRef<{ pos: number; value: number } | null>(null);
  const vertical = orientation === 'vertical';
  const set = (n: number) => onChange(clamp(Math.round(n), min, max));
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { pos: vertical ? e.clientX : e.clientY, value };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const delta = (vertical ? e.clientX : e.clientY) - start.current.pos;
    set(start.current.value + (invert ? -delta : delta));
  };
  const end = () => { start.current = null; };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const grow = vertical ? 'ArrowRight' : invert ? 'ArrowUp' : 'ArrowDown';
    const shrink = vertical ? 'ArrowLeft' : invert ? 'ArrowDown' : 'ArrowUp';
    if (e.key === grow) set(value + 16);
    else if (e.key === shrink) set(value - 16);
    else if (e.key === 'Home') set(min);
    else if (e.key === 'End') set(max);
    else return;
    e.preventDefault();
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={Math.round(max)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      className={`explore-resizer explore-resizer--${orientation} shrink-0 focus-ring-inset`}
    />
  );
}
