'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import GuardedLink from '@/app/components/GuardedLink';
import PersonAvatar from '@/app/components/PersonAvatar';
import ProfileImage from '@/app/components/ProfileImage';
import { openAppMenu, openGlobalSearch } from '@/app/components/nav/appEvents';
import { CopperPill, GlassButton, Lifespan, MobileRow, SectionHeader, cx } from '@/app/components/ui';
import { useActiveTreeName } from '@/app/hooks/useActiveTreeName';
import type { LoadPhase } from '@/app/components/useLoadPhase';
import type { DashboardData, RecentPerson, ResumedPerson } from '@/lib/data/types';
import { livingStatus } from '@/lib/living';
import { ArrowUpRight, CalendarDays, FolderSearch, Menu, Network, Plus, Search, Upload, Users } from '@/lib/icons';
import { avatarClass } from '@/lib/utils/avatar';
import { getInitials } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import { useChangeLine } from './useChangeLine';

/*
 * The home page on phones (#1061, umbrella #1067): a compact dark band instead of the
 * app top bar, then full-width sections with no cards. Desktop keeps `app/page.tsx`'s
 * own layout; the two are chosen with CSS, so a phone never paints the desktop page.
 */

/** "Recently edited" shows this many people after the pick-up person. */
const RECENT_SHOWN = 3;

/** The app version from package.json (next.config.ts `env`). */
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

export interface MobileHomeProps {
    data: DashboardData | null;
    phase: LoadPhase;
    /** Open "Dates to check" entries. */
    datesToCheck: number;
    /** Likely duplicate pairs (#822). */
    duplicates: number;
    /** Editors and contributors; viewers get no Add person and no data-check rows. */
    canEdit: boolean;
    treeId: number | null;
}

