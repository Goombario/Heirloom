'use client';

// The detail surface filling the panel's right column beside the index rail — it renders
// NO card of its own (the panel is the card). Empty state = "select a place" prompt centred
// in that column (no fetch — key=null). On selection, reuse the shipped PlaceDetail payload
// via useCachedResource on the shared placeDetailKey (warm from the drill hover). Header:
// name · badges (geocoded uses a MapPin — NOT the inherited-diamond, per #266) · "Open full
// page →". Body is TWO columns: People (clickable → profile, warmed on hover, one entry per
// person with its linking facts stacked beneath the name) / Events + Place details stacked.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import PersonAvatar from '@/app/components/PersonAvatar';
import { initialsFromName } from '@/lib/utils/initials';
import { useCachedResource } from '@/app/components/useCachedResource';
import { placeDetailKey } from '@/lib/places/prefetch';
import { eventTypeLabel } from '@/lib/places/eventTypes';
import { usePlaceFactReason } from '../usePlaceFactReason';
import { groupFactLinks } from './groupFactLinks';
import { prefetchPerson } from '@/app/people/view/personCache';
import { ExploreDetailSkeleton } from './ExploreSkeleton';
import { warmThumbnails } from '@/lib/media/warmThumbnails';
import { ActionLink, SectionHeader } from '@/app/components/ui';
import { MapPin, ChevronRight } from '@/lib/icons';
import { sortableYear } from '@/lib/date-utils';
import type { PlaceDetail } from '@/lib/data/types';
import { placeHref } from '@/lib/places/place-key';

// The pane is a preview beside the drill, and every entry mounts a PersonAvatar
// (one media resolution each — an IndexedDB blob read in the static build). A
// country-level jurisdiction rolls up thousands of facts, so cap the rendered
// PEOPLE and point at the full page, which owns the complete list. Capping facts
// instead meant 60 rows could be a dozen people repeated.
const MAX_PREVIEW_PEOPLE = 60;
/** People here and Places within open at five rows, then expand in place (#56). */
const FIRST_ROWS = 5;
/** Reasons shown under one person before the "+N more facts" line. */
const MAX_REASONS_PER_PERSON = 3;
/** Avatar diameter for a person row — also the width the thumbnail warm targets,
 *  so the prefetch and the render ask for the same variant. */
const PERSON_AVATAR_SIZE = 30;

export interface ExploreDetailProps {
  /** Selected place name, or null for the empty state. */
  placeName: string | null;
  /** Its id (#1186), which addresses it when present. */
  placeId?: number | null;
  treeId: number | null;
  /** Picks a place listed under Places within, in Explore itself. */
  onPickPlace?: (id: number) => void;
}

