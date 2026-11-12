'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import GuardedLink from '@/app/components/GuardedLink';
import PersonAvatar from '@/app/components/PersonAvatar';
import ProfileImage from '@/app/components/ProfileImage';
import { ActionLink, Button, CoverBand, DetailBody, DetailRail, Lifespan, OpenInTreeRow, SectionHeader, TileLink, cx } from '@/app/components/ui';
import { useActiveTreeName } from '@/app/hooks/useActiveTreeName';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import type { LoadPhase } from '@/app/components/useLoadPhase';
import type { DashboardData, OpenCase, RecentPerson, ResumedPerson } from '@/lib/data/types';
import type { NextStep } from '@/lib/db/queries/home';
import { EVENT_TYPES, getEventDisplayType } from '@/lib/db/schema';
import { livingStatus } from '@/lib/living';
import { placeHref } from '@/lib/places/place-key';
import { ArrowUpRight, FolderSearch, Plus, Upload, UserRound, Users } from '@/lib/icons';
import { avatarClass } from '@/lib/utils/avatar';
import { getInitials } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import { useChangeLine, useChangeParts } from './useChangeLine';

/*
 * The desktop home (#53, locked 2026-10-31): a cover band with the tree's name and
 * span, the pick-up card with its Next steps, then Recently edited and Research
 * beside a rail of Quick add, Needs attention and Where they lived. Built from the
 * #55 kit. Phones get `MobileHome`, chosen with CSS.
 */

export interface DesktopHomeProps {
    data: DashboardData | null;
    phase: LoadPhase;
    datesToCheck: number;
    duplicates: number;
    /** Editors and contributors. Viewers get no Next steps, Quick add or data-check rows. */
    canEdit: boolean;
    treeId: number | null;
}

/**
 * Where a step opens on the person page. The v1.1 person page (#49) gives its
 * rows these ids; until then the link opens the person.
 */
function stepHref(personId: number, step: NextStep): string {
    const base = `/people/view?id=${personId}`;
    switch (step.kind) {
        case 'birth_date': case 'birth_place': return `${base}#birth`;
        case 'death_date': case 'death_place': return `${base}#death`;
        case 'source': return step.fact === 'event' ? `${base}#event-${step.eventId}` : `${base}#${step.fact}`;
        case 'parents': return `${base}#parents`;
        case 'grandparents': return `/people/view?id=${step.parentId}#parents`;
    }
}

function useStepText() {
    const t = useTranslations('home');
    const tTypes = useTranslations('eventTypes');
    const factName = (step: Extract<NextStep, { kind: 'source' }>) => {
        if (step.fact !== 'event') return tTypes(step.fact === 'birth' ? 'BIRT' : 'DEAT');
        const type = step.eventType ?? '';
        return EVENT_TYPES[type] ? tTypes(type as Parameters<typeof tTypes>[0]) : getEventDisplayType(type);
    };
    return (step: NextStep): { title: string; reason: string } => {
        switch (step.kind) {
            case 'birth_date': case 'death_date': case 'birth_place': case 'death_place':
                return { title: t(`step_${step.kind}`), reason: t(`step_${step.kind}_why`) };
            case 'source':
                return {
                    title: step.year != null ? t('step_source_year', { fact: factName(step), year: step.year }) : t('step_source', { fact: factName(step) }),
                    reason: t('step_source_why'),
                };
            case 'parents':
                return { title: t('step_parents'), reason: t('step_parents_why') };
            case 'grandparents': {
                const who = step.parentSex === 'F' ? 'mother' : step.parentSex === 'M' ? 'father' : 'other';
                return {
                    title: t('step_grandparents', { who, name: step.parentName ?? '' }),
                    reason: t('step_grandparents_why', { name: step.parentName ?? t('step_this_parent') }),
                };
            }
        }
    };
}

