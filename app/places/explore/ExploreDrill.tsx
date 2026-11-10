'use client';

// The browse column: pinned breadcrumb + a scrollable list of the current level's children.
// Parent rows carry the amber `N ›` drill signifier (the ONLY "go deeper" cue — distinct from
// the geocode pin mark); leaves show a plain count. Row click → select (or onRowClick override
// on mobile); row hover → warm the place detail. The hero search is GLOBAL here: Explore is
// handed the UNFILTERED tree, and a non-empty query flattens the whole thing to name matches
// so a hit in another branch shows without navigating there first (the other views still take
// the pruned tree page.tsx builds).

import { useTranslations } from 'next-intl';
import { ScrollArea } from '@/app/components/ui/ScrollArea';
import { ChevronRight } from '@/lib/icons';
import { usePrefetchPlaceDetail } from '@/lib/places/prefetch';
import { PinMark, FaceStack } from '../PinMark';
import { flattenWithAncestry, label, levelRows, matchesQuery } from './drillRows';
import type { PlaceTreeNode } from '@/lib/places/hierarchy';
import type { ExploreState } from './useExploreState';
import { foldForSearch } from '@/lib/utils/search-fold';
import type { PlaceKey } from '@/lib/places/place-key';

function DrillRow({ node, region: reg, selected, onSelect, prefetch, onHover }: {
  node: PlaceTreeNode; region: string; selected: boolean; onSelect: () => void;
  prefetch: (place: PlaceKey) => void; onHover?: (node: PlaceTreeNode | null) => void;
}) {
  const t = useTranslations('places');
  const hasChildren = node.children.length > 0;
  // Pointing at a row already warms its detail; it now also names the row's pin on the
  // map (#416). Focus counts as pointing — keyboard browsing gets the same highlight.
  const enter = () => { prefetch(node.id ?? node.name); onHover?.(node); };
  const leave = () => onHover?.(null);
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
      style={selected ? { boxShadow: 'inset 2px 0 0 var(--color-text), 0 1px 3px rgba(0,0,0,.10)' } : undefined}
      className={`w-full flex items-center gap-2 px-2.5 py-2 min-h-[44px] rounded-lg text-left transition-colors focus-ring ${
        selected ? 'bg-card' : 'hover:bg-[color:var(--color-hover-surface)]'
      }`}
    >
      <PinMark state={node.pinState} />
      {/* The NAME outranks the region. Both were plain flex items with `truncate`, so
          they shrank together and a short name like "Minster" was clipped to "Mins…"
          to make room for a subtitle nobody is scanning by. The name now yields only
          after the region has given up everything it can, and takes at most 70% of the
          row so a very long one still cannot swallow it whole. */}
      <span className="flex-1 min-w-0 flex items-baseline gap-2">
        <span className="serif text-sm font-semibold text-text truncate shrink-0 max-w-[70%]">{label(node.name)}</span>
        {reg && <span className="min-w-0 text-xs text-text-muted truncate">{reg}</span>}
      </span>
      <span className="ml-auto flex items-center gap-2.5 shrink-0 text-text-muted">
        <FaceStack faces={node.faces} />
        {hasChildren ? (
          // "Go deeper" disclosure — a neutral count + forward chevron, deliberately NOT the
          // amber/mono source-chip styling (which reads as a citation count).
          <span className="inline-flex items-center gap-0.5" title={t('explore_subplaces', { count: node.children.length })}>
            <span className="text-xs tabular-nums">{node.children.length}</span>
            <ChevronRight size={16} aria-hidden="true" />
          </span>
        ) : (
          <span className="text-xs tabular-nums pr-1">{node.ownCount}</span>
        )}
      </span>
    </button>
  );
}

export interface ExploreDrillProps {
  state: ExploreState;
  /** Hero search query (shared across views). */
  search: string;
  /** Overrides row-click (mobile navigates to the full detail page instead of selecting). */
  onRowClick?: (node: PlaceTreeNode) => void;
  /** Notified as the pointer/focus enters and leaves a row (null on leave), so the map
   *  can highlight the matching pin. Omitted on mobile, where there is no hover. */
  onRowHover?: (node: PlaceTreeNode | null) => void;
}

