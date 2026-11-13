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

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import LocationMap from '@/app/components/LocationMap';
import { collapseEmptyIntermediaries, type PlaceTreeNode } from '@/lib/places/hierarchy';
import { findNodeById, useExploreState } from './useExploreState';
import { ExploreDrill } from './ExploreDrill';
import { ExploreDetail } from './ExploreDetail';
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

  // The selected-place pane is Narrow (420px) by default; Wide gives it more room.
  // Kept for the session only: the map takes whatever is left either way.
  const [wide, setWide] = useState(false);
  const picked = state.selected != null;

  return (
    // Three panes, each scrolling on its own (#56): the list rail, the selected place,
    // and the map filling the rest. Below lg there is no room for the map, so it drops
    // and the two panes share the width.
    // Until a place is chosen there is no middle pane on wide screens: the map takes
    // its room rather than an empty pane asking for a pick (locked places board).
    <div className={`explore-workspace flex-1 min-h-0 grid grid-cols-[300px_minmax(0,1fr)] ${!picked ? 'lg:grid-cols-[320px_minmax(0,1fr)]' : wide ? 'lg:grid-cols-[320px_640px_minmax(0,1fr)]' : 'lg:grid-cols-[320px_420px_minmax(0,1fr)]'}`}>
      <div className="min-h-0 flex flex-col bg-card border-r border-border">
        <ExploreDrill
          state={state}
          search={search}
          onRowClick={onRowClick}
          onRowHover={onRowHover}
          onClearSearch={onClearSearch}
        />
      </div>
      <div className={`min-h-0 flex flex-col bg-card border-r border-border relative${picked ? '' : ' lg:hidden'}`}>
        <button
          type="button"
          onClick={() => setWide((w) => !w)}
          aria-pressed={wide}
          className="hidden lg:inline-flex absolute top-3 right-3 z-10 items-center min-h-7 px-2 rounded-md border border-border bg-card text-xs text-text-secondary cursor-pointer hover:bg-hover-surface focus-ring"
        >
          {wide ? t('pane_narrow') : t('pane_wide')}
        </button>
        <ScrollArea className="flex-1 min-h-0">
          <ExploreDetail
            placeName={state.selected?.name ?? null}
            placeId={state.selected?.id ?? null}
            treeId={treeId}
            onPickPlace={(id) => { const node = findNodeById(displayRoots, id); if (node) onRowClick(node); }}
          />
        </ScrollArea>
      </div>
      <div className="hidden lg:block relative min-h-0" style={{ background: 'var(--map-well-bg)' }}>
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
          />
        )}
      </div>
    </div>
  );
}