export function DesktopHome({ data, phase, datesToCheck, duplicates, canEdit, treeId }: DesktopHomeProps) {
    const t = useTranslations('home');
    const router = useRouter();
    const treeName = useActiveTreeName();
    const stats = data?.stats;
    const ready = phase === 'ready' && data != null;
    const firstRun = stats?.people === 0;
    const span = data?.yearSpan;

    const band = (
        <CoverBand
            variant="cover"
            eyebrow={firstRun ? t('mobile_new_tree') : t('mobile_your_tree')}
            title={firstRun ? t('welcome_first_run') : treeName}
            titleSize="page"
            meta={firstRun ? undefined : ready && stats ? (
                t.rich(span?.first != null && span.last != null ? 'desk_counts_span' : 'desk_counts', {
                    people: stats.people,
                    families: stats.families,
                    first: span?.first ?? 0,
                    last: span?.last ?? 0,
                    y: (chunks) => <span className="date-mono">{chunks}</span>,
                })
            ) : <span className="skeleton inline-block w-48 h-3 rounded-[4px] align-middle opacity-40" aria-hidden="true" />}
        />
    );

    if (firstRun) {
        return (
            <div className="desktop-home grid gap-6">
                {band}
                <div className="grid gap-4 max-w-[620px]">
                    <p className="m-0 text-base text-text-secondary">{t('first_run_subtitle')}</p>
                    {canEdit && (
                        <div className="flex flex-wrap gap-2">
                            <Button variant="primary" icon={<Upload className="w-4 h-4" aria-hidden="true" />} onClick={() => router.push('/import-export')}>{t('import_gedcom')}</Button>
                            <Button variant="outline" icon={<Plus className="w-4 h-4" aria-hidden="true" />} onClick={() => router.push('/people/new')}>{t('add_person_short')}</Button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    const resumed = data?.resumedPerson ?? null;
    const rail = (
        <DetailRail look="open">
            {canEdit && <QuickAdd />}
            <NeedsAttention canEdit={canEdit} datesToCheck={datesToCheck} duplicates={duplicates} cases={stats?.casesInProgress ?? 0} ready={ready} />
            {ready && data.places.length > 0 && <WhereTheyLived data={data} />}
        </DetailRail>
    );

    return (
        <div className="desktop-home grid gap-6">
            {band}
            {phase === 'loading' && <PickUpSkeleton />}
            {ready && resumed && <PickUp person={resumed} treeId={treeId} viewer={!canEdit} />}
            <div className="border-t border-border pt-8">
                <DetailBody rail={rail}>
                    <RecentlyEdited people={data?.recentPeople ?? []} treeId={treeId} canEdit={canEdit} loading={phase === 'loading'} />
                    <Research cases={data?.openCases ?? []} loading={phase === 'loading'} />
                </DetailBody>
            </div>
        </div>
    );
}

function Portrait({ person, treeId }: { person: ResumedPerson; treeId: number | null }) {
    return (
        <span className={cx('relative grid place-items-center w-[240px] h-[180px] shrink-0 rounded-card overflow-hidden', avatarClass(person.Sex))}>
            <span aria-hidden="true" className="serif text-4xl text-[color:var(--color-on-media)] opacity-70">{getInitials(person.FirstName, person.LastName)}</span>
            {person.PrimaryMediaId && (
                <span className="absolute inset-0">
                    <ProfileImage mediaId={person.PrimaryMediaId} treeId={treeId} alt=""
                        focalX={person.FocalX ?? 50} focalY={person.FocalY ?? 50} focalRadius={person.FocalRadius ?? null}
                        containerWidth={240} containerHeight={180} circular={false} />
                </span>
            )}
        </span>
    );
}

/** "Pick up where you left off": one white card, with "Next for <name>" in its tinted right column. */
function PickUp({ person, treeId, viewer }: { person: ResumedPerson; treeId: number | null; viewer: boolean }) {
    const t = useTranslations('home');
    const changeLine = useChangeLine();
    const stepText = useStepText();
    const name = displayFullName(person) || person.lastChange.EntityLabel || t('person_fallback', { id: person.Id });
    const first = person.EffectiveFirstName || person.FirstName || name;
    const href = `/people/view?id=${person.Id}`;
    const { steps, total } = person.nextSteps;
    const showSteps = !viewer && steps.length > 0;
    return (
        <section aria-labelledby="home-pickup" className={cx('pick-up grid overflow-hidden rounded-panel border border-border bg-card shadow-card', showSteps && 'min-[1100px]:grid-cols-[minmax(0,1fr)_340px]')}>
            <div className="flex flex-wrap items-start gap-6 p-6">
                {/* The portrait repeats the name link, so it leaves the tab order. */}
                <GuardedLink href={href} tabIndex={-1} aria-hidden="true" className="shrink-0 rounded-card">
                    <Portrait person={person} treeId={treeId} />
                </GuardedLink>
                <div className="grid min-w-[220px] flex-1 content-start gap-1.5">
                    <span className="eyebrow" id="home-pickup">{viewer ? t('mobile_last_updated') : t('mobile_pick_up')}</span>
                    <h2 className="m-0">
                        <GuardedLink href={href} className="serif inline-flex items-baseline gap-1 text-2xl font-semibold leading-tight text-text no-underline hover:underline focus-ring rounded-sm">
                            {name}<ArrowUpRight className="w-5 h-5 shrink-0 self-center text-text-muted" aria-hidden="true" />
                        </GuardedLink>
                    </h2>
                    {(person.BirthDate || person.DeathDate) && (
                        <Lifespan birth={person.BirthDate} death={person.DeathDate} status={livingStatus(person)} className="text-sm" />
                    )}
                    <span className="text-sm text-text-secondary">{changeLine(person.lastChange)}</span>
                    <OpenInTreeRow personId={person.Id} firstName={first} className="mt-3 max-w-[360px]" />
                </div>
            </div>
            {showSteps && (
                <div className="next-steps grid content-start gap-1 bg-surface-2 p-5">
                    <div className="flex items-baseline justify-between gap-3 pb-1">
                        <h3 className="m-0 eyebrow">{t('next_for', { name: first })}</h3>
                        <span className="font-mono text-meta text-text-muted">{t('steps_open', { count: total })}</span>
                    </div>
                    <ul className="m-0 grid list-none gap-1 p-0">
                        {steps.map((step, i) => {
                            const { title, reason } = stepText(step);
                            return (
                                <li key={i}>
                                    <GuardedLink href={stepHref(person.Id, step)}
                                        className="flex items-start gap-2 rounded-btn bg-card px-3 py-2.5 text-text no-underline transition-colors hover:bg-hover-surface focus-ring">
                                        <span className="grid min-w-0 flex-1 gap-0.5">
                                            <span className="text-sm font-semibold">{title}</span>
                                            <span className="text-meta text-text-muted">{reason}</span>
                                        </span>
                                        <ArrowUpRight className="mt-0.5 w-4 h-4 shrink-0 text-text-muted" aria-hidden="true" />
                                    </GuardedLink>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </section>
    );
}

function PickUpSkeleton() {
    return (
        <div aria-busy="true" className="flex gap-6 rounded-panel border border-border bg-card p-6">
            <span className="skeleton w-[240px] h-[180px] rounded-card shrink-0" aria-hidden="true" />
            <span className="grid flex-1 content-start gap-2.5">
                <span className="skeleton h-3 w-[30%] rounded-[4px]" aria-hidden="true" />
                <span className="skeleton h-6 w-[55%] rounded-[6px]" aria-hidden="true" />
                <span className="skeleton h-3 w-[25%] rounded-[4px]" aria-hidden="true" />
            </span>
        </div>
    );
}

function RecentlyEdited({ people, treeId, canEdit, loading }: { people: RecentPerson[]; treeId: number | null; canEdit: boolean; loading: boolean }) {
    const t = useTranslations('home');
    const changeParts = useChangeParts();
    if (!loading && people.length === 0) return null;
    return (
        <section aria-labelledby="home-recent" className="mb-10">
            <SectionHeader headingId="home-recent" title={canEdit ? t('mobile_recently_edited') : t('mobile_recently_updated')}
                action={<ActionLink href="/audit">{t('mobile_full_history')}</ActionLink>} />
            {loading ? <RowsSkeleton rows={4} /> : (
                <ul className="m-0 grid list-none gap-x-6 p-0 min-[1100px]:grid-cols-2">
                    {people.map((p) => {
                        const name = displayFullName(p) || t('person_fallback', { id: p.Id });
                        const { change, time } = changeParts(p.lastChange);
                        return (
                            <li key={p.Id}>
                                <GuardedLink href={`/people/view?id=${p.Id}`}
                                    className="flex items-center gap-3 rounded-btn px-2 py-2.5 -mx-2 text-text no-underline transition-colors hover:bg-hover-surface focus-ring">
                                    <PersonAvatar as="span" size={36} mediaId={p.PrimaryMediaId} treeId={treeId} name={name} sex={p.Sex}
                                        initials={getInitials(p.FirstName, p.LastName)} focalX={p.FocalX} focalY={p.FocalY} focalRadius={p.FocalRadius} />
                                    <span className="grid min-w-0 flex-1">
                                        <span className="serif text-md font-semibold truncate">{name}</span>
                                        <span className="text-meta text-text-muted truncate">{change}</span>
                                    </span>
                                    <span className="shrink-0 font-mono text-meta text-text-muted">{time}</span>
                                </GuardedLink>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

function Research({ cases, loading }: { cases: OpenCase[]; loading: boolean }) {
    const t = useTranslations('home');
    const { activityTime } = useTimestamp();
    return (
        <section aria-labelledby="home-research">
            <SectionHeader headingId="home-research" title={t('mobile_research')} action={<ActionLink href="/cases">{t('all_cases')}</ActionLink>} />
            {loading ? <RowsSkeleton rows={2} /> : cases.length === 0 ? (
                <p className="m-0 text-sm text-text-muted">{t('no_cases_in_progress')}</p>
            ) : (
                <ul className="m-0 grid list-none gap-2 p-0">
                    {cases.map((c) => (
                        <li key={c.Id}>
                            <GuardedLink href={`/cases/view?id=${c.Id}`}
                                className="grid gap-1.5 rounded-btn px-2 py-3 -mx-2 text-text no-underline transition-colors hover:bg-hover-surface focus-ring">
                                <span className="text-base font-semibold">{c.Title}</span>
                                {c.LastComment ? (
                                    <span className="flex items-start gap-2.5">
                                        <span aria-hidden="true" className="avatar-neutral grid place-items-center w-6 h-6 shrink-0 rounded-full text-xs font-semibold text-[color:var(--color-on-media)]">
                                            {getInitials(c.LastCommentAuthor ?? '', '')}
                                        </span>
                                        <span className="grid min-w-0 gap-0.5">
                                            <span className="text-meta text-text-muted">
                                                {t('comment_by', { name: c.LastCommentAuthor ?? t('someone'), time: c.LastCommentAt ? activityTime(c.LastCommentAt) : '' })}
                                            </span>
                                            <span className="serif italic text-sm text-text-secondary line-clamp-2">“{c.LastComment}”</span>
                                        </span>
                                    </span>
                                ) : (
                                    <span className="text-meta text-text-muted">{t('updated_ago', { time: activityTime(c.UpdatedAt) })}</span>
                                )}
                            </GuardedLink>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function QuickAdd() {
    const t = useTranslations('home');
    const tiles = [
        { href: '/people?add=1', label: t('new_person'), icon: <UserRound className="w-[18px] h-[18px]" /> },
        { href: '/families?add=1', label: t('new_family'), icon: <Users className="w-[18px] h-[18px]" /> },
        { href: '/cases/new', label: t('new_case'), icon: <FolderSearch className="w-[18px] h-[18px]" /> },
    ];
    return (
        <section aria-labelledby="home-quick-add">
            <SectionHeader level="rail" rule={false} headingId="home-quick-add" title={t('quick_add')} />
            <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
                {tiles.map((tile) => (
                    <li key={tile.href} className="grid"><TileLink href={tile.href} icon={tile.icon} label={tile.label} /></li>
                ))}
            </ul>
        </section>
    );
}

function NeedsAttention({ canEdit, datesToCheck, duplicates, cases, ready }: { canEdit: boolean; datesToCheck: number; duplicates: number; cases: number; ready: boolean }) {
    const t = useTranslations('home');
    // The phone's rule: editors see the data-check rows when they have something; everyone sees cases.
    const rows = [
        canEdit && datesToCheck > 0 && { href: '/data-checks', label: t('mobile_dates_to_check'), count: datesToCheck },
        canEdit && duplicates > 0 && { href: '/people?filter=duplicates', label: t('mobile_possible_duplicates'), count: duplicates },
        { href: '/cases', label: t('cases_in_progress_title'), count: cases },
    ].filter(Boolean) as Array<{ href: string; label: string; count: number }>;
    return (
        <section aria-labelledby="home-attention">
            <SectionHeader level="rail" rule={false} headingId="home-attention" title={canEdit ? t('mobile_needs_attention') : t('mobile_research')} />
            <ul className="m-0 grid list-none p-0">
                {rows.map((r) => (
                    <li key={r.href}>
                        <GuardedLink href={r.href}
                            className="flex items-center gap-2 rounded-btn px-2 py-2 -mx-2 text-sm text-text no-underline transition-colors hover:bg-hover-surface focus-ring">
                            <span className="min-w-0 flex-1">{r.label}</span>
                            <span className="font-mono text-sm font-medium text-text-muted">{ready ? r.count.toLocaleString() : '–'}</span>
                            <ArrowUpRight className="w-4 h-4 shrink-0 text-text-muted" aria-hidden="true" />
                        </GuardedLink>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function WhereTheyLived({ data }: { data: DashboardData }) {
    const t = useTranslations('home');
    const max = Math.max(...data.places.map((p) => Number(p.person_count)), 1);
    const { places, countries } = data.placeTotals;
    return (
        <section aria-labelledby="home-places">
            <SectionHeader level="rail" rule={false} headingId="home-places" title={t('where_they_lived')} action={<ActionLink href="/places">{t('all_places')}</ActionLink>} />
            <ul className="m-0 grid list-none gap-1 p-0">
                {data.places.map((p) => {
                    const count = Number(p.person_count);
                    return (
                        <li key={p.place_id}>
                            <GuardedLink href={placeHref({ id: p.place_id, name: p.place_name })}
                                className="grid gap-1 rounded-btn px-2 py-1.5 -mx-2 text-text no-underline transition-colors hover:bg-hover-surface focus-ring">
                                <span className="flex items-baseline gap-2">
                                    <span className="min-w-0 flex-1 truncate text-sm" title={p.place_name}>
                                        {p.place_name.split(',')[0]}
                                        {p.country && p.country !== p.place_name.split(',')[0] && <span className="text-text-muted"> · {p.country}</span>}
                                    </span>
                                    <span className="font-mono text-meta text-text-muted">{t('records_count', { count })}</span>
                                </span>
                                <span aria-hidden="true" className="h-1 rounded-full bg-border-light">
                                    <span className="block h-full rounded-full bg-text-muted" style={{ width: `${Math.max(4, (count / max) * 100)}%` }} />
                                </span>
                            </GuardedLink>
                        </li>
                    );
                })}
            </ul>
            <p className="m-0 mt-2.5 text-meta text-text-muted">
                {countries > 0 ? t('places_foot', { places, countries }) : t('places_foot_no_countries', { places })}
            </p>
        </section>
    );
}

function RowsSkeleton({ rows }: { rows: number }) {
    return (
        <div aria-busy="true" className="grid gap-3">
            {Array.from({ length: rows }).map((_, i) => (
                <span key={i} className="flex items-center gap-3">
                    <span className="skeleton w-9 h-9 rounded-full shrink-0" aria-hidden="true" />
                    <span className="grid flex-1 gap-1.5">
                        <span className="skeleton h-[13px] rounded-[4px]" style={{ width: `${55 - i * 6}%` }} aria-hidden="true" />
                        <span className="skeleton h-[11px] rounded-[4px]" style={{ width: `${34 - i * 3}%` }} aria-hidden="true" />
                    </span>
                </span>
            ))}
        </div>
    );
}