export function ExploreDrill({ state, search, onRowClick, onRowHover }: ExploreDrillProps) {
  const t = useTranslations('places');
  const prefetch = usePrefetchPlaceDetail();
  const q = foldForSearch(search.trim());
  // Search is GLOBAL: a query matches every place in the tree, not only the
  // jurisdiction you happen to be standing in. Matching the current subtree meant
  // a hit two levels up was unreachable without manually navigating there first.
  const searching = q.length > 0;
  // Search rows carry gazetteer ancestry as their region text (#417); level rows
  // keep the name-derived region, because every row is a child of the jurisdiction
  // the breadcrumb already names.
  const rows = searching
    ? flattenWithAncestry(state.roots).filter((row) => matchesQuery(row, q))
    : levelRows(state.children);

  const parentLabel = state.currentNode ? label(state.currentNode.name) : null;
  // The deepest crumb is the jurisdiction being browsed — `crumbs` is the inclusive
  // root→current path — and it used to render identically to its ancestors, so a
  // click that drilled in looked like it selected nothing (#448).
  //
  // It stays a BUTTON. `currentNode` and `selected` diverge the moment you pick a
  // leaf child: the level stays put while the detail pane moves to the leaf, and
  // clicking the tail is how you get the jurisdiction's own detail back. Making it
  // inert forced a trip up to the parent and back down.
  //
  // So the visual treatment marks "the level you are in" (PinMark + weight), while
  // `aria-current="page"` marks what the detail pane is actually showing — which is
  // the tail only while the two agree.
  const atRoot = !searching && state.crumbs.length === 0;
  const lastCrumbIndex = state.crumbs.length - 1;
  const isShown = (id: number | null) => id != null && state.selected?.id === id;

  return (
    <div className="flex flex-col h-full">
      {/* Header band — the breadcrumb. Pinned: the row list below scrolls, the
          breadcrumb does not. The row count lives only in the labelled footer (#752). */}
      <nav
        className="flex items-center gap-1.5 flex-wrap px-4 pt-3.5 pb-3 border-b border-border-light text-xs text-text-muted"
        aria-label={t('breadcrumb')}
      >
        <button
          type="button"
          onClick={() => state.goTo(null)}
          aria-current={atRoot && state.selected == null ? 'page' : undefined}
          className={`cursor-pointer rounded focus-ring ${
            atRoot ? 'font-semibold text-text' : 'hover:text-text'
          }`}
        >
          {t('explore_all_places')}
        </button>
        {searching ? (
          <span className="text-text-muted">· {t('explore_searching_all')}</span>
        ) : (
          state.crumbs.map((c, i) => (
            <span key={c.id ?? c.name} className="flex items-center gap-1.5">
              <span aria-hidden="true">›</span>
              {i === lastCrumbIndex ? (
                // The level you are in. Distinguished from its ancestors by its
                // geocode PinMark and a step of weight — neither of them colour —
                // while staying clickable, because this is the way back to the
                // jurisdiction's own detail after drilling into a leaf child.
                <button
                  type="button"
                  onClick={() => state.goTo(c.id)}
                  aria-current={isShown(c.id) ? 'page' : undefined}
                  className="inline-flex items-center gap-1.5 serif font-bold text-text hover:underline underline-offset-[3px] cursor-pointer truncate max-w-[140px] rounded focus-ring"
                >
                  <PinMark state={c.pinState} />
                  {label(c.name)}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => state.goTo(c.id)}
                  className="serif font-semibold text-text underline decoration-border underline-offset-[3px] hover:decoration-current cursor-pointer truncate max-w-[120px] rounded focus-ring"
                >
                  {label(c.name)}
                </button>
              )}
            </span>
          ))
        )}
      </nav>

      {/* ScrollArea, not a bare overflow div: themed rail in dark mode, and the
          rail stays painted so rows do not jump sideways the moment a
          jurisdiction has enough children to overflow. */}
      {/* `min-h-0`, not a `max-h` cap: the panel is a two-column grid whose cells
          already stretch to the row height, so a 520px ceiling here left the rail
          scrolling with dead space beneath it while the detail pane ran on (#467).
          `flex-1` alone cannot shrink a flex child below its content — min-h-0 is
          what lets this become the scroll container. */}
      <ScrollArea className="flex-1 min-h-0 p-1.5">
        {rows.length === 0 ? (
          <p className="text-xs text-text-muted py-6 text-center">{t('no_results')}</p>
        ) : (
          rows.map(({ node, region }) => (
            <DrillRow
              key={node.id ?? node.name}
              node={node}
              region={region}
              selected={state.selected?.id != null && state.selected.id === node.id}
              onSelect={() => (onRowClick ? onRowClick(node) : state.select(node))}
              prefetch={prefetch}
              onHover={onRowHover}
            />
          ))
        )}
      </ScrollArea>

      {/* Footer band — what the list is currently showing. */}
      <div className="px-4 py-2.5 border-t border-border-light text-meta text-text-muted">
        {searching
          ? t('explore_match_count', { count: rows.length })
          : parentLabel
            ? t('explore_places_in', { count: rows.length, parent: parentLabel })
            : t('explore_places_root', { count: rows.length })}
      </div>
    </div>
  );
}
