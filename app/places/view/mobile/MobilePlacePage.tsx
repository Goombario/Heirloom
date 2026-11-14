'use client';

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import LocationMap, { type MapMarker } from '@/app/components/LocationMap';
import PersonAvatar from '@/app/components/PersonAvatar';
import GuardedLink from '@/app/components/GuardedLink';
import { MobileNoteSheet } from '@/app/components/notes/MobileNoteSheet';
import { GlassButton, MobileRow, cx } from '@/app/components/ui';
import { Skeleton } from '@/app/components/SkeletonLoader';
import { useElementWidth } from '@/app/hooks/useElementWidth';
import { useChange } from '@/app/people/view/mobile/useChange';
import { useHeroHeader } from '@/app/people/view/mobile/useHeroHeader';
import { Head, Quiet, Section } from '@/app/people/view/mobile/panes';
import { getDataClient } from '@/lib/data';
import { loadOwnerNotes } from '@/app/components/notes/ownerNotesCache';
import type { Note, PlaceDetail } from '@/lib/data/types';
import { Globe, List, MapPin, Menu, Move, Pencil, Plus } from '@/lib/icons';
import { OtherNamesSubtitle, useOtherNameMeta } from '../OtherNames';
import { OtherNameSheet } from './OtherNameSheet';
import { recordedAs } from '../recordedAs';
import { sortOtherNames } from '@/lib/places/other-names';
import { openAppMenu } from '@/app/components/nav/appEvents';
import { eventTypeLabel } from '@/lib/places/eventTypes';
import { initialsFromName } from '@/lib/utils/initials';
import { groupFactLinks } from '../../explore/groupFactLinks';
import { usePlaceFactReason } from '../../usePlaceFactReason';
import { decadeTicks, recordGroups, yearOf, yearSpan, yearStats } from './placeStats';
import { PlaceSheets, type PlaceSheet } from './PlaceSheets';
import { placeHref } from '@/lib/places/place-key';

/*
 * The place page on phones (#1118, option A2): a 4:3 map hero with Back and the
 * pencil, the name and its "Part of" links, and a slim bar once the map scrolls away.
 * Under it a two-cell strip (Records, Years) whose cells open panels like Born and
 * Died on the person page, then People, Places within and Details tabs. The pencil
 * opens a small sheet of edits; the floating Edit button and the inline form are
 * desktop only now.
 */

const TABS = ['people', 'within', 'details'] as const;
type Tab = (typeof TABS)[number];

/** People listed before the "Show all" row; a country can roll up thousands. */
const PEOPLE_PAGE = 50;
const AVATAR = 36;

const PANEL_STYLE: React.CSSProperties = {
    minHeight: 'calc(100dvh - var(--nav-h) - var(--mp-bar-h) - 44px)',
    paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
};

export type PlaceRole = 'viewer' | 'contributor' | 'editor';

const short = (name: string) => name.split(',')[0]?.trim() || name;