export function MobileHome({ data, phase, datesToCheck, duplicates, canEdit, treeId }: MobileHomeProps) {
    const t = useTranslations('home');
    const tn = useTranslations('nav');
    const tc = useTranslations('common');
    const router = useRouter();
    const treeName = useActiveTreeName();
    const bandRef = useRef<HTMLElement>(null);
    const barRef = useRef<HTMLDivElement>(null);
    const [barShown, setBarShown] = useState(false);

    // The band replaces the app top bar on phones (design-system.md → Mobile → App top bar).
    useLayoutEffect(() => {
        const root = document.documentElement;
        root.setAttribute('data-own-header', '');
        return () => root.removeAttribute('data-own-header');
    }, []);

    // The slim bar fades in once the band has scrolled under it.
    useEffect(() => {
        const update = () => {
            const band = bandRef.current, bar = barRef.current;
            if (!band || !bar) return;
            setBarShown(band.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom);
        };
        update();
        window.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
    }, []);

    const ready = phase === 'ready' && data != null;
    const stats = data?.stats;
    const firstRun = ready && stats?.people === 0;
    const resumed = data?.resumedPerson ?? null;
    const recent = (data?.recentPeople ?? []).slice(0, RECENT_SHOWN);
    const amber = 'text-[color:var(--color-date)] font-medium';

    return (
        <div className="md:hidden">
            <header ref={bandRef} className="hero-dark mp-slim-bar !rounded-none !shadow-none !p-0">
                <div className="grid pl-4 pr-3 pb-4" style={{ paddingTop: 'calc(10px + var(--sat))' }}>
                    <div className="flex items-center gap-2.5 -ml-1">
                        <GlassButton label={tn('toggle_menu')} icon={<Menu />} onClick={openAppMenu} />
                        <span className="flex-1 min-w-0 pl-1 serif text-lg font-semibold text-white truncate">{tn('title')}</span>
                        <span className="flex gap-2">
                            {!firstRun && <GlassButton label={tn('tree')} word={tn('tree')} icon={<Network />} href="/tree" />}
                            <GlassButton label={tc('search_people_and_families')} icon={<Search />} onClick={openGlobalSearch} />
                        </span>
                    </div>
                    <div className="grid gap-1 mt-7">
                        <span className="eyebrow">{firstRun ? t('mobile_new_tree') : t('mobile_your_tree')}</span>
                        <h1 className="m-0 serif text-xl font-semibold text-white leading-tight text-balance">
                            {firstRun ? t('welcome_first_run') : treeName}
                        </h1>
                        {!firstRun && (
                            <p className="m-0 font-mono text-meta text-text-muted">
                                {ready && stats ? t.rich('mobile_counts', {
                                    people: stats.people,
                                    families: stats.families,
                                    b: (chunks) => <span className={amber}>{chunks}</span>,
                                }) : <span className="skeleton inline-block w-40 h-3 rounded-[4px] align-middle opacity-40" aria-hidden="true" />}
                            </p>
                        )}
                    </div>
                </div>
            </header>

            <div ref={barRef} aria-hidden={!barShown} inert={!barShown}
                className={cx('hero-dark mp-slim-bar !rounded-none !shadow-none fixed inset-x-0 top-0 z-40 flex items-center gap-2.5 !px-3 !pb-[7px] transition-[opacity,transform,visibility] duration-[180ms] motion-reduce:transition-none',
                    barShown ? 'opacity-100 translate-y-0' : 'invisible opacity-0 -translate-y-2 pointer-events-none')}
                style={{ minHeight: 'calc(48px + var(--sat))', paddingTop: 'calc(7px + var(--sat))' }}>
                <BarIcon label={tn('toggle_menu')} onClick={openAppMenu}><Menu aria-hidden="true" /></BarIcon>
                <span className="flex-1 min-w-0 grid gap-px">
                    <span className="serif text-md font-semibold text-white leading-tight truncate">{tn('title')}</span>
                    <span className="font-mono text-xs text-[color:var(--color-date)] truncate">{treeName}</span>
                </span>
                <BarIcon label={tc('search_people_and_families')} onClick={openGlobalSearch}><Search aria-hidden="true" /></BarIcon>
            </div>

            {phase === 'loading' && <BodySkeleton />}
            {firstRun && (
                <div className="pb-2">
                    <p className="m-0 px-4 pt-4 pb-1.5 text-base leading-normal text-text-muted">{t('first_run_subtitle')}</p>
                    {canEdit && (
                        <>
                            <div className="px-4 pt-1.5 pb-3">
                                <CopperPill icon={<Upload aria-hidden="true" />} onClick={() => router.push('/import-export')}>{t('import_gedcom')}</CopperPill>
                            </div>
                            <MobileRow icon={<Plus />} label={t('add_person_short')} end="chevron" divided href="/people?add=1" />
                        </>
                    )}
                </div>
            )}
            {ready && !firstRun && (
                <div>
                    {resumed && <PickUpRow person={resumed} treeId={treeId} viewer={!canEdit} />}
                    {canEdit && (
                        <div className="px-4 pt-[18px]">
                            <CopperPill icon={<Plus aria-hidden="true" />} onClick={() => router.push('/people?add=1')}>{t('add_person_short')}</CopperPill>
                        </div>
                    )}
                    {(resumed || recent.length > 0) && (
                        <section aria-labelledby="home-recent" className="pt-[18px]">
                            <div className="px-4 pb-1">
                                <SectionHeader level="eyebrow" headingId="home-recent" title={canEdit ? t('mobile_recently_edited') : t('mobile_recently_updated')} />
                            </div>
                            {recent.map((p, i) => <RecentRow key={p.Id} person={p} treeId={treeId} divided={i > 0} />)}
                            <MobileRow label={<span className="font-semibold">{t('mobile_full_history')}</span>} end="leave" href="/audit" divided={recent.length > 0} />
                        </section>
                    )}
                    <section aria-labelledby="home-attention" className="mt-1 pt-[18px] border-t border-border">
                        <div className="px-4 pb-1">
                            <SectionHeader level="eyebrow" as="h2" headingId="home-attention" title={canEdit ? t('mobile_needs_attention') : t('mobile_research')} />
                        </div>
                        {canEdit && datesToCheck > 0 && (
                            <MobileRow icon={<CalendarDays />} label={<Counted label={t('mobile_dates_to_check')} count={datesToCheck} />} end="leave" href="/data-checks" />
                        )}
                        {canEdit && duplicates > 0 && (
                            <MobileRow icon={<Users />} label={<Counted label={t('mobile_possible_duplicates')} count={duplicates} />} end="leave" href="/people?filter=duplicates"
                                divided={datesToCheck > 0} />
                        )}
                        <MobileRow icon={<FolderSearch />} label={<Counted label={t('cases_in_progress_title')} count={stats?.casesInProgress ?? 0} />} end="leave" href="/cases"
                            divided={canEdit && (datesToCheck > 0 || duplicates > 0)} />
                    </section>
                </div>
            )}

            {phase !== 'loading' && (
                <footer className="mx-4 mt-[26px] pt-[18px] border-t border-border grid gap-0.5 justify-items-center text-center"
                    style={{ paddingBottom: 'calc(28px + env(safe-area-inset-bottom, 0px))' }}>
                    <span className="serif text-lg font-semibold text-text">{tn('title')}</span>
                    <span className="text-meta text-text-muted">
                        {APP_VERSION ? t('mobile_signoff_version', { version: APP_VERSION }) : t('mobile_signoff')}
                    </span>
                </footer>
            )}
        </div>
    );
}

