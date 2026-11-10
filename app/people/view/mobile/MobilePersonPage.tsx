'use client';

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { openAppMenu } from '@/app/components/nav/appEvents';
import type { PersonWithRelations, PersonGalleryMedia } from '@/lib/db/schema';
import type { Note } from '@/lib/data/types';
import type { NameVariant } from '@/app/components/person-form/NamesPanel';
import MediaLightbox from '@/app/components/lightbox/MediaLightbox';
import { livingStatus } from '@/lib/living';
import { formatDateForDisplay } from '@/lib/date-utils';
import { getDataClient } from '@/lib/data';
import { DEATH_DETAILS_CLEARED } from '@/app/components/person-form/vitalEvent';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { getInitials } from '@/lib/utils/initials';
import { avatarClass } from '@/lib/utils/avatar';
import { displayFullName } from '@/lib/utils/names';
import ProfileImage from '@/app/components/ProfileImage';
import { GlassButton, Lifespan, PageShell, cx } from '@/app/components/ui';
import { ConfirmSheet } from '@/app/components/ui/Sheet';
import { Skeleton } from '@/app/components/SkeletonLoader';
import { Camera, Menu, Network, Pencil } from '@/lib/icons';
import { familyMembers, familyOf, journeyOf, nameBarParts, timelineFacts, vitalDeath } from './model';
import { EventsPane, FamilyPane, MediaPane, OverviewPane, SourcesPane, type LivingChoice, type PaneContext } from './panes';
import { EventSheet, type EventFlow } from './EventSheet';
import { useChange } from './useChange';
import { useHeroHeader } from './useHeroHeader';
import { AddFamilySheet, type AddFamilyFlow } from './AddFamilySheet';
import { PortraitFrame } from './PortraitFrame';
import { PortraitSheets, initialCrop } from './PortraitSheets';
import { BiographySheet, NameSheet, NoteSheet } from './ProfileSheets';
import { JourneyPage } from './JourneyPage';
import { EditPersonSheet } from './EditPersonSheet';
import { useTabSwipe } from './useTabSwipe';

/*
 * The person page on phones (#1046, tracking #1054): a 4:3 photo hero, a slim name
 * bar once the photo scrolls away, sticky tabs and read-only panes. Desktop keeps
 * PersonDetailView's own layout; the two are chosen with CSS, so a phone never
 * paints the desktop page first. Every edit is a sheet (#1047–#1053).
 */

const TABS = ['overview', 'events', 'family', 'media', 'sources'] as const;
type Tab = (typeof TABS)[number];

/** A tab panel is at least a screen tall, so a short tab still keeps the tabs stuck. */
const PANEL_STYLE: React.CSSProperties = {
    minHeight: 'calc(100dvh - var(--nav-h) - var(--mp-bar-h) - 44px)',
    paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))',
};

export type MobilePersonPageProps = Omit<PaneContext, 'family' | 'onShowTab' | 'onEdit' | 'onAddFamily' | 'onEvent' | 'onSetStatus' | 'flash'
    | 'journey' | 'onShowJourney' | 'onBiography' | 'onName' | 'onNote'> & {
    /** Coordinates of the places they've been, keyed by place text (the Journey). */
    placeCoords: Record<string, { lat: number; lng: number }>;
    onMediaChanged: () => void;
    /** Reload the person and their citations after a write (and after its Undo). */
    onChanged: () => Promise<void> | void;
};


/** Width of an element, kept current. */
function useWidth<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setWidth(el.clientWidth));
        ro.observe(el);
        setWidth(el.clientWidth);
        return () => ro.disconnect();
    }, []);
    return [ref, width] as const;
}

/**
 * The name bar's one line, by the cascade rule (design-system.md → Mobile → Type):
 * given name and surname at 16; then the whole name at 13; then 16 again with the
 * given name cut so the surname stays whole.
 */
function CascadeName({ given, surname }: { given: string; surname: string }) {
    const ref = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const fit = () => {
            for (const step of ['full', 'small', 'cut']) {
                el.dataset.step = step;
                if (step === 'cut' || el.scrollWidth <= el.clientWidth + 0.5) break;
            }
        };
        fit();
        const ro = new ResizeObserver(fit);
        ro.observe(el);
        return () => ro.disconnect();
    }, [given, surname]);
    return (
        <span ref={ref} data-step="full" className="group/name flex min-w-0 overflow-hidden whitespace-nowrap serif font-semibold text-md leading-tight data-[step=small]:text-sm">
            <span className="shrink-0 group-data-[step=cut]/name:shrink group-data-[step=cut]/name:min-w-0 group-data-[step=cut]/name:overflow-hidden group-data-[step=cut]/name:text-ellipsis">{given}</span>
            {surname && <span className="shrink-0 pl-[0.28em]">{surname}</span>}
        </span>
    );
}

