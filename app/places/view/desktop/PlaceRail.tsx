'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import PersonAvatar from '@/app/components/PersonAvatar';
import { ActionLink, DetailRail, Lifespan, SectionHeader } from '@/app/components/ui';
import { MapPin } from '@/lib/icons';
import { initialsFromName } from '@/lib/utils/initials';
import { sortOtherNames } from '@/lib/places/other-names';
import { placeHref } from '@/lib/places/place-key';
import type { PlaceDetail } from '@/lib/data/types';
import type { PersonFactGroup } from '@/app/places/explore/groupFactLinks';

/** People shown before "Show all": two rows of three. */
const PEOPLE_FIRST = 6;
/** Places within shown before "Show all". */
const PLACES_FIRST = 5;
/** Other names shown before "+N more". */
const NAMES_FIRST = 3;
/** The face size in People here; the page warms this thumbnail width. */
export const RAIL_AVATAR_SIZE = 56;

const shortName = (name: string) => name.split(',')[0]?.trim() || name;

/**
 * The desktop place page's rail (#56): People here three across, Places within,
 * and Details (how the map knows it, its names and coordinates, Fix the location).
 * Lists expand at their foot. Viewers get no Edit or Fix.
 */
export function PlaceRail({ detail, people, placeName, treeId, canEdit, pinned, recordedAs, onEditNames, fixMenu, onPrefetchPlace, editing }: {
    detail: PlaceDetail;
    /** Everyone a record here names, once each. */
    people: PersonFactGroup[];
    placeName: string;
    treeId: number | null;
    canEdit: boolean;
    /** The place has coordinates of its own. */
    pinned: boolean;
    /** The name a person's records here were written under, when it is another of the place's names. */
    recordedAs: ReadonlyMap<number, string>;
    onEditNames: () => void;
    /** Fix the location ⌄ (editors only). */
    fixMenu: React.ReactNode;
    onPrefetchPlace: (name: string) => void;
    /** An edit panel, shown in place of Details while it is open. */
    editing: React.ReactNode;
}) {
    const t = useTranslations('placeDesktop');
    const tp = useTranslations('places');
    const tk = useTranslations('detailKit');
    const [allPeople, setAllPeople] = useState(false);
    const [allPlaces, setAllPlaces] = useState(false);
    const [allNames, setAllNames] = useState(false);

    // Lifespans come with the born/died rows; a person here only by an event has none.
    const lives = new Map(detail.people.map((p) => [p.Id, p]));
    const within = detail.children ?? [];
    const names = sortOtherNames(detail.otherNames ?? []);
    const shownPeople = allPeople ? people : people.slice(0, PEOPLE_FIRST);
    const shownPlaces = allPlaces ? within : within.slice(0, PLACES_FIRST);
    const shownNames = allNames ? names : names.slice(0, NAMES_FIRST);

    return (
        <DetailRail look="open">
            {people.length > 0 && (
                <section aria-labelledby="place-people-title">
                    <SectionHeader level="label" as="h3" headingId="place-people-title" title={tp('people_here')} count={people.length} />
                    <ul className="m-0 p-0 list-none grid grid-cols-3 gap-x-2 gap-y-4">
                        {shownPeople.map((p) => {
                            const name = p.name || tp('person_fallback', { id: p.personId });
                            const life = lives.get(p.personId);
                            return (
                                <li key={p.personId} className="min-w-0">
                                    <Link href={`/people/view?id=${p.personId}`} className="group grid justify-items-center gap-1.5 text-center rounded-card p-1 no-underline focus-ring">
                                        <PersonAvatar
                                            as="span"
                                            mediaId={p.primaryMediaId}
                                            treeId={treeId}
                                            sex={p.sex === 'M' ? 'M' : p.sex === 'F' ? 'F' : null}
                                            name={name}
                                            initials={initialsFromName(name)}
                                            focalX={p.focalX}
                                            focalY={p.focalY}
                                            focalRadius={p.focalRadius}
                                            size={RAIL_AVATAR_SIZE}
                                        />
                                        <span className="serif text-sm leading-snug text-text line-clamp-2 break-words group-hover:underline" title={name}>{name}</span>
                                        {life && (life.BirthDate || life.DeathDate) && <Lifespan birth={life.BirthDate} death={life.DeathDate} className="text-xs" />}
                                        {recordedAs.has(p.personId) && (
                                            <span className="text-xs text-text-muted line-clamp-2">{tp.rich('recorded_as', { name: recordedAs.get(p.personId)!, i: (c) => <i className="serif">{c}</i> })}</span>
                                        )}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                    {people.length > PEOPLE_FIRST && (
                        <div className="mt-3">
                            <ActionLink kind="expand" expanded={allPeople} onClick={() => setAllPeople((v) => !v)}>
                                {allPeople ? tk('show_less') : tp('show_all_n', { count: people.length })}
                            </ActionLink>
                        </div>
                    )}
                </section>
            )}

            {within.length > 0 && (
                <section aria-labelledby="place-within-title">
                    <SectionHeader level="label" as="h3" headingId="place-within-title" title={tp('places_within_title')} count={within.length} />
                    <ul className="m-0 p-0 list-none">
                        {shownPlaces.map((c) => (
                            <li key={c.id} className="border-b border-border-light last:border-0">
                                <Link
                                    href={placeHref(c)}
                                    onMouseEnter={() => onPrefetchPlace(c.name)}
                                    onFocus={() => onPrefetchPlace(c.name)}
                                    className="flex items-center gap-2 py-2 text-sm text-text no-underline hover:underline focus-ring rounded-sm"
                                >
                                    <MapPin size={14} className="text-text-muted shrink-0" aria-hidden="true" />
                                    <span className="serif min-w-0 truncate">{shortName(c.name)}</span>
                                    {c.records != null && c.records > 0 && (
                                        <span className="ml-auto pl-2 font-mono text-meta text-text-muted tabular-nums">{c.records}<span className="sr-only"> {t('stat_records', { count: c.records })}</span></span>
                                    )}
                                </Link>
                            </li>
                        ))}
                    </ul>
                    {within.length > PLACES_FIRST && (
                        <div className="mt-3">
                            <ActionLink kind="expand" expanded={allPlaces} onClick={() => setAllPlaces((v) => !v)}>
                                {allPlaces ? tk('show_less') : tp('show_all_n', { count: within.length })}
                            </ActionLink>
                        </div>
                    )}
                </section>
            )}

            {editing ?? (
                <section aria-labelledby="place-details-title">
                    <SectionHeader level="label" as="h3" headingId="place-details-title" title={t('details')} />
                    <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                        {/* "Place name", never "Canonical" or "Display name" (ADR 0017). */}
                        <dt className="text-text-muted">{tp('place_name')}</dt>
                        <dd className="m-0 text-text break-words">{placeName}</dd>
                        {detail.id != null && (names.length > 0 || canEdit) && (
                            <>
                                <dt className="text-text-muted">{tp('other_names')}</dt>
                                <dd className="m-0 grid gap-1 justify-items-start">
                                    {names.length === 0 ? <span className="text-text-muted">{t('no_other_names')}</span> : (
                                        <span className="serif text-text break-words">{shownNames.map((n) => n.name).join(' · ')}</span>
                                    )}
                                    <span className="flex flex-wrap gap-x-3">
                                        {names.length > NAMES_FIRST && !allNames && (
                                            <ActionLink kind="expand" onClick={() => setAllNames(true)}>{t('names_more', { count: names.length - NAMES_FIRST })}</ActionLink>
                                        )}
                                        {canEdit && (
                                            <ActionLink onClick={onEditNames} aria-label={t('edit_other_names')}>
                                                {names.length === 0 ? tp('add_a_name') : t('edit')}
                                            </ActionLink>
                                        )}
                                    </span>
                                </dd>
                            </>
                        )}
                        {detail.displayName && (
                            <>
                                <dt className="text-text-muted">{t('on_map_as')}</dt>
                                <dd className="m-0 text-text break-words">{detail.displayName}</dd>
                            </>
                        )}
                        <dt className="text-text-muted">{tp('coordinates')}</dt>
                        <dd className="m-0 font-mono text-meta tabular-nums text-text-secondary">
                            {pinned ? `${detail.latitude!.toFixed(4)}, ${detail.longitude!.toFixed(4)}` : tp('not_geocoded_value')}
                        </dd>
                    </dl>
                    {canEdit && <div className="mt-4">{fixMenu}</div>}
                </section>
            )}
        </DetailRail>
    );
}
