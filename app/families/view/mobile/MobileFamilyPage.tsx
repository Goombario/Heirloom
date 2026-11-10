'use client';

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { CiteSheetsSlot } from '@/app/components/citations/CiteSheets';
import { openAppMenu } from '@/app/components/nav/appEvents';
import ProfileImage from '@/app/components/ProfileImage';
import AddMediaModal from '@/app/components/media/AddMediaModal';
import { GlassButton, cx, showChangeToast } from '@/app/components/ui';
import { getDataClient } from '@/lib/data';
import type { Note } from '@/lib/data/types';
import { getInitials } from '@/lib/utils/initials';
import { avatarClass } from '@/lib/utils/avatar';
import { Menu, Network, Pencil, Plus } from '@/lib/icons';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useChange } from '@/app/people/view/mobile/useChange';
import { useTabSwipe } from '@/app/people/view/mobile/useTabSwipe';
import { useHeroHeader } from '@/app/people/view/mobile/useHeroHeader';
import type { PartnerPerson } from '../useFamilyDetail';
import { partnerName } from '../derive';
import { coupleName, kindKey, timelineRows, unionRange, type Slot } from './model';
import { MediaPane, OverviewPane, SourcesPane, TimelinePane, type FamilyPaneContext } from './panes';
import { FamilyEventSheet, type FamilyEventFlow } from './FamilyEventSheet';
import { FamilyNoteSheet, PeopleSheets, type PeopleFlow } from './PeopleSheets';

/*
 * The family page on phones (#1062, umbrella #1067): a 4:3 hero split between the
 * partners, a slim name bar once it scrolls away, sticky tabs and the panes. Desktop
 * keeps FamilyDetailView's own layout; the two are chosen with CSS, as on the person
 * page (#1046). Every edit is a sheet.
 */

const TABS = ['overview', 'timeline', 'media', 'sources'] as const;
type Tab = (typeof TABS)[number];

/** A tab panel is at least a screen tall, so a short tab still keeps the tabs stuck. */
const PANEL_STYLE: React.CSSProperties = {
    minHeight: 'calc(100dvh - var(--nav-h) - var(--mp-bar-h) - 44px)',
    paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))',
};