export function ExploreDetail({ placeName, placeId, treeId, onPickPlace }: ExploreDetailProps) {
  const [allPeople, setAllPeople] = useState<string | null>(null);
  const [allPlaces, setAllPlaces] = useState<string | null>(null);
  const t = useTranslations('places');

  // Gate on placeName ONLY. `treeId` is null for the user's DEFAULT tree — the
  // normal case — and the server resolves that to the real tree itself. Requiring
  // it to be truthy meant the panel only ever fetched for users who had explicitly
  // switched to a non-default/shared tree, so everyone else saw "0 people linked"
  // with no network request at all. `placeDetailKey` maps null to 'default', which
  // is also the key the hover prefetch warms, so selection now paints instantly.
  const { data, loading } = useCachedResource<PlaceDetail>(
    placeName ? placeDetailKey(treeId, placeId ?? placeName) : null,
    async () => {
      const client = await getDataClient();
      return client.places.detail(placeId ?? placeName!, treeId);
    },
  );
  const detail = data ?? null;

  // One row per fact from the service, grouped into one entry per PERSON here: a
  // place page's job is to say *why* each person is tied to it, and one person can
  // be tied by several facts — but repeating the name once per fact let a single
  // person own three rows of a preview pane (tracker §16).
  const factRows = useMemo(() => detail?.factLinks ?? [], [detail]);
  const personGroups = useMemo(() => groupFactLinks(factRows), [factRows]);
  const linkedPeopleCount = personGroups.length;

  // Start the thumbnail reads as soon as the payload lands, rather than when each
  // row's lazy <img> mounts. The whole people list arrives in ONE fetch here, so
  // the media work can overlap the render instead of trailing it — which is what
  // makes the initials placeholder visible on a cold panel. Only the first
  // screenful (the warm helper's own cap) is worth it; the rest mount lazily as
  // they always did.
  useEffect(() => {
    warmThumbnails(
      personGroups.map((g) => ({ mediaId: g.primaryMediaId, focalRadius: g.focalRadius })),
      { containerWidth: PERSON_AVATAR_SIZE, treeId },
    );
  }, [personGroups, treeId]);

  /** "Born here Aug 17, 1966" / "Resided here 1920" — why this row exists. */
  const factReason = usePlaceFactReason();

  /** "· Buckland" — which sub-place a rolled-up fact actually happened in. Empty
   *  for a leaf place, where every fact carries the selected name itself. */
  const subPlace = useCallback((link: { placeName: string }): string => {
    if (!placeName || link.placeName === placeName) return '';
    return link.placeName.split(',')[0]?.trim() ?? link.placeName;
  }, [placeName]);

  const eventCounts = useMemo(() => {
    if (!detail) return [] as { type: string; label: string; count: number }[];
    const tally = new Map<string, number>();
    for (const e of detail.eventCounts) tally.set(e.type, (tally.get(e.type) ?? 0) + e.count);
    if (detail.familyCount > 0) tally.set('MARR', (tally.get('MARR') ?? 0) + detail.familyCount);
    return Array.from(tally.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, label: eventTypeLabel(type, t), count }));
  }, [detail, t]);

  // The selected place's first and last dated record, for the summary line and Years.
  const years = useMemo(() => {
    const ys = factRows.map((f) => sortableYear(f.date)).filter((y): y is number => y != null);
    return ys.length > 0 ? { first: Math.min(...ys), last: Math.max(...ys) } : null;
  }, [factRows]);

  if (!placeName) {
    // Centred inside the pane — NOT its own card. The pane keeps its width whether or
    // not something is selected, so choosing a place never moves the map.
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-10 text-center text-text-muted">
        <MapPin size={26} aria-hidden="true" className="opacity-60" />
        <p className="text-sm">{t('explore_select_prompt')}</p>
        <p className="text-xs opacity-85">{t('explore_drill_hint')}</p>
      </div>
    );
  }

  // Loading shape mirrors the loaded layout, so selecting a place does not collapse
  // the pane and push it back out when the payload lands.
  if (loading && !detail) {
    return (
      // Labelled here rather than inside the shared shape: ExploreSkeleton wraps
      // the same component in its own status region, and nesting two would
      // announce the load twice.
      <div role="status" aria-busy="true" aria-label={t('loading')}>
        <ExploreDetailSkeleton />
      </div>
    );
  }

  const short = placeName.split(',')[0]?.trim() ?? placeName;
  const partOf = detail?.parents && detail.parents.length > 0
    ? [...detail.parents].reverse().map((p) => p.name.split(',')[0]?.trim() ?? p.name)
    : placeName.includes(',') ? placeName.slice(placeName.indexOf(',') + 1).split(',').map((x) => x.trim()) : [];
  // Facts, matching the rows below and the people count beside it.
  const totalCount = factRows.length;
  const within = detail?.children ?? [];
  const peopleOpen = allPeople === placeName;
  const placesOpen = allPlaces === placeName;
  const people = personGroups.slice(0, peopleOpen ? MAX_PREVIEW_PEOPLE : FIRST_ROWS);
  const places = placesOpen ? within : within.slice(0, FIRST_ROWS);
  const summary = [
    detail ? t('people_linked', { count: linkedPeopleCount }) : null,
    detail ? t('records_total', { count: totalCount }) : null,
    years ? (years.first === years.last ? String(years.first) : `${years.first}–${years.last}`) : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col">
      {/* The place: name, the "Part of" chain, the counts line, and the way to its page. */}
      <div className="px-5 pt-5 pb-4 border-b border-border-light">
        <h2 className="serif text-2xl font-semibold text-text leading-tight m-0 break-words line-clamp-3" title={placeName}>{short}</h2>
        {partOf.length > 0 && (
          <p className="mt-1 mb-0 text-meta text-text-muted">{t('part_of_chain', { chain: partOf.join(' › ') })}</p>
        )}
        {summary && <p className="mt-1.5 mb-0 text-sm text-text-secondary tabular-nums">{summary}</p>}
        <div className="mt-2.5">
          <ActionLink kind="leave" href={placeHref({ id: placeId, name: placeName })}>{t('open_place_page')}</ActionLink>
        </div>
      </div>

      {/* People here: five rows, expanding in place (no link out). One entry per person,
          with the facts that tie them here stacked under the name. */}
      <section className="px-5 py-4 border-b border-border-light">
        <SectionHeader level="rail" title={t('people_here')} count={linkedPeopleCount} />
        {personGroups.length > 0 ? (
          <div className="flex flex-col">
            {people.map((group) => {
              const sex = group.sex === 'M' ? 'M' : group.sex === 'F' ? 'F' : null;
              const shown = group.facts.slice(0, MAX_REASONS_PER_PERSON);
              const hidden = group.facts.length - shown.length;
              return (
                <Link
                  key={group.personId}
                  href={`/people/view?id=${group.personId}`}
                  onMouseEnter={() => prefetchPerson(group.personId, treeId)}
                  onFocus={() => prefetchPerson(group.personId, treeId)}
                  className="flex items-start gap-2.5 -mx-2 px-2 py-2 min-h-[44px] rounded-lg hover:bg-[color:var(--color-hover-surface)] transition-colors focus-ring"
                >
                  {/* PersonAvatar, not Avatar: these people carry a primary
                      photo id, and showing initials for someone we have a
                      portrait of reads as "no photo on file". */}
                  <PersonAvatar
                    mediaId={group.primaryMediaId}
                    treeId={treeId}
                    sex={sex}
                    name={group.name}
                    initials={initialsFromName(group.name)}
                    focalX={group.focalX}
                    focalY={group.focalY}
                    focalRadius={group.focalRadius}
                    size={PERSON_AVATAR_SIZE}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="serif text-sm font-semibold text-text truncate">
                      {group.name || t('person_fallback', { id: group.personId })}
                    </div>
                    {shown.map((link, i) => {
                      const where = subPlace(link);
                      return (
                        <div key={`${link.kind}-${link.eventType ?? ''}-${link.date ?? ''}-${i}`} className="text-xs text-text-muted truncate">
                          {factReason(link)}
                          {where && <span className="opacity-85"> · {where}</span>}
                        </div>
                      );
                    })}
                    {hidden > 0 && (
                      <div className="text-xs text-text-muted italic">{t('explore_more_facts', { count: hidden })}</div>
                    )}
                  </div>
                  <ChevronRight size={15} className="text-text-muted shrink-0 self-center" aria-hidden="true" />
                </Link>
              );
            })}
            {personGroups.length > FIRST_ROWS && (
              <div className="mt-1">
                <ActionLink kind="expand" expanded={peopleOpen} onClick={() => setAllPeople(peopleOpen ? null : placeName)}>
                  {peopleOpen ? t('show_fewer') : t('show_all_n', { count: personGroups.length })}
                </ActionLink>
              </div>
            )}
            {peopleOpen && personGroups.length > MAX_PREVIEW_PEOPLE && (
              <Link
                href={placeHref({ id: placeId, name: placeName })}
                className="mt-1 -mx-2 px-2 py-2 min-h-[44px] flex items-center rounded-lg text-xs text-link hover:bg-[color:var(--color-hover-surface)] transition-colors focus-ring"
              >
                {t('explore_more_people', { shown: MAX_PREVIEW_PEOPLE, total: personGroups.length })}
              </Link>
            )}
          </div>
        ) : (
          <p className="text-xs text-text-muted italic m-0">{years == null && totalCount > 0 ? t('only_undated') : t('no_people_recorded')}</p>
        )}
      </section>

      {/* Places within: under People here, also expanding in place. Left out at 0. */}
      {within.length > 0 && (
        <section className="px-5 py-4 border-b border-border-light">
          <SectionHeader level="rail" title={t('places_within_title')} count={within.length} />
          <div className="flex flex-col">
            {places.map((p) => (
              <button key={p.id} type="button" onClick={() => onPickPlace?.(p.id)}
                className="flex items-center gap-2 -mx-2 px-2 py-1.5 min-h-9 rounded-lg text-left text-sm text-text serif bg-transparent border-0 cursor-pointer hover:bg-[color:var(--color-hover-surface)] focus-ring">
                <span className="flex-1 min-w-0 truncate">{p.name.split(',')[0]?.trim() ?? p.name}</span>
                <ChevronRight size={14} className="text-text-muted shrink-0" aria-hidden="true" />
              </button>
            ))}
            {within.length > FIRST_ROWS && (
              <div className="mt-1">
                <ActionLink kind="expand" expanded={placesOpen} onClick={() => setAllPlaces(placesOpen ? null : placeName)}>
                  {placesOpen ? t('show_fewer') : t('show_all_n', { count: within.length })}
                </ActionLink>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Records here, by kind. */}
      <section className="px-5 py-4 border-b border-border-light">
        <SectionHeader level="rail" title={t('records_here')} count={totalCount} />
        {eventCounts.length > 0 ? (
          <div className="text-sm">
            {eventCounts.map(({ type, label, count }) => (
              <div key={type} className="flex justify-between items-center py-1 border-b border-border-light last:border-0">
                <span className="text-text">{label}</span>
                <span className="tabular-nums text-text-muted">{count}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-muted italic m-0">{t('no_records_here')}</p>
        )}
      </section>

      {/* Years: the first and last dated record here. */}
      <section className="px-5 py-4">
        <SectionHeader level="rail" title={t('years_title')} />
        <p className="text-sm text-text-secondary m-0 tabular-nums">
          {years ? t('years_span', { first: years.first, last: years.last }) : t('years_none')}
        </p>
      </section>
    </div>
  );
}
