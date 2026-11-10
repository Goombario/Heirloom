'use client';

// Composes the Explore view: builds the tree, runs useExploreState, and lays out the two
// elevation levels — a map RECESSED into the page (level −1, inset shadow, no card frame)
// above ONE raised panel (level +2) holding the index rail and the detail side by side.
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
import { collectPins } from './collectPins';
import { MapPin } from '@/lib/icons';
import { usePrefetchPlaceDetail } from '@/lib/places/prefetch';
import { placeHref } from '@/lib/places/place-key';

export interface ExploreViewProps {
  /** The UNFILTERED jurisdiction tree (page.tsx built it via buildPlaceTree). Explore
   *  applies the query itself, inside the drill, so it can match globally. */
  roots: PlaceTreeNode[];
  treeId: number | null;
  /** Hero search query, shared across views. */
  search: string;
}

export function ExploreView({ roots, treeId, search }: ExploreViewProps) {
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

  const shortName = (name: string) => name.split(',')[0]?.trim() ?? name;

  return (
    <div>
      {/* Level −1: the map is recessed into the page — inset shadow, no border, no
          Card. It is the only element in the system with no frame that still needs
          definition, and an inner shadow gives it depth without adding a card. */}
      {/* No place in view has coordinates (most GEDCOMs carry none): no map well
          at all, just a line saying how to get one (FR-5; #765 sized it before). */}
      {markers.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-text-muted">
          <MapPin size={16} className="shrink-0" aria-hidden="true" />
          {t('map_none_explore')}
        </p>
      ) : (
        <div
          className="relative h-[400px] rounded-2xl overflow-hidden"
          style={{ background: 'var(--map-well-bg)' }}
        >
          <LocationMap
            markers={markers}
            variant="full"
            height={400}
            onMarkerClick={onMarkerClick}
            onMarkerHover={onMarkerHover}
            highlightedIds={highlightedIds}
          />
          {/* The well shadow lives on this overlay, NOT on the parent: an inset shadow
              paints beneath in-flow children, and MapLibre's canvas fills the box exactly
              (measured 1104x400 at offset 0,0), so once tiles loaded the recess vanished
              — only the childless skeleton ever showed it. pointer-events-none keeps the
              map draggable through it. */}
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl"
            style={{ boxShadow: 'var(--map-well-shadow)' }}
            aria-hidden="true"
          />
          {/* Bottom-LEFT, not bottom-right: MapLibre anchors its attribution bottom-right,
              and that is a licensing element rather than chrome — it must stay legible, so
              the caption yields. The zoom control is top-left, so this corner is free. */}
          <div className="absolute left-4 bottom-4 rounded-md border border-border bg-[color:var(--card)]/80 px-2.5 py-1.5 text-xs text-text-muted pointer-events-none">
            {state.currentNode
              ? t('explore_map_caption', { place: shortName(state.currentNode.name), count: markers.length })
              : t('explore_map_caption_all', { count: markers.length })}
          </div>
        </div>
      )}

      {/* Level +2: ONE raised panel holding index + detail. They are one task ("pick
          a place, read the place"); merging them removes the empty-detail dead zone
          and the mid-page gap that made the old layout read as three loose slabs. */}
      <div
        className="mt-[18px] rounded-2xl border border-border bg-card overflow-hidden grid grid-cols-1 md:grid-cols-[300px_1fr] lg:grid-cols-[372px_1fr]"
        style={{ boxShadow: 'var(--panel-shadow)' }}
      >
        {/* The DETAIL pane sets the panel's height; the rail only fills it.
            Removing the rail's 520px cap (#467) let a long level drive the row
            instead — at the root, 43 places made a tall panel beside an empty
            detail pane. The rail's content is taken out of the row's intrinsic
            height (absolutely positioned inside a stretched grid cell) so it can
            only ever scroll within whatever height the detail pane asks for, with
            `min-h` as the floor for short/empty details.

            Desktop only: below `md` the detail pane is `hidden`, so there is no
            second cell to set the height and the rail must lay out normally —
            it grows and the page scrolls, which is the right touch behaviour. */}
        <div className="bg-card-alt border-b md:border-b-0 md:border-r border-border flex flex-col md:relative md:min-h-[360px]">
          <div className="flex flex-col md:absolute md:inset-0">
            <ExploreDrill
              state={state}
              search={search}
              onRowClick={onRowClick}
              onRowHover={onRowHover}
            />
          </div>
        </div>
        {/* Detail is desktop/tablet only — a mobile row tap routes to the full page. */}
        <div className="hidden md:flex flex-col min-h-[360px]">
          <ExploreDetail placeName={state.selected?.name ?? null} placeId={state.selected?.id ?? null} treeId={treeId} />
        </div>
      </div>
    </div>
  );
}