export type MobileFamilyPageProps = Omit<FamilyPaneContext, 'notes' | 'media' | 'onEvent' | 'onAddPartner' | 'onAddChild' | 'onEditChildren'
    | 'onNote' | 'onAddMedia' | 'onMediaChanged' | 'onUnlinkMedia' | 'flash'> & {
    /** Fetch the family's notes and media: only on phones, where this page shows. */
    active: boolean;
    citeSheets: CiteSheetsSlot;
    /** Reload the family and its citations after a write (and after its Undo). */
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

/** One half of the hero: the partner's photo or monogram, or the hatched unknown half. */
/**
 * How much wider than the face crop each hero half shows. The crop's circle spans the
 * half's full height, so a tall half was all face; the owner's phone review asked for a
 * little less zoom.
 */
const HALF_ZOOM_OUT = 1.25;

function HeroHalf({ person, width, height, treeId, side, onAdd }: {
    person: PartnerPerson | null; width: number; height: number; treeId: number | null; side: 'left' | 'right';
    onAdd?: () => void;
}) {
    const t = useTranslations('familyPhone');
    const tp = useTranslations('mobilePerson');
    const edge = side === 'left' ? 'border-r border-black/40' : '';
    if (!person) {
        return (
            <div className={cx('relative mf-hatch-dark grid place-items-center pb-[22%]', edge)}>
                {onAdd ? (
                    <button type="button" onClick={onAdd}
                        className="relative z-[2] inline-flex items-center gap-1.5 min-h-[34px] px-3 rounded-full bg-black/[0.32] border border-white/30 text-white text-sm font-semibold cursor-pointer focus-ring [&_svg]:w-3.5 [&_svg]:h-3.5">
                        <Plus aria-hidden="true" />{t('add_partner')}
                    </button>
                ) : (
                    <span className="text-sm text-white/60">{t('partner_unknown')}</span>
                )}
            </div>
        );
    }
    const name = partnerName(person) || tp('unknown');
    return (
        <Link href={`/people/view?id=${person.Id}`} aria-label={t('open_person', { name })}
            className={cx('relative block overflow-hidden focus-ring-inset', edge, !person.PrimaryMediaId && avatarClass(person.Sex))}>
            {person.PrimaryMediaId != null ? (
                width > 0 && (
                    <ProfileImage mediaId={person.PrimaryMediaId} treeId={treeId} alt="" focalX={person.FocalX ?? 50} focalY={person.FocalY ?? 50}
                        focalRadius={person.FocalRadius != null ? person.FocalRadius * HALF_ZOOM_OUT : null} containerWidth={width} containerHeight={height} circular={false} loading="eager" />
                )
            ) : (
                <span aria-hidden="true" className="absolute inset-0 grid place-items-center pb-[22%]">
                    <span className="serif text-white/40 tracking-[0.04em] mf-monogram">{getInitials(person.FirstName, person.LastName)}</span>
                </span>
            )}
        </Link>
    );
}

/** The name bar's round portrait of one partner. */
function Thumb({ person, treeId }: { person: PartnerPerson | null; treeId: number | null }) {
    if (!person) return <span aria-hidden="true" className="w-[30px] h-[30px] shrink-0 rounded-full mf-hatch-dark border border-white/20" />;
    return (
        <span aria-hidden="true" className={cx('grid place-items-center w-[30px] h-[30px] shrink-0 rounded-full overflow-hidden text-xs font-semibold text-white border-2 border-[color:var(--color-surface)]',
            person.PrimaryMediaId == null && avatarClass(person.Sex))}>
            {person.PrimaryMediaId != null
                ? <ProfileImage mediaId={person.PrimaryMediaId} treeId={treeId} alt="" focalX={person.FocalX ?? 50} focalY={person.FocalY ?? 50}
                    focalRadius={person.FocalRadius ?? null} containerWidth={30} containerHeight={30} circular loading="eager" />
                : getInitials(person.FirstName, person.LastName)}
        </span>
    );
}

export function MobileFamilyPage(props: MobileFamilyPageProps) {
    const { data, treeId, role, active, onChanged } = props;
    const familyId = data.family.Id;
    const t = useTranslations('familyPhone');
    const tp = useTranslations('mobilePerson');
    const { reportError } = useErrorToast();
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
    const [eventFlow, setEventFlow] = useState<FamilyEventFlow | null>(null);
    const [peopleFlow, setPeopleFlow] = useState<PeopleFlow | null>(null);
    const [noteFlow, setNoteFlow] = useState<{ note: Note | null } | null>(null);
    const [lastNote, setLastNote] = useState<{ note: Note | null }>({ note: null });
    if (noteFlow && noteFlow !== lastNote) setLastNote(noteFlow);
    const [uploadOpen, setUploadOpen] = useState(false);
    const [flash, setFlash] = useState<string | null>(null);
    const [notes, setNotes] = useState<Note[]>([]);
    const [media, setMedia] = useState<FamilyPaneContext['media']>(null);
    const editor = role !== 'viewer';

    // Notes and media live outside the family row; each loads on its own.
    const loadNotes = useCallback(async () => {
        try {
            const client = await getDataClient();
            setNotes(await client.notes.listForOwner('Families', familyId, treeId));
        } catch { /* the notes section stays as it was */ }
    }, [familyId, treeId]);
    const loadMedia = useCallback(async () => {
        try {
            const client = await getDataClient();
            setMedia(await client.media.listGalleryForOwner('Families', familyId, treeId));
        } catch { setMedia((m) => m ?? []); }
    }, [familyId, treeId]);
    useEffect(() => {
        if (!active) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- a fetch on mount, as the person page's media
        void loadNotes();
        void loadMedia();
    }, [active, loadNotes, loadMedia]);

    const changed = useCallback(async () => {
        await Promise.all([onChanged(), loadNotes(), loadMedia()]);
    }, [onChanged, loadNotes, loadMedia]);
    const run = useChange({ treeId, canUndo: role === 'editor', onChanged: changed });

    // A new family opens on Overview.
    const [shownId, setShownId] = useState(familyId);
    if (shownId !== familyId) { setShownId(familyId); setTab('overview'); setMedia(null); setNotes([]); }

    // The slim bar fades in once the hero has scrolled under it.
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

    // Each tab keeps its own place, as on the person page (#1053).
    const depths = useRef<Partial<Record<Tab, number>>>({});
    const pendingScroll = useRef<number | null>(null);
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

    const covered = eventFlow != null || peopleFlow != null || noteFlow != null || uploadOpen;
    const neighbour = (dir: 1 | -1): Tab | null => TABS[TABS.indexOf(tab) + dir] ?? null;
    const peek = useTabSwipe({
        rootRef, trackRef, enabled: !covered,
        neighbour,
        onCommit: (dir) => {
            const next = neighbour(dir);
            if (!next) return;
            switchTab(next);
            setAnnounce(tp('tab_shown', { tab: t(`tab_${next}`) }));
        },
    });
    const peekTab = peek ? neighbour(peek) : null;
    const ghostRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const ghost = ghostRef.current, tabs = tabsRef.current;
        const at = tabScroll();
        if (!ghost || !peekTab || !tabs || !at || at.depth <= 0) return;
        const room = window.innerHeight - tabs.getBoundingClientRect().bottom;
        const landing = Math.min(depths.current[peekTab] ?? 0, Math.max(0, ghost.offsetHeight - room));
        ghost.style.top = `${at.depth - landing}px`;
    }, [peekTab]);

    // The changed row flashes once; clearing it lets the same row flash again later.
    const flashRow = useCallback((key: string) => setFlash(key), []);
    useEffect(() => {
        if (!flash) return;
        const timer = window.setTimeout(() => setFlash(null), 1700);
        return () => window.clearTimeout(timer);
    }, [flash]);

    const name = coupleName(data.partner1, data.partner2) || t('family');
    const range = unionRange(data);
    const eyebrow = [t(`kind_${kindKey(data.family.Type)}`), range].filter(Boolean).join(' · ');
    const firstPartner = data.partner1 ?? data.partner2;

    // Delete family: back to where they came from, with Undo that brings it back here.
    const deleteFamily = async (): Promise<boolean> => {
        let auditId: number | null = null;
        try {
            const client = await getDataClient();
            ({ auditId } = await client.families.remove(familyId, treeId));
        } catch (e) {
            reportError(e);
            return false;
        }
        if (window.history.length > 1) router.back();
        else router.push('/families');
        showChangeToast({
            message: t('family_deleted', { name }),
            detail: t('family_deleted_detail'),
            onUndo: role === 'editor' && auditId != null ? async () => {
                try {
                    const client = await getDataClient();
                    await client.audit.revert([auditId as number], treeId);
                    router.push(`/families/view?id=${familyId}`);
                } catch (e) {
                    reportError(e);
                }
            } : undefined,
        });
        return true;
    };

    const unlinkMedia = (mediaId: number) => {
        void run(async () => {
            const client = await getDataClient();
            await client.media.unlinkFromOwner(mediaId, 'Families', familyId, treeId);
            return { auditIds: [] };
        }, { message: t('media_removed') });
    };

    const ctx: FamilyPaneContext = {
        ...props, notes, media, flash,
        onEvent: setEventFlow,
        onAddPartner: (slot: Slot) => setPeopleFlow({ kind: 'add-partner', slot }),
        onAddChild: () => setPeopleFlow({ kind: 'add-child' }),
        onEditChildren: () => setPeopleFlow({ kind: 'children' }),
        onNote: (note) => setNoteFlow({ note }),
        onAddMedia: () => setUploadOpen(true),
        onMediaChanged: () => { void loadMedia(); },
        onUnlinkMedia: unlinkMedia,
    };
    const counts: Record<Tab, number | null> = {
        overview: null,
        timeline: timelineRows(data).length,
        media: media?.length ?? 0,
        sources: new Set(props.facts.flatMap((f) => f.citations.map((c) => c.SourceId))).size,
    };
    const heroHeight = Math.round(heroWidth * 0.75);
    const half = Math.floor(heroWidth / 2);
    const missing: Slot | null = !data.partner1 ? 'partner1' : !data.partner2 ? 'partner2' : null;
    const relevantPersonIds = [data.partner1?.Id, data.partner2?.Id, ...data.children.map((c) => c.Id)].filter((x): x is number => x != null);

    return (
        <div ref={rootRef} className="mp-root md:hidden overflow-x-clip">
            <header ref={heroRef} className="hero-dark !rounded-none !p-0 !shadow-none relative aspect-[4/3] overflow-hidden">
                <div className="absolute inset-0 grid grid-cols-2">
                    <HeroHalf person={data.partner1} width={half} height={heroHeight} treeId={treeId} side="left"
                        onAdd={editor && missing === 'partner1' ? () => setPeopleFlow({ kind: 'add-partner', slot: 'partner1' }) : undefined} />
                    <HeroHalf person={data.partner2} width={heroWidth - half} height={heroHeight} treeId={treeId} side="right"
                        onAdd={editor && missing === 'partner2' ? () => setPeopleFlow({ kind: 'add-partner', slot: 'partner2' }) : undefined} />
                </div>
                <div aria-hidden="true" className="absolute inset-0 mp-scrim pointer-events-none" />
                <div className="absolute inset-x-0 flex justify-between px-3 z-[2]" style={{ top: 'calc(10px + var(--mp-sat))' }}>
                    <GlassButton label={t('menu')} icon={<Menu />} onClick={openAppMenu} />
                    <span className="flex gap-2">
                        {firstPartner && <GlassButton label={tp('tree')} word={tp('tree')} icon={<Network />} href={`/tree?rootId=${firstPartner.Id}`} />}
                        {editor && <GlassButton label={t('edit_family')} icon={<Pencil />} onClick={() => setPeopleFlow({ kind: 'menu' })} />}
                    </span>
                </div>
                <div className="absolute inset-x-4 bottom-3.5 z-[2] grid gap-1 pointer-events-none">
                    <p className="m-0 text-meta font-semibold uppercase tracking-[0.08em] text-white/75">{eyebrow}</p>
                    <h1 className="m-0 serif font-semibold text-white mp-hero-name text-balance">{name}</h1>
                </div>
            </header>

            <div ref={barRef} data-mp-bar aria-hidden={!barShown} inert={!barShown}
                className={cx('hero-dark mp-slim-bar !rounded-none !shadow-none fixed inset-x-0 z-30 flex items-center gap-2.5 !px-3 !pb-[7px] transition-[opacity,transform,visibility] duration-[180ms] motion-reduce:transition-none',
                    barShown ? 'opacity-100 translate-y-0' : 'invisible opacity-0 -translate-y-2 pointer-events-none')}
                style={{ top: 'var(--nav-h)', minHeight: 'var(--mp-bar-h)', paddingTop: 'calc(7px + var(--mp-sat))' }}>
                <button type="button" onClick={openAppMenu} aria-label={t('menu')} title={t('menu')}
                    className="relative grid place-items-center w-[30px] h-[30px] shrink-0 text-white cursor-pointer before:absolute before:-inset-[7px] before:content-[''] focus-ring [&_svg]:w-[18px] [&_svg]:h-[18px]">
                    <Menu aria-hidden="true" />
                </button>
                <span className="flex shrink-0 [&>*+*]:-ml-2">
                    <Thumb person={data.partner1} treeId={treeId} />
                    <Thumb person={data.partner2} treeId={treeId} />
                </span>
                <span className="flex-1 min-w-0 grid gap-px">
                    <span className="truncate serif font-semibold text-md leading-tight">{name}</span>
                    <span className="font-mono text-xs text-[color:var(--color-date)]">
                        {range || <span className="font-sans text-text-muted">{tp('no_dates_yet')}</span>}
                    </span>
                </span>
                {editor ? (
                    <button type="button" onClick={() => setPeopleFlow({ kind: 'menu' })} aria-label={t('edit_family')} title={t('edit_family')}
                        className="relative grid place-items-center w-[30px] h-[30px] shrink-0 text-white cursor-pointer before:absolute before:-inset-[7px] before:content-[''] focus-ring [&_svg]:w-[18px] [&_svg]:h-[18px]">
                        <Pencil aria-hidden="true" />
                    </button>
                ) : <span className="w-[30px] shrink-0" />}
            </div>

            <div ref={anchorRef} />
            <div ref={tabsRef} role="tablist" aria-label={tp('tabs_label')}
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
                    <Pane tab={tab} c={ctx} />
                </div>
                {peekTab && (
                    <div ref={ghostRef} aria-hidden="true" inert style={PANEL_STYLE}
                        className={cx('absolute top-0 w-full bg-[color:var(--surface)] pointer-events-none', peek === 1 ? 'left-full' : 'right-full')}>
                        <Pane tab={peekTab} c={ctx} />
                    </div>
                )}
            </div>
            <p className="sr-only" aria-live="polite">{announce}</p>

            <FamilyEventSheet
                flow={eventFlow}
                onClose={() => setEventFlow(null)}
                data={data}
                treeId={treeId}
                language={props.language}
                canDelete={role === 'editor'}
                facts={props.facts}
                sourceNumbers={props.sourceNumbers}
                run={run}
                citeSheets={props.citeSheets}
                onSaved={flashRow}
                relevantPersonIds={relevantPersonIds}
            />
            <PeopleSheets
                flow={peopleFlow}
                onClose={() => setPeopleFlow(null)}
                data={data}
                others={props.others}
                treeId={treeId}
                role={role}
                run={run}
                onStart={() => setEventFlow({ kind: 'start' })}
                onEnd={() => setEventFlow({ kind: 'end' })}
                onDelete={deleteFamily}
                onSaved={flashRow}
            />
            <FamilyNoteSheet open={noteFlow != null} note={(noteFlow ?? lastNote).note} onClose={() => setNoteFlow(null)} familyId={familyId}
                treeId={treeId} canDelete={role === 'editor'} run={run} />
            {uploadOpen && (
                <AddMediaModal target={{ kind: 'owner', ownerTable: 'Families', ownerId: familyId }} treeId={treeId} targetName={name}
                    relevantPersonIds={relevantPersonIds}
                    onClose={() => setUploadOpen(false)} onMediaChanged={() => { void loadMedia(); }} onAdded={() => setUploadOpen(false)} />
            )}
        </div>
    );
}

function Pane({ tab, c }: { tab: Tab; c: FamilyPaneContext }) {
    switch (tab) {
        case 'overview': return <OverviewPane c={c} />;
        case 'timeline': return <TimelinePane c={c} />;
        case 'media': return <MediaPane c={c} />;
        case 'sources': return <SourcesPane c={c} />;
    }
}
