'use client';

// Places on phones (#1118, Explore option A): a 16:10 map strip that scrolls away and
// refits only when you drill, the filter field with the trail under it, and one drill
// list. A parent row drills in (its count and chevron say so); a leaf opens the place
// page. A drilled level starts with an "Open <place>" row for the place itself. Explore
// is the only phone view; Cards and List stay on desktop.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import LocationMap from '@/app/components/LocationMap';
import { MobileListFilters, MobileListMeta, MobileRow, cx } from '@/app/components/ui';
import { useElementWidth } from '@/app/hooks/useElementWidth';
import { ChevronRight, MapPin } from '@/lib/icons';
import { collapseEmptyIntermediaries, type PlaceTreeNode } from '@/lib/places/hierarchy';
import { usePrefetchPlaceDetail } from '@/lib/places/prefetch';
import { foldForSearch } from '@/lib/utils/search-fold';
import GuardedLink from '@/app/components/GuardedLink';
import { FaceStack, PinMark } from '../PinMark';
import { collectPins } from './collectPins';
import { flattenWithAncestry, label, levelRows, matchesQuery } from './drillRows';
import { findNodeById, useExploreState } from './useExploreState';
import { placeHref } from '@/lib/places/place-key';

export function MobilePlacesExplore({ roots }: { roots: PlaceTreeNode[] }) {
  const t = useTranslations('places');
  const tm = useTranslations('mobilePlaces');
  const router = useRouter();
  const prefetch = usePrefetchPlaceDetail();
  const displayRoots = useMemo(() => collapseEmptyIntermediaries(roots), [roots]);
  const state = useExploreState(displayRoots);
  const [query, setQuery] = useState('');
  const [stripRef, stripWidth] = useElementWidth<HTMLDivElement>();

  const markers = useMemo(
    () => collectPins(state.currentNode ? [state.currentNode] : displayRoots),
    [state.currentNode, displayRoots],
  );

  const q = foldForSearch(query.trim());
  const searching = q.length > 0;
  const rows = searching
    ? flattenWithAncestry(displayRoots).filter((row) => matchesQuery(row, q))
    : levelRows(state.children);
  const here = searching ? null : state.currentNode;

  const counts = (n: PlaceTreeNode) => tm('people_records', { people: n.peopleCount, records: n.rolledCount });
  // The first tap on a pin names it; a second tap on the same pin is the same act as its
  // row: drill into a parent, open a leaf (the owner's phone review of #1117).
  const [picked, setPicked] = useState<number | null>(null);
  // A drill changes the pins; a picked pin that isn't on the map any more is forgotten.
  const pickedNode = picked != null && markers.some((m) => m.id === picked) ? findNodeById(displayRoots, picked) : null;
  const pickedId = pickedNode?.id ?? null;
  const pickedIds = pickedId != null ? [pickedId] : [];
  const onMarkerClick = (id: number) => {
    const node = findNodeById(displayRoots, id);
    if (!node) return;
    if (pickedNode?.id !== id) { setPicked(id); return; }
    setPicked(null);
    if (node.children.length > 0) state.goTo(node.id);
    else router.push(placeHref(node));
  };

  return (
    <div className="md:hidden">
      {markers.length === 0 ? (
        <p className="m-0 flex items-start gap-2.5 px-4 py-3.5 border-b border-border text-sm leading-snug text-text-muted">
          <MapPin className="w-[18px] h-[18px] shrink-0 mt-px" aria-hidden="true" />
          {t('map_none_explore')}
        </p>
      ) : (
        <div ref={stripRef} className="relative aspect-[16/10] border-b border-border overflow-hidden" style={{ background: 'var(--map-well-bg)' }}>
          {stripWidth > 0 && (
            <LocationMap markers={markers} variant="mini" gestures height={Math.round(stripWidth * 10 / 16)}
              onMarkerClick={onMarkerClick} highlightedIds={pickedIds} onBackgroundClick={() => setPicked(null)} />
          )}
          <span aria-live="polite" className="absolute left-2.5 bottom-2.5 max-w-[calc(100%-20px)] rounded-lg border border-border bg-[color:var(--card)]/85 px-2.5 py-1 text-meta text-text-secondary pointer-events-none">
            {pickedNode
              ? tm(pickedNode.children.length > 0 ? 'pin_again_drill' : 'pin_again_open', { place: label(pickedNode.name) })
              : state.currentNode
                ? t('explore_map_caption', { place: label(state.currentNode.name), count: markers.length })
                : t('explore_map_caption_all', { count: markers.length })}
          </span>
        </div>
      )}

      <MobileListFilters value={query} onChange={setQuery} placeholder={tm('filter_places')}>
        {searching ? null : (
          <nav aria-label={t('breadcrumb')} className="flex items-center gap-0.5 -mx-1 -my-2 whitespace-nowrap text-sm text-text-muted">
            <TrailButton current={state.crumbs.length === 0} onClick={() => state.goTo(null)}>{t('explore_all_places')}</TrailButton>
            {state.crumbs.map((c, i) => (
              <span key={c.id ?? c.name} className="inline-flex items-center gap-0.5">
                <span aria-hidden="true" className="opacity-70">›</span>
                <TrailButton current={i === state.crumbs.length - 1} onClick={() => state.goTo(c.id)}>{label(c.name)}</TrailButton>
              </span>
            ))}
          </nav>
        )}
      </MobileListFilters>

      {here && (
        <MobileRow
          href={placeHref(here)}
          icon={<MapPin />}
          end="leave"
          label={tm('open_place', { place: label(here.name) })}
          sub={counts(here)}
        />
      )}
      <MobileListMeta count={searching
        ? t('explore_match_count', { count: rows.length })
        : here
          ? t('explore_places_in', { count: rows.length, parent: label(here.name) })
          : t('explore_places_root', { count: rows.length })}
      />
      {rows.length === 0 ? (
        <p className="m-0 px-4 py-6 text-base text-text-muted">{t('no_results')}</p>
      ) : (
        <ul className="m-0 p-0 list-none">
          {rows.map(({ node, region }, i) => {
            const drills = !searching && node.children.length > 0;
            const body = (
              <>
                <span className="grid place-items-center w-3.5 shrink-0"><PinMark state={node.pinState} /></span>
                <span className="flex-1 min-w-0 grid gap-0.5">
                  <span className="serif font-semibold text-md leading-tight text-text truncate">{label(node.name)}</span>
                  <span className="text-meta text-text-muted truncate">{searching ? region || tm('top_level') : counts(node)}</span>
                </span>
                <FaceStack faces={node.faces.slice(0, 3)} />
                {drills && (
                  <span className="inline-flex items-center justify-end gap-0.5 min-w-11 font-mono text-meta text-text-muted" title={t('explore_subplaces', { count: node.children.length })}>
                    {node.children.length}
                    <ChevronRight className="w-[18px] h-[18px]" aria-hidden="true" />
                  </span>
                )}
              </>
            );
            const cls = cx(
              'flex w-full items-center gap-3 min-h-14 px-4 py-2.5 text-left no-underline cursor-pointer active:bg-surface-2 focus-ring-inset',
              i > 0 && 'border-t border-border',
            );
            return (
              <li key={node.id ?? node.name}>
                {drills ? (
                  <button type="button" className={cls} onClick={() => { state.goTo(node.id); window.scrollTo({ top: 0 }); }}
                    aria-label={tm('show_places_in', { place: label(node.name), count: node.children.length })}>
                    {body}
                  </button>
                ) : (
                  <GuardedLink href={placeHref(node)} className={cls} onFocus={() => prefetch(node.id ?? node.name)} onTouchStart={() => prefetch(node.id ?? node.name)}>
                    {body}
                  </GuardedLink>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div aria-hidden="true" style={{ height: 'calc(40px + env(safe-area-inset-bottom, 0px))' }} />
    </div>
  );
}

function TrailButton({ current, onClick, children }: { current: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? 'location' : undefined}
      className={cx(
        'min-h-11 px-1 rounded focus-ring cursor-pointer',
        current
          ? 'serif font-semibold text-md text-text'
          : 'font-medium text-sm text-text-secondary underline decoration-border underline-offset-[3px]',
      )}
    >
      {children}
    </button>
  );
}