/** A plain icon on the slim bar, 30px drawn in a 44px hit. */
function BarIcon({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
    return (
        <button type="button" onClick={onClick} aria-label={label} title={label}
            className="relative grid place-items-center w-[30px] h-[30px] shrink-0 text-white cursor-pointer before:absolute before:-inset-[7px] before:content-[''] focus-ring [&_svg]:w-[18px] [&_svg]:h-[18px]">
            {children}
        </button>
    );
}

/** An action row's label with its count in mono at the right. */
function Counted({ label, count }: { label: string; count: number }) {
    return (
        <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0">{label}</span>
            <span className="font-mono text-sm font-medium text-text-muted">{count.toLocaleString()}</span>
        </span>
    );
}

/** "Pick up where you left off": the last person edited, with a 3:4 portrait. */
function PickUpRow({ person, treeId, viewer }: { person: ResumedPerson; treeId: number | null; viewer: boolean }) {
    const t = useTranslations('home');
    const changeLine = useChangeLine();
    const name = displayFullName(person) || person.lastChange.EntityLabel || t('person_fallback', { id: person.Id });
    return (
        <GuardedLink href={`/people/view?id=${person.Id}`}
            className="flex items-center gap-3.5 px-4 py-4 border-b border-border no-underline text-text transition-colors active:bg-surface-2 focus-ring-inset">
            <span className={cx('relative grid place-items-center w-[72px] h-24 shrink-0 rounded-md overflow-hidden text-white', avatarClass(person.Sex))}>
                <span aria-hidden="true" className="serif text-2xl text-white/60">{getInitials(person.FirstName, person.LastName)}</span>
                {person.PrimaryMediaId && (
                    <span className="absolute inset-0">
                        <ProfileImage mediaId={person.PrimaryMediaId} treeId={treeId} alt=""
                            focalX={person.FocalX ?? 50} focalY={person.FocalY ?? 50} focalRadius={person.FocalRadius ?? null}
                            containerWidth={72} containerHeight={96} circular={false} />
                    </span>
                )}
            </span>
            <span className="flex-1 min-w-0 grid gap-0.5">
                <span className="eyebrow">{viewer ? t('mobile_last_updated') : t('mobile_pick_up')}</span>
                <span className="serif text-lg font-semibold leading-tight">{name}</span>
                {(person.BirthDate || person.DeathDate) && (
                    <Lifespan birth={person.BirthDate} death={person.DeathDate} status={livingStatus(person)} className="text-meta" />
                )}
                <span className="text-meta text-text-secondary">{changeLine(person.lastChange)}</span>
            </span>
            <ArrowUpRight className="w-[18px] h-[18px] shrink-0 text-text-muted" aria-hidden="true" />
        </GuardedLink>
    );
}

/** A recently edited person: no end icon (every row opens its person). */
function RecentRow({ person, treeId, divided }: { person: RecentPerson; treeId: number | null; divided: boolean }) {
    const t = useTranslations('home');
    const changeLine = useChangeLine();
    const name = displayFullName(person) || t('person_fallback', { id: person.Id });
    return (
        <MobileRow
            href={`/people/view?id=${person.Id}`}
            divided={divided}
            lead={
                <PersonAvatar as="span" size={36} mediaId={person.PrimaryMediaId} treeId={treeId} name={name} sex={person.Sex}
                    initials={getInitials(person.FirstName, person.LastName)}
                    focalX={person.FocalX} focalY={person.FocalY} focalRadius={person.FocalRadius} />
            }
            label={<span className="serif text-md font-semibold">{name}</span>}
            sub={changeLine(person.lastChange)}
        />
    );
}

/** Placeholder rows while the dashboard loads. */
function BodySkeleton() {
    return (
        <div aria-busy="true">
            <div className="flex items-center gap-3.5 px-4 py-4 border-b border-border">
                <span className="skeleton w-[72px] h-24 rounded-md shrink-0" aria-hidden="true" />
                <span className="flex-1 grid gap-2">
                    <span className="skeleton h-3 rounded-[4px] w-[40%]" aria-hidden="true" />
                    <span className="skeleton h-[18px] rounded-[6px] w-[65%]" aria-hidden="true" />
                    <span className="skeleton h-3 rounded-[4px] w-[30%]" aria-hidden="true" />
                </span>
            </div>
            {[0, 1, 2].map((i) => (
                <div key={i} className={cx('flex items-center gap-3 px-4 py-3', i > 0 && 'border-t border-border')}>
                    <span className="skeleton w-9 h-9 rounded-full shrink-0" aria-hidden="true" />
                    <span className="flex-1 grid gap-1.5">
                        <span className="skeleton h-[13px] rounded-[4px]" style={{ width: `${55 - i * 6}%` }} aria-hidden="true" />
                        <span className="skeleton h-[11px] rounded-[4px]" style={{ width: `${34 - i * 3}%` }} aria-hidden="true" />
                    </span>
                </div>
            ))}
        </div>
    );
}
