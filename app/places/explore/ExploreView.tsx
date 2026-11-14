'use client';

// Composes the full-page Explore workspace (#56): builds the tree, runs useExploreState,
// and lays out the list rail and the map filling the rest. The selected place opens in a
// card floating over the map's left edge, beside the rail; it stays hidden until a place
// is picked and folds down to a tab. The map never resizes for it: the pins re-frame
// into the room the card leaves clear.
//
// The map always carries every place's pin. It moves on purpose only: a pick in the rail (a
// row or a breadcrumb) frames that place and the places inside it, zooming as it needs to;
// a pin click, the card opening or a pick off screen slides the view at the same zoom. Hover
// never moves it, and LocationMap keys off marker *values*, so browsing loads no new tiles.
//
// Desktop and tablet only: phones get MobilePlacesExplore (#1118).

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import LocationMap from '@/app/components/LocationMap';
import { collapseEmptyIntermediaries, type PlaceTreeNode } from '@/lib/places/hierarchy';
import { findNodeById, useExploreState } from './useExploreState';
import { ExploreDrill } from './ExploreDrill';
import { ExploreDetail, PlaceCardActions } from './ExploreDetail';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { ScrollArea } from '@/app/components/ui/ScrollArea';
import { Card } from '@/app/components/ui';
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

  // Every place's pin stays on the map whatever level the rail is at: drilling into a
  // country frames it (below) rather than taking the rest of the world's pins away.
  const markers = useMemo(() => collectPins(displayRoots), [displayRoots]);
  const drawnIds = useMemo(() => new Set(markers.map((m) => m.id)), [markers]);

  const openFullPage = (node: PlaceTreeNode) =>
    router.push(placeHref(node));

  // Select inline — EXCEPT for a place with no gazetteer row. Selection is
  // id-based (it round-trips through ?sel=<id>), so an id-less row could only ever
  // select "nothing": the click cleared the pane and looked broken. Global search
  // made those rows reachable from any jurisdiction, so send them to the full page,
  // which can also address a place by name.
  const onRowClick = (node: PlaceTreeNode) => (node.id == null ? openFullPage(node) : state.select(node));

  // A pick in the rail — a row or a breadcrumb — also frames the place and the places
  // inside it in the open part of the map, zooming as it needs to; other pins may fall
  // outside. Nothing else zooms: a pin is already on screen, so a pin click only slides
  // the map to clear it of the card.
  const [frameTarget, setFrameTarget] = useState<{ n: number; points: { lat: number; lng: number }[] } | null>(null);
  const frame = (nodes: readonly PlaceTreeNode[]) => {
    const points = nodes.flatMap((n) => pinsWithin(n)).map(({ lat, lng }) => ({ lat, lng }));
    if (points.length > 0) setFrameTarget((f) => ({ n: (f?.n ?? 0) + 1, points }));
  };
  const onRailClick = (node: PlaceTreeNode) => {
    onRowClick(node);
    if (node.id != null) frame([node]);
  };
  // The breadcrumbs go up a level; they frame the level they land on, or the whole tree.
  const railState = {
    ...state,
    goTo: (id: number | null) => {
      state.goTo(id);
      const node = findNodeById(displayRoots, id);
      frame(node ? [node] : displayRoots);
    },
  };

  // A pin click takes the rail to the pin's place wherever it is in the tree — the list
  // it sits in, with it selected (a place with places inside opens on them) — the same
  // way the card's quick picks do. Markers only carry ids for places that have one.
  const onMarkerClick = (id: number) => {
    const node = findNodeById(displayRoots, id);
    if (node) state.reveal(node);
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
  //
  // The selected place stays lit too, alongside whatever is hovered.
  const selectedId = state.selected?.id ?? null;
  const highlightedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const id of [hoveredId, selectedId]) {
      const node = findNodeById(displayRoots, id);
      if (node) pinsWithin(node).forEach((p) => ids.add(p.id));
    }
    return [...ids];
  }, [displayRoots, hoveredId, selectedId]);
  // The selected and the hovered place each name their pin when they come down to one
  // drawn pin (a town, or a county with one geocoded town), so both can be named at once.
  const labelledIds = useMemo(() => {
    const out: number[] = [];
    for (const id of [hoveredId, selectedId]) {
      const node = findNodeById(displayRoots, id);
      const drawn = node ? pinsWithin(node).filter((p) => drawnIds.has(p.id)) : [];
      if (drawn.length === 1) out.push(drawn[0].id);
    }
    return out;
  }, [displayRoots, hoveredId, selectedId, drawnIds]);

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

  // The card: hidden until a place is picked, folded to a tab by its chevron. Folded
  // stays folded: picking another place only renames the tab.
  const stacked = useIsMobile('lg');
  const [collapsed, setCollapsed] = useState(false);
  const selected = state.selected;
  const cardOpen = selected != null && !collapsed;
  const fitInsets = cardOpen ? { top: 0, right: 0, bottom: 0, left: CARD_GAP + CARD_W } : NO_INSETS;

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
          labelledIds={labelledIds}
          fitMargin={FIT_MARGIN}
          refitOnResize
          fitInsets={fitInsets}
          focusId={selected?.id ?? null}
          frameTarget={frameTarget}
          controlsCorner="top-right"
        />
      )}
      {selected && collapsed && (
        <Card pad={false} className="explore-card absolute top-4 left-4 z-[2] flex items-center gap-1 p-1.5">
          <PlaceCardActions placeId={selected.id} placeName={selected.name} onExpand={() => setCollapsed(false)} />
        </Card>
      )}
      {selected && !collapsed && (
        // The map's zoom buttons sit top-right here, so the card has the left edge to itself.
        <Card pad={false} role="region" aria-label={t('explore_card_label')}
          className="explore-card absolute left-4 z-[2] flex flex-col overflow-hidden"
          // As tall as its content, up to the map's height less a margin each end;
          // past that the content scrolls inside it.
          style={{ top: CARD_GAP, maxHeight: `calc(100% - ${CARD_GAP * 2}px)`, width: `min(${CARD_W}px, calc(100% - 96px))` }}>
          <ScrollArea className="min-h-0">
            <ExploreDetail
              placeName={selected.name}
              placeId={selected.id ?? null}
              treeId={treeId}
              onPickPlace={(id) => { const node = findNodeById(displayRoots, id); if (node) state.reveal(node); }}
              onCollapse={() => setCollapsed(true)}
            />
          </ScrollArea>
        </Card>
      )}
    </div>
  );

  return (
    <div className="explore-workspace flex-1 min-h-0 grid" style={{ gridTemplateColumns: `${stacked ? RAIL_W_NARROW : RAIL_W}px minmax(0,1fr)` }}>
      <div className="min-h-0 flex flex-col bg-card border-r border-border">
        <ExploreDrill
          state={railState}
          search={search}
          onRowClick={onRailClick}
          onRowHover={onRowHover}
          onClearSearch={onClearSearch}
        />
      </div>
      {map}
    </div>
  );
}

/** A place's own pin and those of every place inside it: what lights up for it, and
 *  what a rail pick frames. */
function pinsWithin(node: PlaceTreeNode): { id: number; lat: number; lng: number }[] {
  const out: { id: number; lat: number; lng: number }[] = [];
  const walk = (n: PlaceTreeNode) => {
    if (n.id != null && n.latitude != null && n.longitude != null) out.push({ id: n.id, lat: n.latitude, lng: n.longitude });
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

/** Extra room around framed pins: a tenth of the map's width and height. */
const FIT_MARGIN = 0.1;

const RAIL_W = 320;
const RAIL_W_NARROW = 300;
/** The floating card's width, and its gap from the map's edges. */
const CARD_W = 340;
const CARD_GAP = 16;
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
