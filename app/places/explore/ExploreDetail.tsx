'use client';

// The detail surface filling the panel's right column beside the index rail — it renders
// NO card of its own (the panel is the card). Empty state = "select a place" prompt centred
// in that column (no fetch — key=null). On selection, reuse the shipped PlaceDetail payload
// via useCachedResource on the shared placeDetailKey (warm from the drill hover). Header:
// name · badges (geocoded uses a MapPin — NOT the inherited-diamond, per #266) · "Open full
// page →". Body is TWO columns: People (clickable → profile, warmed on hover, one entry per
// person with its linking facts stacked beneath the name) / Events + Place details stacked.

import { useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import PersonAvatar from '@/app/components/PersonAvatar';
import { initialsFromName } from '@/lib/utils/initials';
import { useCachedResource } from '@/app/components/useCachedResource';
import { placeDetailKey } from '@/lib/places/prefetch';
import { eventTypeLabel } from '@/lib/places/eventTypes';
import { usePlaceFactReason } from '../usePlaceFactReason';
import { PinMark } from '../PinMark';
import { groupFactLinks } from './groupFactLinks';
import { prefetchPerson } from '@/app/people/view/personCache';
import { ExploreDetailSkeleton } from './ExploreSkeleton';
import { warmThumbnails } from '@/lib/media/warmThumbnails';
import { Badge } from '@/app/components/ui/Badge';
import { MapPin, ChevronRight } from '@/lib/icons';
import type { PlaceDetail } from '@/lib/data/types';
import { placeHref } from '@/lib/places/place-key';

// The pane is a preview beside the drill, and every entry mounts a PersonAvatar
// (one media resolution each — an IndexedDB blob read in the static build). A
// country-level jurisdiction rolls up thousands of facts, so cap the rendered
// PEOPLE and point at the full page, which owns the complete list. Capping facts
// instead meant 60 rows could be a dozen people repeated.
const MAX_PREVIEW_PEOPLE = 60;
/** Reasons shown under one person before the "+N more facts" line. */
const MAX_REASONS_PER_PERSON = 3;
/** Avatar diameter for a person row — also the width the thumbnail warm targets,
 *  so the prefetch and the render ask for the same variant. */
const PERSON_AVATAR_SIZE = 30;
const COL_LABEL = 'eyebrow mb-2.5';

export interface ExploreDetailProps {
  /** Selected place name, or null for the empty state. */
  placeName: string | null;
  /** Its id (#1186), which addresses it when present. */
  placeId?: number | null;
  treeId: number | null;
}

export function ExploreDetail({ placeName, placeId, treeId }: ExploreDetailProps) {
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

  if (!placeName) {
    // Centred inside the panel's right column — NOT its own card. The panel keeps
    // the same height whether or not something is selected, so choosing a place
    // never pushes the page around.
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-10 text-center text-text-muted">
        <MapPin size={26} aria-hidden="true" className="opacity-60" />
        <p className="text-sm">{t('explore_select_prompt')}</p>
        <p className="text-xs opacity-85">{t('explore_drill_hint')}</p>
      </div>
    );
  }

  // Loading shape mirrors the loaded layout — header band, then the body
  // columns — so selecting a place does not collapse the pane to nothing and
  // then push the page back down when the payload lands.
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
  const region = placeName.includes(',') ? placeName.slice(placeName.indexOf(',') + 1).trim() : '';
  const geocoded = detail != null && detail.latitude != null && detail.longitude != null;
  // Facts, matching the rows below and the "people linked" count beside it. It
  // used to be people(birth/death only) + events + families, which could read
  // "2 people linked · 1 record" for a place referenced only by one marriage.
  const totalCount = factRows.length;

  return (
    <div className="flex flex-col flex-1">
      {/* header */}
      <div className="flex items-start justify-between gap-4 flex-wrap px-5 py-4 border-b border-border">
        <div className="min-w-0">
          <h3 className="serif text-2xl font-semibold text-text leading-tight">{short}</h3>
          {region && <p className="mt-0.5 text-xs text-text-muted">{region}</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* One geocode-state symbol set (#266) — a MapPin in both states meant the
              same shape said "pinned" and "not pinned", leaving colour to carry it.
              Own-pin mark only: the hollow ring means "no pin anywhere", which this
              surface cannot tell from "inherits one". The words carry the negative. */}
          {/* A fact as muted text; a missing pin keeps its warning tag (#757). */}
          {geocoded ? (
            <span className="inline-flex items-center gap-1 text-meta text-text-muted"><PinMark state="own" />{t('geocoded')}</span>
          ) : (
            <Badge tone="warning">{t('not_geocoded')}</Badge>
          )}
          {detail && <Badge tone="neutral">{t('people_linked', { count: linkedPeopleCount })}</Badge>}
          {detail && <Badge tone="neutral">{t('records_total', { count: totalCount })}</Badge>}
          <Link
            href={placeHref({ id: placeId, name: placeName })}
            className="text-sm font-semibold text-link hover:underline whitespace-nowrap"
          >
            {t('open_full_page')} →
          </Link>
        </div>
      </div>

      {/* body */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] flex-1">
        {/* People */}
        <div className="p-4 border-b lg:border-b-0 lg:border-r border-border-light">
          <div className={COL_LABEL}>
            {t('people_linked', { count: linkedPeopleCount })}
            <span className="normal-case tracking-normal font-normal text-text-muted"> · {t('explore_open_profile_hint')}</span>
          </div>
          {personGroups.length > 0 ? (
            <div className="flex flex-col">
              {personGroups.slice(0, MAX_PREVIEW_PEOPLE).map((group) => {
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
              {personGroups.length > MAX_PREVIEW_PEOPLE && (
                <Link
                  href={placeHref({ id: placeId, name: placeName })}
                  className="mt-1 -mx-2 px-2 py-2 min-h-[44px] flex items-center rounded-lg text-xs text-link hover:bg-[color:var(--color-hover-surface)] transition-colors focus-ring"
                >
                  {t('explore_more_people', { shown: MAX_PREVIEW_PEOPLE, total: personGroups.length })}
                </Link>
              )}
            </div>
          ) : (
            <p className="text-xs text-text-muted italic">{t('no_people_recorded')}</p>
          )}
        </div>

        {/* Events + place details stacked in one column — the 372px rail leaves
            room for two body columns, not three. */}
        <div className="p-4 flex flex-col gap-4">
          <div>
            <div className={COL_LABEL}>{t('events_here')}</div>
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
              <p className="text-xs text-text-muted italic">—</p>
            )}
          </div>

          <div>
            <div className={COL_LABEL}>{t('place_details')}</div>
            <dl className="grid grid-cols-[84px_1fr] gap-x-3 gap-y-2 text-sm">
              {detail?.displayName && (
                <>
                  <dt className="text-text-muted">{t('geocoded_label')}</dt>
                  <dd className="text-text truncate">{detail.displayName}</dd>
                </>
              )}
              <dt className="text-text-muted">{t('coordinates')}</dt>
              <dd className="tabular-nums text-text-muted">
                {geocoded ? `${detail!.latitude!.toFixed(4)}, ${detail!.longitude!.toFixed(4)}` : t('not_geocoded_value')}
              </dd>
              {detail?.parents && detail.parents.length > 0 && (
                <>
                  <dt className="text-text-muted">{t('parent_place_label')}</dt>
                  <dd className="text-text truncate">
                    {(() => {
                      const parent = detail.parents[detail.parents.length - 1];
                      return parent.name.split(',')[0]?.trim() ?? parent.name;
                    })()}
                  </dd>
                </>
              )}
              {detail?.children && detail.children.length > 0 && (
                <>
                  <dt className="text-text-muted">{t('subplaces_label')}</dt>
                  <dd className="tabular-nums text-text-muted">{detail.children.length}</dd>
                </>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