/** The name bar's round portrait: this person's face tag, else the photo's own crop. */
function portraitFocal(photo: PersonGalleryMedia) {
    return photo.TagRegionW != null && photo.TagRegionH != null
        ? { x: (photo.TagRegionX ?? 0) + photo.TagRegionW / 2, y: (photo.TagRegionY ?? 0) + photo.TagRegionH / 2, r: Math.max(photo.TagRegionW, photo.TagRegionH) }
        : { x: photo.FocalX ?? 50, y: photo.FocalY ?? 50, r: photo.FocalRadius ?? null };
}

function Thumb({ person, photo, treeId }: { person: PersonWithRelations; photo: PersonGalleryMedia; treeId: number | null }) {
    const focal = portraitFocal(photo);
    return (
        <ProfileImage mediaId={photo.Id} treeId={treeId} alt={displayFullName(person)} focalX={focal.x} focalY={focal.y} focalRadius={focal.r}
            containerWidth={30} containerHeight={30} circular loading="eager" />
    );
}

export function MobilePersonPage(props: MobilePersonPageProps) {
    const { person, media, treeId, role, language, placeCoords, onMediaChanged, onChanged } = props;
    const t = useTranslations('mobilePerson');
    const te = useTranslations('mobileEvents');
    const tm = useTranslations('mobileProfile');
    const words = useDateQualifierWords();
    const router = useRouter();
    const ids = useId();
    const [tab, setTab] = useState<Tab>('overview');
    const [heroRef, heroWidth] = useWidth<HTMLElement>();
    const barRef = useRef<HTMLDivElement>(null);
    const tabsRef = useRef<HTMLDivElement>(null);
    const anchorRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const [announce, setAnnounce] = useState('');
    const [barShown, setBarShown] = useState(false);
    useHeroHeader();
    const [editOpen, setEditOpen] = useState(false);
    const [eventFlow, setEventFlow] = useState<EventFlow | null>(null);
    const [familyFlow, setFamilyFlow] = useState<AddFamilyFlow | null>(null);
    const [statusAsk, setStatusAsk] = useState<Exclude<LivingChoice, 'deceased'> | null>(null);
    const [statusBusy, setStatusBusy] = useState(false);
    const [flash, setFlash] = useState<string | null>(null);
    const [portraitOpen, setPortraitOpen] = useState(false);
    const [viewing, setViewing] = useState<PersonGalleryMedia | null>(null);
    const [bioOpen, setBioOpen] = useState(false);
    const [nameFlow, setNameFlow] = useState<{ variant: NameVariant | null } | null>(null);
    const [noteFlow, setNoteFlow] = useState<{ note: Note | null } | null>(null);
    const [journeyOpen, setJourneyOpen] = useState(false);
    // The last flow stays put while its sheet animates away.
    const [lastName, setLastName] = useState<{ variant: NameVariant | null }>({ variant: null });
    const [lastNote, setLastNote] = useState<{ note: Note | null }>({ note: null });
    if (nameFlow && nameFlow !== lastName) setLastName(nameFlow);
    if (noteFlow && noteFlow !== lastNote) setLastNote(noteFlow);
    const run = useChange({ treeId, canUndo: role === 'editor', onChanged });

    const photo = media.find((m) => m.IsPersonPrimary);
    // The family photo stacks show this person by the same face as the name bar.
    const focal = photo ? portraitFocal(photo) : null;
    const family = familyOf(person, photo && focal ? { PrimaryMediaId: photo.Id, FocalX: focal.x, FocalY: focal.y, FocalRadius: focal.r } : undefined);
    const { given, surname } = nameBarParts(person);
    const fullName = displayFullName(person) || t('unknown');
    const editor = role !== 'viewer';

    // A new person opens on Overview.
    const [shownId, setShownId] = useState(person.Id);
    if (shownId !== person.Id) { setShownId(person.Id); setTab('overview'); }

    // The slim bar fades in once the photo has scrolled under it.
    useEffect(() => {
        const update = () => {
            const hero = heroRef.current, bar = barRef.current;
            if (!hero || !bar) return;
            setBarShown(hero.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom);
        };
        update();
        window.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
    }, [heroRef]);

    // Each tab keeps its own place (#1053). With the photo scrolled away, a tab opens where
    // it was left (its top the first time) and the tabs stay stuck; with the photo in view
    // the page stays put.
    const depths = useRef<Partial<Record<Tab, number>>>({});
    const pendingScroll = useRef<number | null>(null);
    /** How far the panel has scrolled under the stuck tabs, and where that starts. */
    const tabScroll = () => {
        const anchor = anchorRef.current, tabs = tabsRef.current;
        if (!anchor || !tabs) return null;
        const stuckAt = anchor.getBoundingClientRect().top + window.scrollY - (parseFloat(getComputedStyle(tabs).top) || 0);
        return { stuckAt, depth: window.scrollY - stuckAt };
    };
    const switchTab = (next: Tab) => {
        const at = tabScroll();
        if (at && at.depth > 0) {
            depths.current[tab] = at.depth;
            pendingScroll.current = at.stuckAt + (depths.current[next] ?? 0);
        }
        setTab(next);
    };
    // Before paint, so the new tab never shows at the old one's place.
    useLayoutEffect(() => {
        const top = pendingScroll.current;
        if (top == null) return;
        pendingScroll.current = null;
        window.scrollTo({ top });
    }, [tab]);

    const onTabKey = (e: React.KeyboardEvent, i: number) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = TABS[(i + step + TABS.length) % TABS.length];
        switchTab(next);
        tabsRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
    };

    // Drag the page sideways for the next tab (#1053); a screen reader hears where it landed.
    const covered = eventFlow != null || familyFlow != null || statusAsk != null || portraitOpen || viewing != null
        || bioOpen || nameFlow != null || noteFlow != null || journeyOpen || editOpen;
    const neighbour = (dir: 1 | -1): Tab | null => TABS[TABS.indexOf(tab) + dir] ?? null;
    const peek = useTabSwipe({
        rootRef, trackRef, enabled: !covered,
        neighbour,
        onCommit: (dir) => {
            const next = neighbour(dir);
            if (!next) return;
            switchTab(next);
            setAnnounce(t('tab_shown', { tab: t(`tab_${next}`) }));
        },
    });
    const peekTab = peek ? neighbour(peek) : null;
    // The neighbour rides in showing the part of it the swipe will land on (measured once
    // per neighbour shown).
    const ghostRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const ghost = ghostRef.current, tabs = tabsRef.current;
        const at = tabScroll();
        if (!ghost || !peekTab || !tabs || !at || at.depth <= 0) return;
        const room = window.innerHeight - tabs.getBoundingClientRect().bottom;
        const landing = Math.min(depths.current[peekTab] ?? 0, Math.max(0, ghost.offsetHeight - room));
        ghost.style.top = `${at.depth - landing}px`;
    }, [peekTab]);

    const onEdit = () => setEditOpen(true);

    // The changed row flashes once; clearing it lets the same row flash again later.
    const flashRow = useCallback((key: string) => setFlash(key), []);
    useEffect(() => {
        if (!flash) return;
        const timer = window.setTimeout(() => setFlash(null), 1700);
        return () => window.clearTimeout(timer);
    }, [flash]);

    // Living status lives in the Died panel (#1047). A recorded death outranks the flag
    // everywhere (#895), so Living or Unknown asks to delete it first.
    const death = vitalDeath(person);
    const deathWhen = death
        ? [death.date ? formatDateForDisplay(death.date, language, words) : null, death.place?.split(',')[0]?.trim() || null].filter(Boolean).join(' · ')
        : '';
    const writeStatus = async (next: LivingChoice, dropDeath: boolean) => {
        const IsDeceased = next === 'living' ? 0 : next === 'deceased' ? 1 : null;
        const message = dropDeath
            ? te(next === 'living' ? 'death_deleted_living' : 'death_deleted_unknown')
            : te(next === 'living' ? 'marked_living' : next === 'deceased' ? 'marked_deceased' : 'marked_unknown');
        const ok = await run(async () => {
            const client = await getDataClient();
            return client.people.update(person.Id, dropDeath ? { ...DEATH_DETAILS_CLEARED, IsDeceased } : { IsDeceased }, treeId);
        }, { message, detail: dropDeath ? deathWhen || undefined : undefined });
        if (ok) flashRow(`death-${person.Id}`);
        return ok;
    };
    const onSetStatus = (next: LivingChoice) => {
        if (death && next !== 'deceased') { setStatusAsk(next); return; }
        void writeStatus(next, false);
    };
    const confirmStatus = async () => {
        if (!statusAsk) return;
        setStatusBusy(true);
        await writeStatus(statusAsk, true);
        setStatusBusy(false);
        setStatusAsk(null);
    };

    const journey = useMemo(() => journeyOf(person, placeCoords), [person, placeCoords]);
    const ctx: PaneContext = {
        ...props, family, onEdit, onShowTab: (x) => switchTab(x), onAddFamily: (role) => setFamilyFlow({ role: role ?? null }),
        onEvent: setEventFlow, onSetStatus, flash, journey,
        onShowJourney: () => setJourneyOpen(true),
        onBiography: () => setBioOpen(true),
        onName: (variant) => setNameFlow({ variant }),
        onNote: (note) => setNoteFlow({ note }),
    };
    const counts: Record<Tab, number | null> = {
        overview: null,
        events: timelineFacts(person).length,
        family: familyMembers(family).length,
        media: media.length,
        sources: new Set(props.facts.flatMap((f) => f.citations.map((c) => c.SourceId))).size,
    };
    // The name bar is the hero's, so its dates are read as facts (#935).
    const years = <Lifespan birth={person.BirthDate} death={person.DeathDate} status={livingStatus(person)} tone="evidence" />;
    const heroHeight = Math.round(heroWidth * 0.75);

    return (
        <div ref={rootRef} className="mp-root md:hidden overflow-x-clip">
            <header ref={heroRef} className="hero-dark !rounded-none !p-0 !shadow-none relative aspect-[4/3] overflow-hidden">
                {photo ? (
                    <div className="absolute inset-0 overflow-hidden">
                        {heroWidth > 0 && (
                            <PortraitFrame key={photo.Id} photo={{ mediaId: photo.Id }} treeId={treeId} frame={{ w: heroWidth, h: heroHeight }}
                                crop={initialCrop(photo)} alt={fullName} eager />
                        )}
                    </div>
                ) : (
                    <div aria-hidden="true" className={cx(avatarClass(person.Sex), 'absolute inset-0 grid place-items-center pb-[18%]')}>
                        <span className="serif text-white/40 tracking-[0.04em] mp-monogram">{getInitials(person.FirstName, person.LastName)}</span>
                    </div>
                )}
                <div aria-hidden="true" className={cx('absolute inset-0', photo ? 'mp-scrim' : 'mp-scrim-light')} />
                <div className="absolute inset-x-0 flex justify-between px-3 z-[2]" style={{ top: 'calc(10px + var(--mp-sat))' }}>
                    <GlassButton label={t('menu')} icon={<Menu />} onClick={openAppMenu} />
                    <span className="flex gap-2">
                        <GlassButton label={t('tree')} word={t('tree')} icon={<Network />} href={`/tree?rootId=${person.Id}`} />
                        {editor && <GlassButton label={t('edit')} icon={<Pencil />} onClick={onEdit} />}
                    </span>
                </div>
                <div className="absolute inset-x-4 bottom-3.5 z-[2] grid gap-1.5">
                    <h1 className="m-0 serif font-semibold text-white mp-hero-name text-balance">{fullName}</h1>
                    {!photo && editor && (
                        <button type="button" onClick={() => setPortraitOpen(true)}
                            className="justify-self-start inline-flex items-center gap-1.5 min-h-[34px] px-3 rounded-full bg-black/[0.32] border border-white/30 text-white text-sm font-semibold cursor-pointer focus-ring [&_svg]:w-3.5 [&_svg]:h-3.5">
                            <Camera aria-hidden="true" />{t('add_portrait')}
                        </button>
                    )}
                </div>
                {/* Editors tap the photo for portrait actions (#1051); viewers see it full screen.
                    It sits under the buttons drawn over it, but after them in focus order (#1053). */}
                {photo && (
                    <button type="button" onClick={() => (editor ? setPortraitOpen(true) : setViewing(photo))}
                        aria-label={editor ? tm('portrait_actions') : tm('view_photo')}
                        className="absolute inset-0 z-[1] w-full cursor-pointer bg-transparent focus-ring-inset" />
                )}
            </header>

            <div ref={barRef} data-mp-bar aria-hidden={!barShown} inert={!barShown}
                className={cx('hero-dark mp-slim-bar !rounded-none !shadow-none fixed inset-x-0 z-30 flex items-center gap-2.5 !px-3 !pb-[7px] transition-[opacity,transform,visibility] duration-[180ms] motion-reduce:transition-none',
                    barShown ? 'opacity-100 translate-y-0' : 'invisible opacity-0 -translate-y-2 pointer-events-none')}
                style={{ top: 'var(--nav-h)', minHeight: 'var(--mp-bar-h)', paddingTop: 'calc(7px + var(--mp-sat))' }}>
                <button type="button" onClick={openAppMenu} aria-label={t('menu')} title={t('menu')}
                    className="relative grid place-items-center w-[30px] h-[30px] shrink-0 text-white cursor-pointer before:absolute before:-inset-[7px] before:content-[''] focus-ring [&_svg]:w-[18px] [&_svg]:h-[18px]">
                    <Menu aria-hidden="true" />
                </button>
                <span aria-hidden="true" className={cx('grid place-items-center w-[30px] h-[30px] shrink-0 rounded-full overflow-hidden text-xs font-semibold text-white', !photo && avatarClass(person.Sex))}>
                    {photo ? <Thumb person={person} photo={photo} treeId={treeId} /> : getInitials(person.FirstName, person.LastName)}
                </span>
                <span className="flex-1 min-w-0 grid gap-px">
                    <CascadeName given={given || t('unknown')} surname={surname} />
                    <span className="font-mono text-xs text-[color:var(--color-date)]">
                        {person.BirthDate || person.DeathDate ? years : <span className="font-sans text-text-muted">{t('no_dates_yet')}</span>}
                    </span>
                </span>
                {editor ? (
                    <button type="button" onClick={onEdit} aria-label={t('edit')} title={t('edit')}
                        className="relative grid place-items-center w-[30px] h-[30px] shrink-0 text-white cursor-pointer before:absolute before:-inset-[7px] before:content-[''] focus-ring [&_svg]:w-[18px] [&_svg]:h-[18px]">
                        <Pencil aria-hidden="true" />
                    </button>
                ) : <span className="w-[30px] shrink-0" />}
            </div>

            <div ref={anchorRef} />
            <div ref={tabsRef} role="tablist" aria-label={t('tabs_label')}
                className="sticky z-20 flex overflow-x-auto hscroll-strip bg-[color:var(--surface)] border-b border-border"
                style={{ top: 'calc(var(--nav-h) + var(--mp-bar-h))' }}>
                {TABS.map((key, i) => {
                    const selected = key === tab;
                    const n = counts[key];
                    return (
                        <button key={key} type="button" role="tab" data-tab={key} id={`${ids}-tab-${key}`} aria-selected={selected}
                            aria-controls={`${ids}-panel`} tabIndex={selected ? 0 : -1} onClick={() => switchTab(key)} onKeyDown={(e) => onTabKey(e, i)}
                            className={cx('shrink-0 min-h-11 px-2.5 pt-[13px] pb-[11px] text-sm whitespace-nowrap border-b-2 cursor-pointer focus-ring-inset',
                                selected ? 'text-text font-semibold border-text' : 'text-text-muted border-transparent')}>
                            {t(`tab_${key}`)}
                            {n != null && n > 0 && <span className="font-mono font-normal text-xs text-text-muted ml-1">{n}</span>}
                        </button>
                    );
                })}
            </div>

            <div ref={trackRef} className="relative">
                <div id={`${ids}-panel`} role="tabpanel" aria-labelledby={`${ids}-tab-${tab}`} style={PANEL_STYLE}>
                    <Pane tab={tab} c={ctx} onMediaChanged={onMediaChanged} />
                </div>
                {/* The neighbour rides in beside the panel during a swipe; it isn't the page yet. */}
                {peekTab && (
                    <div ref={ghostRef} aria-hidden="true" inert style={PANEL_STYLE}
                        className={cx('absolute top-0 w-full bg-[color:var(--surface)] pointer-events-none', peek === 1 ? 'left-full' : 'right-full')}>
                        <Pane tab={peekTab} c={ctx} onMediaChanged={onMediaChanged} />
                    </div>
                )}
            </div>
            <p className="sr-only" aria-live="polite">{announce}</p>

            <EventSheet
                flow={eventFlow}
                onClose={() => setEventFlow(null)}
                person={person}
                treeId={treeId}
                language={language}
                canDelete={role === 'editor'}
                facts={props.facts}
                sourceNumbers={props.sourceNumbers}
                run={run}
                citeSheets={props.citeSheets}
                onSaved={flashRow}
            />

            <AddFamilySheet flow={familyFlow} onClose={() => setFamilyFlow(null)} person={person} portrait={photo} treeId={treeId} canUndo={role === 'editor'} run={run} />

            <ConfirmSheet
                open={statusAsk != null}
                title={te('status_confirm_title', { name: given || fullName })}
                body={te(statusAsk === 'living' ? 'status_confirm_living' : 'status_confirm_unknown', { what: deathWhen || te('death_no_details') })}
                confirmLabel={te(statusAsk === 'living' ? 'status_confirm_pill_living' : 'status_confirm_pill_unknown')}
                keepLabel={te('keep_death')}
                onConfirm={confirmStatus}
                onClose={() => setStatusAsk(null)}
                busy={statusBusy}
            />

            <PortraitSheets
                open={portraitOpen}
                onClose={() => setPortraitOpen(false)}
                person={person}
                media={media}
                treeId={treeId}
                canRemove={role === 'editor'}
                run={run}
                onViewPhoto={setViewing}
            />
            {viewing && (
                <MediaLightbox
                    items={[viewing]}
                    index={0}
                    treeId={treeId}
                    canEdit={editor}
                    canDelete={role === 'editor'}
                    context="person"
                    galleryPersonId={person.Id}
                    galleryPersonName={person}
                    onClose={() => setViewing(null)}
                    onChangeIndex={() => {}}
                    onPrimaryChanged={onMediaChanged}
                    onTagsChanged={onMediaChanged}
                    onDeleted={() => { setViewing(null); onMediaChanged(); }}
                />
            )}
            <BiographySheet open={bioOpen} onClose={() => setBioOpen(false)} person={person} biography={props.biography}
                treeId={treeId} language={language} run={run} onSaved={() => {}} />
            <NameSheet open={nameFlow != null} variant={(nameFlow ?? lastName).variant} variants={props.variants} onClose={() => setNameFlow(null)} person={person}
                treeId={treeId} canDelete={role === 'editor'} facts={props.facts} sourceNumbers={props.sourceNumbers} run={run} citeSheets={props.citeSheets} />
            <NoteSheet open={noteFlow != null} note={(noteFlow ?? lastNote).note} onClose={() => setNoteFlow(null)} person={person}
                treeId={treeId} canDelete={role === 'editor'} run={run} />
            <JourneyPage open={journeyOpen} onClose={() => setJourneyOpen(false)} places={journey} />

            <EditPersonSheet open={editOpen} onClose={() => setEditOpen(false)} person={person} treeId={treeId}
                canDelete={role === 'editor'} run={run} onDeleted={() => { setEditOpen(false); router.push('/people'); }} />
        </div>
    );
}