export function MobilePlacePage({ detail, placeName, treeId, role, onChanged, startRename, onRenameStarted }: {
    detail: PlaceDetail;
    placeName: string;
    treeId: number | null;
    role: PlaceRole;
    /** Reload the place after a write (and after its Undo). */
    onChanged: () => Promise<void> | void;
    /** Open Rename or merge with this typed (#1185: "Merge X into Y" from another place). */
    startRename?: { to: string; keepOld: boolean } | null;
    onRenameStarted?: () => void;
}) {
    const t = useTranslations('mobilePlaces');
    const tp = useTranslations('places');
    const tn = useTranslations('notes');
    const tnav = useTranslations('nav');
    const ids = useId();
    useHeroHeader();
    const editor = role !== 'viewer';
    const [tab, setTab] = useState<Tab>('people');
    const [panel, setPanel] = useState<'records' | 'years' | null>(null);
    const [sheet, setSheet] = useState<PlaceSheet | null>(null);
    // One other name's sheet (#1185): `id` null adds one.
    const [nameSheet, setNameSheet] = useState<{ id: number | null } | null>(null);
    const meta = useOtherNameMeta();
    const [renameStart, setRenameStart] = useState<{ to: string; keepOld: boolean } | null>(null);
    useEffect(() => {
        if (!startRename) return;
        // Handed over once from the URL; the sheet keeps it from here.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRenameStart(startRename);
        setSheet('rename');
        onRenameStarted?.();
    }, [startRename, onRenameStarted]);
    const [showAll, setShowAll] = useState(false);
    const [heroRef, heroWidth] = useElementWidth<HTMLElement>();
    const heroEl = useRef<HTMLElement | null>(null);
    const barRef = useRef<HTMLDivElement>(null);
    const tabsRef = useRef<HTMLDivElement>(null);
    const anchorRef = useRef<HTMLDivElement>(null);
    const [barShown, setBarShown] = useState(false);
    const reason = usePlaceFactReason();

    // Notes belong to the gazetteer row, so a place without one has none.
    const [loadedNotes, setNotes] = useState<{ placeId: number; notes: Note[] } | null>(null);
    const [noteFlow, setNoteFlow] = useState<{ note: Note | null } | null>(null);
    const [lastNote, setLastNote] = useState<{ note: Note | null }>({ note: null });
    if (noteFlow && noteFlow !== lastNote) setLastNote(noteFlow);
    const placeId = detail.id ?? null;
    const notes = loadedNotes != null && loadedNotes.placeId === placeId ? loadedNotes.notes : [];
    const loadNotes = useCallback(async () => {
        if (placeId == null) return;
        try {
            // Shared with the desktop layout's load: both are mounted (#66).
            setNotes({ placeId, notes: await loadOwnerNotes('Places', placeId, treeId) });
        } catch { /* the notes section just stays empty */ }
    }, [placeId, treeId]);
    // The list arrives after an await; the rule can't see past the call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { void loadNotes(); }, [loadNotes]);
    const reload = useCallback(async () => { await Promise.all([onChanged(), loadNotes()]); }, [onChanged, loadNotes]);
    const run = useChange({ treeId, canUndo: role === 'editor', onChanged: reload });

    // A new place opens on People with its panels shut.
    const [shownName, setShownName] = useState(placeName);
    if (shownName !== placeName) { setShownName(placeName); setTab('people'); setPanel(null); setShowAll(false); }

    useEffect(() => {
        const update = () => {
            const hero = heroEl.current, bar = barRef.current;
            if (!hero || !bar) return;
            setBarShown(hero.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom);
        };
        update();
        window.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
    }, []);

    const children = detail.children ?? [];
    const tabs = TABS.filter((k) => k !== 'within' || children.length > 0);
    const shownTab: Tab = tabs.includes(tab) ? tab : 'people';
    // With the map scrolled away, a tab opens at its top and the tabs stay stuck.
    const pendingScroll = useRef<number | null>(null);
    const switchTab = (next: Tab) => {
        const anchor = anchorRef.current, bar = tabsRef.current;
        if (anchor && bar) {
            const stuckAt = anchor.getBoundingClientRect().top + window.scrollY - (parseFloat(getComputedStyle(bar).top) || 0);
            if (window.scrollY > stuckAt) pendingScroll.current = stuckAt;
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
        const next = tabs[(i + step + tabs.length) % tabs.length];
        switchTab(next);
        tabsRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
    };

    const groups = useMemo(() => groupFactLinks(detail.factLinks), [detail.factLinks]);
    const records = useMemo(() => recordGroups(detail.factLinks), [detail.factLinks]);
    const years = useMemo(() => yearStats(detail.factLinks), [detail.factLinks]);
    const span = yearSpan(years.first?.year ?? null, years.last?.year ?? null);

    const own = detail.latitude != null && detail.longitude != null;
    const borrowed = !own && !(detail.descendantPins?.length) ? detail.inheritedFrom ?? null : null;
    const markers: MapMarker[] = own
        ? [{ lat: detail.latitude!, lng: detail.longitude!, label: short(placeName) }]
        : detail.descendantPins?.length
            ? detail.descendantPins.map((p) => ({ lat: p.lat, lng: p.lng, label: short(p.name) }))
            : borrowed ? [{ lat: borrowed.lat, lng: borrowed.lng, label: short(borrowed.name) }] : [];
    const name = short(placeName);
    const parents = detail.parents ?? [];
    const findRow = editor && !own && (
        <MobileRow icon={<Globe />} end="chevron" onClick={() => setSheet('match')}
            label={t('find_on_map', { place: name })}
            sub={borrowed ? t('find_sub_borrowed', { place: short(borrowed.name) }) : t('find_sub_own')} />
    );

    return (
        <div className="mp-root md:hidden overflow-x-clip">
            <header ref={(el) => { heroEl.current = el; heroRef(el); }} className="hero-dark !rounded-none !p-0 !shadow-none relative aspect-[4/3] overflow-hidden">
                {markers.length > 0 ? (
                    <div className="absolute inset-0" style={{ background: 'var(--map-well-bg)' }}>
                        {heroWidth > 0 && <LocationMap key={placeName} markers={markers} variant="mini" height={Math.round(heroWidth * 0.75)} />}
                    </div>
                ) : (
                    <div className="absolute inset-0 grid place-items-center mpl-hatch" >
                        <span className="grid justify-items-center gap-1.5 -mt-[60px] text-sm text-white/60">
                            <MapPin className="w-[26px] h-[26px]" aria-hidden="true" />{t('not_on_map')}
                        </span>
                    </div>
                )}
                <div aria-hidden="true" className="absolute inset-0 mp-scrim pointer-events-none" />
                {borrowed && (
                    <span className="absolute left-1/2 -translate-x-1/2 z-[2] whitespace-nowrap rounded-full bg-black/50 px-[11px] py-[5px] text-meta text-white"
                        style={{ top: 'calc(54px + var(--mp-sat))' }}>
                        {t('borrowed_tag', { place: short(borrowed.name) })}
                    </span>
                )}
                <div className="absolute inset-x-0 flex justify-between px-3 z-[2]" style={{ top: 'calc(10px + var(--mp-sat))' }}>
                    <GlassButton label={tnav('toggle_menu')} icon={<Menu />} onClick={openAppMenu} />
                    {editor && <GlassButton label={tp('edit_place')} icon={<Pencil />} onClick={() => setSheet('edit')} />}
                </div>
                <div className="absolute inset-x-4 bottom-3.5 z-[2] grid gap-1">
                    <h1 className="m-0 serif font-semibold text-white mp-hero-name text-balance">{name}</h1>
                    <OtherNamesSubtitle names={detail.otherNames} className="text-md text-white/80" />
                    <p className="m-0 text-sm text-white/80">
                        {parents.length === 0 ? t('top_level_place') : (
                            <>
                                {tp('part_of')}{' '}
                                {parents.slice().reverse().map((p, i) => (
                                    <React.Fragment key={p.id}>
                                        {i > 0 && ', '}
                                        <GuardedLink href={placeHref(p)}
                                            className="relative text-white underline decoration-white/40 underline-offset-[3px] before:absolute before:-inset-y-3 before:-inset-x-1 before:content-[''] focus-ring">
                                            {short(p.name)}
                                        </GuardedLink>
                                    </React.Fragment>
                                ))}
                            </>
                        )}
                    </p>
                </div>
            </header>

            <div ref={barRef} aria-hidden={!barShown} inert={!barShown}
                className={cx('hero-dark mp-slim-bar !rounded-none !shadow-none fixed inset-x-0 z-30 flex items-center gap-2.5 !px-3 !pb-[7px] transition-[opacity,transform,visibility] duration-[180ms] motion-reduce:transition-none',
                    barShown ? 'opacity-100 translate-y-0' : 'invisible opacity-0 -translate-y-2 pointer-events-none')}
                style={{ top: 'var(--nav-h)', minHeight: 'var(--mp-bar-h)', paddingTop: 'calc(7px + var(--mp-sat))' }}>
                <BarIcon label={tnav('toggle_menu')} onClick={openAppMenu}><Menu aria-hidden="true" /></BarIcon>
                <span className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden whitespace-nowrap">
                    <span className="serif font-semibold text-md truncate">{name}</span>
                    <span className="font-mono text-xs text-[color:var(--color-date)]">{t('people_count', { count: groups.length })}</span>
                </span>
                {editor ? <BarIcon label={tp('edit_place')} onClick={() => setSheet('edit')}><Pencil aria-hidden="true" /></BarIcon> : <span className="w-[30px] shrink-0" />}
            </div>

            <div className="border-b border-border bg-card">
                <div className="grid grid-cols-2">
                    {(['records', 'years'] as const).map((key, i) => {
                        const on = panel === key;
                        return (
                            <button key={key} type="button" aria-expanded={on} aria-controls={`${ids}-${key}`}
                                onClick={() => setPanel(on ? null : key)}
                                className={cx('grid justify-items-center gap-0.5 min-w-0 pt-[11px] pb-2.5 px-1.5 cursor-pointer focus-ring-inset transition-colors',
                                    i > 0 && 'border-l border-border', on ? 'bg-surface-2' : 'active:bg-surface-2')}>
                                {key === 'records'
                                    ? <span className="font-mono text-md text-text">{detail.factLinks.length}</span>
                                    : <span className={cx('font-mono text-sm', span ? 'text-[color:var(--color-date)]' : 'text-text-muted')}>{span || '—'}</span>}
                                <span className="eyebrow inline-flex items-center gap-1.5">
                                    {t(key)}
                                    <span aria-hidden="true" className={cx('inline-block w-1.5 h-1.5 border-r-[1.5px] border-b-[1.5px] border-text-muted transition-transform motion-reduce:transition-none', on ? 'rotate-[-135deg] translate-y-[2px]' : 'rotate-45 -translate-y-[1px]')} />
                                </span>
                            </button>
                        );
                    })}
                </div>
                {panel && (
                    <div id={`${ids}-${panel}`} className="bg-surface-2 border-t border-border pt-1 pb-1.5">
                        {panel === 'records' ? <RecordsPanel records={records} /> : <YearsPanel stats={years} reason={reason} />}
                    </div>
                )}
            </div>
            {findRow && <div className="border-b border-border">{findRow}</div>}

            <div ref={anchorRef} />
            <div ref={tabsRef} role="tablist" aria-label={t('tabs_label')}
                className="sticky z-20 flex gap-5 px-4 overflow-x-auto hscroll-strip bg-[color:var(--surface)] border-b border-border"
                style={{ top: 'calc(var(--nav-h) + var(--mp-bar-h))' }}>
                {tabs.map((key, i) => {
                    const selected = key === shownTab;
                    const n = key === 'people' ? groups.length : key === 'within' ? children.length : notes.length;
                    return (
                        <button key={key} type="button" role="tab" data-tab={key} id={`${ids}-tab-${key}`} aria-selected={selected}
                            aria-controls={`${ids}-panel`} tabIndex={selected ? 0 : -1} onClick={() => switchTab(key)} onKeyDown={(e) => onTabKey(e, i)}
                            className={cx('shrink-0 min-h-11 min-w-11 pt-[13px] pb-[11px] text-sm whitespace-nowrap border-b-2 cursor-pointer focus-ring-inset',
                                selected ? 'text-text font-semibold border-text' : 'text-text-muted border-transparent')}>
                            {t(`tab_${key}`)}
                            {n > 0 && key !== 'details' && <span className="font-mono font-normal text-xs text-text-muted ml-1">{n}</span>}
                        </button>
                    );
                })}
            </div>

            <div id={`${ids}-panel`} role="tabpanel" aria-labelledby={`${ids}-tab-${shownTab}`} style={PANEL_STYLE}>
                {shownTab === 'people' && (
                    groups.length === 0 ? <Quiet>{t('no_people')}</Quiet> : (
                        <div>
                            {(showAll ? groups : groups.slice(0, PEOPLE_PAGE)).map((g, i) => {
                                const facts = g.facts.slice(0, 2);
                                return (
                                    <MobileRow key={g.personId} href={`/people/view?id=${g.personId}`} end="leave" divided={i > 0}
                                        lead={<PersonAvatar mediaId={g.primaryMediaId} treeId={treeId} sex={g.sex === 'M' || g.sex === 'F' ? g.sex : null}
                                            name={g.name} initials={initialsFromName(g.name)} focalX={g.focalX} focalY={g.focalY} focalRadius={g.focalRadius} size={AVATAR} />}
                                        label={<span className="serif font-semibold text-md">{g.name || tp('person_fallback', { id: g.personId })}</span>}
                                        sub={(
                                            <span className="block truncate">
                                                {facts.map((f, j) => {
                                                    const y = yearOf(f.date);
                                                    return (
                                                        <React.Fragment key={j}>
                                                            {j > 0 && ' · '}
                                                            {reason(f, { withDate: false })}
                                                            {y != null && <> <span className="date-mono">{y}</span></>}
                                                            {recordedAs(f, detail) != null
                                                                ? <> · {tp.rich('recorded_as', { name: f.placeName, i: (c) => <i className="serif">{c}</i> })}</>
                                                                : f.placeName !== placeName && ` · ${short(f.placeName)}`}
                                                        </React.Fragment>
                                                    );
                                                })}
                                                {g.facts.length > 2 && ` · ${t('more_facts', { count: g.facts.length - 2 })}`}
                                            </span>
                                        )}
                                    />
                                );
                            })}
                            {!showAll && groups.length > PEOPLE_PAGE && (
                                <MobileRow icon={<List />} end="chevron" divided label={tp('show_all_people', { count: groups.length })} onClick={() => setShowAll(true)} />
                            )}
                        </div>
                    )
                )}
                {shownTab === 'within' && (
                    <div>
                        {children.map((c, i) => (
                            <MobileRow key={c.id} href={placeHref(c)} end="leave" divided={i > 0}
                                lead={<MapPin className="w-4 h-4 shrink-0 text-text-muted" aria-hidden="true" />}
                                label={<span className="serif font-semibold text-md">{short(c.name)}</span>} />
                        ))}
                    </div>
                )}
                {shownTab === 'details' && (
                    <>
                        <Section first>
                            <Head title={t('place')} />
                            <QuietRow label={tp('place_name')}>{placeName}</QuietRow>
                            {detail.displayName && <QuietRow label={t('on_map_as')}>{detail.displayName}</QuietRow>}
                            {own ? (
                                <>
                                    <QuietRow label={t('latitude')} mono>{detail.latitude!.toFixed(4)}</QuietRow>
                                    <QuietRow label={t('longitude')} mono>{detail.longitude!.toFixed(4)}</QuietRow>
                                </>
                            ) : (
                                <QuietRow label={t('pin')}>
                                    {detail.inheritedFrom ? t('pin_uses', { place: short(detail.inheritedFrom.name) }) : t('not_on_map')}
                                </QuietRow>
                            )}
                            {editor && (own ? (
                                <>
                                    <MobileRow icon={<Move />} end="chevron" divided label={t('move_pin')} onClick={() => setSheet('move')} />
                                    <MobileRow icon={<Globe />} end="chevron" divided label={t('match_again')} onClick={() => setSheet('match')} />
                                </>
                            ) : (
                                <MobileRow icon={<Globe />} end="chevron" divided onClick={() => setSheet('match')}
                                    label={t('find_on_map', { place: name })}
                                    sub={detail.inheritedFrom ? t('find_sub_borrowed', { place: short(detail.inheritedFrom.name) }) : t('find_sub_own')} />
                            ))}
                        </Section>
                        {placeId != null && ((detail.otherNames?.length ?? 0) > 0 || editor) && (
                            <Section>
                                <Head title={tp('other_names')} count={detail.otherNames?.length ?? 0} />
                                {!detail.otherNames?.length && <p className="m-0 px-4 py-2 text-base text-text-muted">{t('names_empty', { place: name })}</p>}
                                {sortOtherNames(detail.otherNames ?? []).map((n, i) => {
                                    const sub = [meta(n), n.records > 0 ? t('name_records', { count: n.records }) : ''].filter(Boolean).join(' · ') || t('name_no_records');
                                    return (
                                        <MobileRow key={n.id} divided={i > 0} end={editor ? 'chevron' : 'none'} onClick={editor ? () => setNameSheet({ id: n.id }) : undefined}
                                            label={<span className="serif font-semibold text-md">{n.name}</span>} sub={sub} />
                                    );
                                })}
                                {editor && <MobileRow icon={<Plus />} end="chevron" divided={(detail.otherNames?.length ?? 0) > 0} label={tp('add_another_name')} onClick={() => setNameSheet({ id: null })} />}
                            </Section>
                        )}
                        {placeId != null && (notes.length > 0 || editor) && (
                            <Section>
                                <Head title={tn('section_title')} count={notes.length} />
                                {notes.map((n, i) => (
                                    editor ? (
                                        <button key={n.Id} type="button" onClick={() => setNoteFlow({ note: n })}
                                            className={cx('block w-full px-4 py-3 text-left text-base leading-normal text-text-secondary whitespace-pre-line cursor-pointer active:bg-surface-2 focus-ring-inset', i > 0 && 'border-t border-border')}>
                                            {n.Text}
                                        </button>
                                    ) : (
                                        <p key={n.Id} className={cx('m-0 px-4 py-3 text-base leading-normal text-text-secondary whitespace-pre-line', i > 0 && 'border-t border-border')}>{n.Text}</p>
                                    )
                                ))}
                                {editor && <MobileRow icon={<Plus />} end="chevron" divided={notes.length > 0} label={tn('add_button')} onClick={() => setNoteFlow({ note: null })} />}
                            </Section>
                        )}
                    </>
                )}
            </div>

            <PlaceSheets
                sheet={sheet}
                onSheet={setSheet}
                detail={detail}
                placeName={placeName}
                treeId={treeId}
                canUndo={role === 'editor'}
                onChanged={reload}
                renameStart={renameStart}
                onAddName={detail.id != null ? () => { setSheet(null); setNameSheet({ id: null }); } : undefined}
            />
            {nameSheet && (
                <OtherNameSheet key={nameSheet.id ?? 'new'} detail={detail} placeName={placeName} nameId={nameSheet.id} treeId={treeId} run={run}
                    onClose={() => setNameSheet(null)} />
            )}
            {placeId != null && (
                <MobileNoteSheet open={noteFlow != null} note={(noteFlow ?? lastNote).note} onClose={() => setNoteFlow(null)}
                    ownerTable="Places" ownerId={placeId} treeId={treeId} canDelete={role === 'editor'} run={run} />
            )}
        </div>
    );
}

function BarIcon({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
    return (
        <button type="button" onClick={onClick} aria-label={label} title={label}
            className="relative grid place-items-center w-[30px] h-[30px] shrink-0 text-white cursor-pointer before:absolute before:-inset-[7px] before:content-[''] focus-ring [&_svg]:w-[18px] [&_svg]:h-[18px]">
            {children}
        </button>
    );
}

/** A quiet detail row: the label left, the value right, no end icon. */
function QuietRow({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
    return (
        <div className="flex justify-between gap-3.5 px-4 py-3 border-t border-border first-of-type:border-t-0 text-base">
            <span className="shrink-0 text-text-muted">{label}</span>
            <span className={cx('min-w-0 text-right [overflow-wrap:anywhere]', mono ? 'font-mono text-sm text-text-secondary' : 'text-text')}>{children}</span>
        </div>
    );
}

/** Each event type with who it covers, its years and its count. */
function RecordsPanel({ records }: { records: ReturnType<typeof recordGroups> }) {
    const t = useTranslations('mobilePlaces');
    const tp = useTranslations('places');
    if (records.length === 0) return <p className="m-0 px-4 py-3 text-base text-text-muted">{t('no_records_here')}</p>;
    return (
        <div>
            {records.map((r, i) => (
                <div key={r.type} className={cx('flex items-baseline gap-3 px-4 py-[11px] text-base', i > 0 && 'border-t border-border/70')}>
                    <span className="flex-1 min-w-0">
                        <span className="text-text">{eventTypeLabel(r.type, tp)}</span>
                        <span className="block mt-0.5 text-meta text-text-muted truncate">
                            {r.names.length > 3 ? t('names_more', { names: r.names.slice(0, 3).join(', '), count: r.names.length - 3 }) : r.names.join(', ')}
                        </span>
                    </span>
                    <span className="date-mono text-meta whitespace-nowrap">{yearSpan(r.first, r.last)}</span>
                    <span className="min-w-[22px] text-right font-mono text-sm text-text-secondary">{r.count}</span>
                </div>
            ))}
        </div>
    );
}

/** Records by decade, then the first record, the busiest decade, the last and the undated. */
function YearsPanel({ stats, reason }: { stats: ReturnType<typeof yearStats>; reason: ReturnType<typeof usePlaceFactReason> }) {
    const t = useTranslations('mobilePlaces');
    const { decades, busiest, first, last, undated } = stats;
    const undatedRow = undated > 0 && (
        <div className="flex justify-between gap-3.5 px-4 py-3 border-t border-border/70 text-base">
            <span className="text-text-muted">{t('undated')}</span>
            <span className="font-mono text-sm text-text-secondary">{undated}</span>
        </div>
    );
    if (decades.length === 0 || !busiest || !first || !last) {
        return <>{<p className="m-0 px-4 py-3 text-base text-text-muted">{t('no_dated')}</p>}{undatedRow}</>;
    }
    const W = 328, H = 88, base = 70, top = 14, bw = W / decades.length;
    const from = decades[0].decade, to = decades[decades.length - 1].decade;
    const row = (label: string, sub: string, year: string) => (
        <div className="flex items-baseline gap-3 px-4 py-[11px] border-t border-border/70 text-base">
            <span className="flex-1 min-w-0">
                <span className="text-text">{label}</span>
                <span className="block mt-0.5 text-meta text-text-muted truncate">{sub}</span>
            </span>
            <span className="date-mono text-meta whitespace-nowrap">{year}</span>
        </div>
    );
    return (
        <div>
            <div className="px-4 pt-3 pb-1.5">
                <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" role="img" aria-label={t('chart_label', { from, to })}>
                    <line x1="0" x2={W} y1={base} y2={base} className="stroke-border" />
                    {decades.map((d, i) => {
                        if (d.count === 0) return null;
                        const h = (d.count / busiest.count) * (base - top);
                        const x = i * bw;
                        const top1 = d.decade === busiest.decade;
                        return (
                            <g key={d.decade}>
                                <rect x={x + 1.5} y={base - h} width={Math.max(bw - 3, 2)} height={h} rx="2" className="fill-[color:var(--color-date)]" opacity={top1 ? 1 : 0.5} />
                                {top1 && <text x={x + bw / 2} y={base - h - 4} textAnchor="middle" className="fill-text font-mono text-xs font-medium">{d.count}</text>}
                            </g>
                        );
                    })}
                    {decadeTicks(from, to).map((d) => {
                        const x = ((d - from) / 10) * bw + bw / 2;
                        return (
                            <g key={d}>
                                <line x1={x} x2={x} y1={base} y2={base + 4} className="stroke-border" />
                                <text x={Math.min(Math.max(x, 16), W - 16)} y={base + 16} textAnchor="middle" className="fill-text-muted font-mono text-xs">{d}</text>
                            </g>
                        );
                    })}
                </svg>
            </div>
            {row(t('first_record'), `${first.link.name} · ${reason(first.link, { withDate: false })}`, String(first.year))}
            {row(t('busiest_decade'), t('records_count', { count: busiest.count }), t('decade', { decade: busiest.decade }))}
            {row(t('last_record'), `${last.link.name} · ${reason(last.link, { withDate: false })}`, String(last.year))}
            {undatedRow}
        </div>
    );
}

/** The phone's loading paint: the hero and strip shapes, never the desktop card. */
export function MobilePlaceSkeleton() {
    useHeroHeader();
    return (
        <div className="mp-root md:hidden">
            <div className="hero-dark !rounded-none !p-0 !shadow-none aspect-[4/3]" />
            <div className="grid grid-cols-2 border-b border-border bg-card">
                {[0, 1].map((i) => <div key={i} className={cx('grid justify-items-center gap-1.5 py-3', i > 0 && 'border-l border-border')}><Skeleton className="h-4 w-10" /><Skeleton className="h-3 w-14" /></div>)}
            </div>
            <div className="grid gap-3 p-4">
                <Skeleton className="h-4 w-[60%]" />
                <Skeleton className="h-4 w-[80%]" />
                <Skeleton className="h-4 w-[45%]" />
            </div>
        </div>
    );
}
