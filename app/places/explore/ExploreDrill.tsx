'use client';

// The browse column: pinned breadcrumb + a scrollable list of the current level's children.
// Parent rows carry the amber `N ›` drill signifier (the ONLY "go deeper" cue — distinct from
// the geocode pin mark); leaves show a plain count. Row click → select (or onRowClick override
// on mobile); row hover → warm the place detail. The hero search is GLOBAL here: Explore is
// handed the UNFILTERED tree, and a non-empty query flattens the whole thing to name matches
// so a hit in another branch shows without navigating there first (the other views still take
// the pruned tree page.tsx builds).

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ScrollArea } from '@/app/components/ui/ScrollArea';
import { ArrowDown, ArrowUp, ChevronRight } from '@/lib/icons';
import { usePrefetchPlaceDetail } from '@/lib/places/prefetch';
import { PinMark, FaceStack } from '../PinMark';
import { flattenWithAncestry, label, levelRows, matchesQuery, type DrillRowData } from './drillRows';
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
  const name = label(node.name);
  // The kind line (#56): where it sits, then how many places are inside it. The kind
  // of place itself ("City") waits on #45.
  const kind = [reg, hasChildren ? t('explore_subplaces', { count: node.children.length }) : ''].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
      title={node.name}
      aria-current={selected ? 'true' : undefined}
      className={`explore-row w-full grid items-center gap-x-2.5 px-3 py-2 min-h-[52px] text-left transition-colors focus-ring-inset border-l-2 ${
        selected ? 'bg-surface-2 border-l-[color:var(--color-segment-on)]' : 'border-l-transparent hover:bg-[color:var(--color-hover-surface)]'
      }`}
    >
      <PinMark state={node.pinState} />
      {/* The name is clamped to two lines, the kind line to one; the full name is
          the row's tooltip. A long single word breaks at the column edge. */}
      <span className="min-w-0">
        <span className="serif text-sm font-semibold text-text line-clamp-2 break-words">{name}</span>
        {kind && <span className="block text-xs text-text-muted truncate">{kind}</span>}
      </span>
      {/* Up to three faces, no "+N"; the column keeps its width when there are none. */}
      <span className="explore-row__faces flex justify-end"><FaceStack faces={node.faces.slice(0, 3)} /></span>
      <span className={`explore-row__count text-right text-xs tabular-nums ${node.rolledCount === 0 ? 'text-text-muted opacity-70' : 'text-text-secondary'}`}>
        {node.rolledCount.toLocaleString()}
      </span>
      <span className="w-4 flex justify-end text-text-muted">
        {hasChildren && <ChevronRight size={16} aria-hidden="true" />}
      </span>
    </button>
  );
}

/** How the rail orders a level (#56). Saved as a preference, not kept in the URL. */
export type ExploreSort = 'records-desc' | 'records-asc' | 'name-asc' | 'name-desc';
const SORT_KEY = 'places-explore-sort';
const SORTS: ExploreSort[] = ['records-desc', 'records-asc', 'name-asc', 'name-desc'];

function sortRows(rows: DrillRowData[], sort: ExploreSort): DrillRowData[] {
  if (sort === 'records-desc') return rows; // the tree's own order: records, then pinned, then name
  const byName = (a: DrillRowData, b: DrillRowData) => label(a.node.name).localeCompare(label(b.node.name));
  const out = [...rows];
  if (sort === 'records-asc') out.sort((a, b) => a.node.rolledCount - b.node.rolledCount || byName(a, b));
  else if (sort === 'name-asc') out.sort(byName);
  else out.sort((a, b) => byName(b, a));
  return out;
}

function readSort(): ExploreSort {
  try {
    const saved = typeof window === 'undefined' ? null : localStorage.getItem(SORT_KEY) as ExploreSort | null;
    return saved && SORTS.includes(saved) ? saved : 'records-desc';
  } catch {
    return 'records-desc';
  }
}

function useExploreSort(): [ExploreSort, (s: ExploreSort) => void] {
  // A lazy read is hydration-safe here: the rail only renders after the client-side
  // places fetch, so the server never paints it (as useExploreState's URL read).
  const [sort, setSort] = useState<ExploreSort>(readSort);
  const save = (next: ExploreSort) => {
    setSort(next);
    try { localStorage.setItem(SORT_KEY, next); } catch { /* ignore */ }
  };
  return [sort, save];
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
  /** Clears the bar's filter, from the "no matches" line. */
  onClearSearch?: () => void;
}

function SortHead({ label: text, state, active, dir, onClick, align }: {
  label: string; state: string | undefined; active: boolean; dir: 'up' | 'down'; onClick: () => void; align?: 'right';
}) {
  const Icon = dir === 'up' ? ArrowUp : ArrowDown;
  return (
    <button type="button" onClick={onClick} title={state}
      className={`inline-flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer rounded focus-ring ${align === 'right' ? 'justify-self-end' : ''} ${active ? 'text-text font-semibold' : 'hover:text-text'}`}>
      {text}
      {active && <Icon size={12} aria-hidden="true" />}
      {state && <span className="sr-only">, {state}</span>}
    </button>
  );
}