function Pane({ tab, c, onMediaChanged }: { tab: Tab; c: PaneContext; onMediaChanged: () => void }) {
    switch (tab) {
        case 'overview': return <OverviewPane c={c} />;
        case 'events': return <EventsPane c={c} />;
        case 'family': return <FamilyPane c={c} />;
        case 'media': return <MediaPane c={c} onMediaChanged={onMediaChanged} />;
        case 'sources': return <SourcesPane c={c} />;
    }
}

/** The phone's loading paint: the hero and tab shapes, never the desktop hero. */
export function MobilePersonSkeleton() {
    useHeroHeader();
    return (
        <PageShell variant="detail" busy contentClassName="hidden" topBar={(
            <div className="mp-root">
                <div className="hero-dark !rounded-none !p-0 !shadow-none aspect-[4/3]" />
                <div className="flex gap-4 px-4 py-3.5 border-b border-border">
                    {[64, 52, 52, 48, 56].map((w, i) => <Skeleton key={i} className="h-3.5" style={{ width: w }} />)}
                </div>
                <div className="grid gap-3 p-4">
                    <Skeleton className="h-4 w-[60%]" />
                    <Skeleton className="h-4 w-[80%]" />
                    <Skeleton className="h-4 w-[45%]" />
                </div>
            </div>
        )} />
    );
}