/** The folded middle of a deep breadcrumb: "…" opens a menu of those levels. */
function CrumbFold({ crumbs, onPick }: { crumbs: PlaceTreeNode[]; onPick: (id: number | null) => void }) {
  const t = useTranslations('places');
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <span ref={wrap} className="relative">
      <button type="button" aria-expanded={open} aria-label={t('breadcrumb_more')} title={t('breadcrumb_more')}
        onClick={() => setOpen((o) => !o)}
        className="px-1 rounded bg-transparent border-0 cursor-pointer text-text hover:bg-hover-surface focus-ring">…</button>
      {open && (
        <span className="absolute left-0 top-full mt-1 z-30 flex flex-col min-w-44 p-1 rounded-lg border border-border bg-card shadow-[var(--shadow-lg)]">
          {crumbs.map((c) => (
            <button key={c.id ?? c.name} type="button" onClick={() => { setOpen(false); onPick(c.id); }}
              className="text-left px-2.5 py-1.5 rounded-md text-sm text-text serif hover:bg-hover-surface cursor-pointer bg-transparent border-0 focus-ring-inset">
              {label(c.name)}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export function ExploreDrill({ state, search, onRowClick, onRowHover, onClearSearch }: ExploreDrillProps) {
  const t = useTranslations('places');
  const prefetch = usePrefetchPlaceDetail();
  const q = foldForSearch(search.trim());
  const [sort, setSort] = useExploreSort();
  // Search is GLOBAL: a query matches every place in the tree, not only the
  // jurisdiction you happen to be standing in. Matching the current subtree meant
  // a hit two levels up was unreachable without manually navigating there first.
  const searching = q.length > 0;
  // Search rows carry gazetteer ancestry as their region text (#417); level rows
  // keep the name-derived region, because every row is a child of the jurisdiction
  // the breadcrumb already names.
  const rows = sortRows(searching
    ? flattenWithAncestry(state.roots).filter((row) => matchesQuery(row, q))
    : levelRows(state.children), sort);
  // The count column widens for 4+ digits, the same width on every row of the level.
  const countWidth = `${Math.max(3, ...rows.map((r) => r.node.rolledCount.toLocaleString().length))}ch`;

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
  // A deep path folds its middle levels into "…", which opens a menu of them (#56).
  const folded = state.crumbs.length > 3 ? state.crumbs.slice(1, -2) : [];
  const shownCrumbs = folded.length > 0
    ? [{ crumb: state.crumbs[0], i: 0 }, ...state.crumbs.slice(-2).map((crumb, k) => ({ crumb, i: state.crumbs.length - 2 + k }))]
    : state.crumbs.map((crumb, i) => ({ crumb, i }));
  const sortBy = (col: 'name' | 'records') => {
    if (col === 'name') setSort(sort === 'name-asc' ? 'name-desc' : 'name-asc');
    else setSort(sort === 'records-desc' ? 'records-asc' : 'records-desc');
  };
  const ariaSort = (col: 'name' | 'records') =>
    col === 'name'
      ? (sort === 'name-asc' ? t('sort_az') : sort === 'name-desc' ? t('sort_za') : undefined)
      : (sort === 'records-desc' ? t('sort_most') : sort === 'records-asc' ? t('sort_fewest') : undefined);

  return (
    <div className="flex flex-col h-full" style={{ '--explore-count-w': countWidth } as React.CSSProperties}>
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
          shownCrumbs.map(({ crumb: c, i }) => (
            <span key={c.id ?? c.name} className="flex items-center gap-1.5">
              {i === state.crumbs.length - 2 && folded.length > 0 && (
                <>
                  <span aria-hidden="true">›</span>
                  <CrumbFold crumbs={folded} onPick={(id) => state.goTo(id)} />
                </>
              )}
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

      {/* The sortable column heads (#56). */}
      <div className="explore-row explore-row--head grid items-center gap-x-2.5 px-3 pt-2.5 pb-1.5 border-b border-border-light text-xs text-text-muted">
        <span aria-hidden="true" />
        <SortHead label={t('col_place')} state={ariaSort('name')} active={sort.startsWith('name')} dir={sort === 'name-desc' ? 'down' : 'up'} onClick={() => sortBy('name')} />
        <span />
        <SortHead label={t('col_records')} state={ariaSort('records')} active={sort.startsWith('records')} dir={sort === 'records-asc' ? 'up' : 'down'} onClick={() => sortBy('records')} align="right" />
        <span />
      </div>

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
          <div className="py-6 text-center">
            <p className="text-xs text-text-muted m-0">{t('no_results')}</p>
            {q.length > 0 && onClearSearch && (
              <button type="button" onClick={onClearSearch}
                className="mt-1.5 text-xs text-link underline bg-transparent border-0 cursor-pointer focus-ring">
                {t('clear_filter')}
              </button>
            )}
          </div>
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
