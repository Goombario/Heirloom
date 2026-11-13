'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ActionLink, AvatarStack, FilterChip, SectionHeader, SegmentedControl } from '@/app/components/ui';
import PersonAvatar from '@/app/components/PersonAvatar';
import { initialsFromName } from '@/lib/utils/initials';
import { useLanguage } from '@/app/components/LanguageProvider';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { familyEventLabel } from '@/app/components/familyEventTypes';
import { formatDateForDisplay, sortableYear } from '@/lib/date-utils';
import { placeHref } from '@/lib/places/place-key';
import type { PlaceFactLinkEntry, PlacePersonEntry } from '@/lib/data/types';
import {
    CHIP_GROUPS, DECADE_FIRST_ROWS, axisParts, axisScale, chipGroupOf, decadeBlocks, lanes, placeRecords,
    type ChipGroup, type PlaceRecord,
} from './placeRecords';

type View = 'decade' | 'lanes';
const FACES = 4;
/** Who was here when opens at this many people, then "Show all N people". */
const FIRST_LANES = 10;
const shortName = (name: string) => name.split(',')[0]?.trim() || name;
/** Records whose row reads "Birth of Karl" rather than "Residence · Karl". */
const OF_TYPES = new Set(['BIRT', 'BAPM', 'CHR', 'DEAT', 'BURI', 'MARR', 'EMIG', 'IMMI']);

/** "Birth", "Marriage", "Residence": one record's type, never its GEDCOM tag. */
function useTypeLabel() {
    const tTypes = useTranslations('eventTypes');
    const tEdit = useTranslations('eventEdit');
    const t = useTranslations('placeDesktop');
    return (type: string) => (type === 'MARR' ? t('type_marriage') : tTypes.has(type) ? tTypes(type) : familyEventLabel(type, tEdit));
}

function useDate() {
    const { language } = useLanguage();
    const words = useDateQualifierWords();
    return (date: string | null) => (date ? formatDateForDisplay(date, language, words) : '');
}

/** Where a record is edited: the person's row, or the family. */
function editHref(r: PlaceRecord): string {
    if (r.kind === 'marriage') return `/families/view?id=${r.recordId}`;
    const person = r.people[0]?.id;
    const anchor = r.kind === 'birth' ? '#birth' : r.kind === 'death' ? '#death' : `#event-${r.recordId}`;
    return `/people/view?id=${person}${anchor}`;
}

function EditLink({ record }: { record: PlaceRecord }) {
    const t = useTranslations('placeDesktop');
    const owner = record.kind === 'marriage' ? null : record.people[0];
    return (
        <ActionLink kind="leave" href={editHref(record)}>
            {owner ? t('edit_on_page', { name: owner.name || '?' }) : t('edit_on_family')}
        </ActionLink>
    );
}

/** The people a record names, as faces with their names, each a link to the person. */
function RecordPeople({ record, treeId }: { record: PlaceRecord; treeId: number | null }) {
    return (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {record.people.map((p) => (
                <Link key={p.id} href={`/people/view?id=${p.id}`} className="inline-flex items-center gap-2 serif text-base font-semibold text-text hover:underline rounded focus-ring">
                    <PersonAvatar mediaId={p.mediaId} treeId={treeId} sex={p.sex === 'M' || p.sex === 'F' ? p.sex : null} name={p.name} initials={initialsFromName(p.name)} size={26} />
                    {p.name || '?'}
                </Link>
            ))}
        </div>
    );
}

/** "Uppsala Cathedral, Uppsala" when the record is in a place within this one. */
function RecordPlace({ record, placeId, placeName }: { record: PlaceRecord; placeId: number | null; placeName: string }) {
    if (record.placeId === placeId) return <>{shortName(placeName)}</>;
    return (
        <>
            <Link href={placeHref({ id: record.placeId, name: record.placeName })} className="text-link hover:underline">{shortName(record.placeName)}</Link>
            {', '}{shortName(placeName)}
        </>
    );
}

/**
 * The read-only summary an opened record shows in place (#56): its date and place,
 * its people, and "Edit on X's page ↗" for those who can edit.
 */
function RecordSummary({ record, placeId, placeName, canEdit, treeId }: {
    record: PlaceRecord; placeId: number | null; placeName: string; canEdit: boolean; treeId: number | null;
}) {
    const t = useTranslations('placeDesktop');
    const date = useDate();
    return (
        <div className="place-evsum">
            <dl className="m-0 flex flex-wrap gap-x-8 gap-y-2">
                {record.date && (
                    <div className="grid gap-px">
                        <dt className="text-meta text-text-muted">{t('summary_date')}</dt>
                        <dd className="m-0 text-base date-mono">{date(record.date)}</dd>
                    </div>
                )}
                <div className="grid gap-px">
                    <dt className="text-meta text-text-muted">{t('summary_place')}</dt>
                    <dd className="m-0 text-base text-text"><RecordPlace record={record} placeId={placeId} placeName={placeName} /></dd>
                </div>
            </dl>
            <RecordPeople record={record} treeId={treeId} />
            <div className="place-evsum__foot">
                {canEdit ? <EditLink record={record} /> : <span />}
                <span className="text-meta text-text-muted">{t('read_only_here')}</span>
            </div>
        </div>
    );
}

/** "Birth of Karl Lindqvist" / "Residence · Johan and Kristina". */
function RecordTitle({ record }: { record: PlaceRecord }) {
    const t = useTranslations('placeDesktop');
    const typeLabel = useTypeLabel();
    const names = record.people.map((p) => p.name || '?');
    const who = names.length > 1 ? t('names_and', { first: names.slice(0, -1).join(', '), last: names[names.length - 1]! }) : (names[0] ?? '');
    const type = <b className="place-ce__type">{typeLabel(record.type)}</b>;
    return OF_TYPES.has(record.type)
        ? <>{t.rich('record_of', { type: () => type, who })}</>
        : <>{type} · {who}</>;
}

/** One row of the chronicle; it opens in place into the summary. */
function ChronicleRow({ record, open, onToggle, placeId, placeName, canEdit, treeId }: {
    record: PlaceRecord; open: boolean; onToggle: () => void; placeId: number | null; placeName: string; canEdit: boolean; treeId: number | null;
}) {
    const date = useDate();
    return (
        <li>
            <button type="button" aria-expanded={open} onClick={onToggle} className="place-ce focus-ring-inset">
                <span className="place-ce__date">{record.date ? date(record.date) : ''}</span>
                <span className="min-w-0 text-base text-text">
                    <span className="block truncate"><RecordTitle record={record} /></span>
                    <span className="block text-meta text-text-muted truncate mt-px">{shortName(record.placeId === placeId ? placeName : record.placeName)}</span>
                </span>
                <AvatarStack people={record.people.map((p) => ({ id: p.id, name: p.name, sex: p.sex, mediaId: p.mediaId }))} size={28} max={FACES} treeId={treeId} />
            </button>
            {open && <RecordSummary record={record} placeId={placeId} placeName={placeName} canEdit={canEdit} treeId={treeId} />}
        </li>
    );
}

/**
 * What happened here (#56), the place page's main section: every record at the
 * place, By decade (a chronicle with type chips; each decade opens at five records
 * and expands in place) or Who was here when (one lane per person). Opening a
 * record reports its place, so the cover map can ring that pin.
 */
export function WhatHappened({ links, people = [], placeId, placeName, treeId, canEdit, deletable, onSelectPlace }: {
    links: PlaceFactLinkEntry[];
    /** The place's people, for their life years on Who was here when. */
    people?: PlacePersonEntry[];
    placeId: number | null;
    placeName: string;
    treeId: number | null;
    canEdit: boolean;
    /** No records and nothing else uses it: say it can be deleted. */
    deletable: boolean;
    onSelectPlace: (placeId: number | null) => void;
}) {
    const t = useTranslations('placeDesktop');
    const tp = useTranslations('places');
    const [view, setView] = useState<View>('decade');
    const [chip, setChip] = useState<ChipGroup | 'all'>('all');
    const [open, setOpen] = useState<string | null>(null);
    /** Decades opened past their first five records (keyed by decade; -1 = undated). */
    const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
    const records = useMemo(() => placeRecords(links), [links]);

    const counts = useMemo(() => {
        const c = new Map<ChipGroup, number>();
        for (const r of records) {
            const g = chipGroupOf(r.type);
            if (g) c.set(g, (c.get(g) ?? 0) + 1);
        }
        return c;
    }, [records]);
    const filtered = chip === 'all' ? records : records.filter((r) => chipGroupOf(r.type) === chip);
    const undated = filtered.filter((r) => r.year == null);
    const blocks = decadeBlocks(filtered);
    const busiest = blocks.length > 1 ? blocks.reduce((a, b) => (b.records.length > a.records.length ? b : a)).decade : null;

    const toggle = (r: PlaceRecord) => {
        const next = open === r.key ? null : r.key;
        setOpen(next);
        onSelectPlace(next ? r.placeId : null);
    };
    const toggleDecade = (d: number) => setExpanded((s) => {
        const n = new Set(s);
        if (n.has(d)) n.delete(d); else n.add(d);
        return n;
    });
    const decade = (key: number, label: string, sub: string, list: PlaceRecord[]) => {
        const isOpen = expanded.has(key);
        const shown = isOpen ? list : list.slice(0, DECADE_FIRST_ROWS);
        return (
            <div key={key} className="place-dec">
                <h3 className="place-dec__head">{label}<small>{sub}</small></h3>
                <ol className="place-dec__list">
                    {shown.map((r) => (
                        <ChronicleRow key={r.key} record={r} open={open === r.key} onToggle={() => toggle(r)} placeId={placeId} placeName={placeName} canEdit={canEdit} treeId={treeId} />
                    ))}
                    {list.length > DECADE_FIRST_ROWS && (
                        <li className="py-2.5 pl-[18px]">
                            <ActionLink kind="expand" expanded={isOpen} onClick={() => toggleDecade(key)}>
                                {isOpen ? tp('show_fewer') : t('show_all_records', { count: list.length })}
                            </ActionLink>
                        </li>
                    )}
                </ol>
            </div>
        );
    };

    return (
        <section aria-labelledby="place-events-title">
            <SectionHeader
                level="label"
                headingId="place-events-title"
                title={t('what_happened')}
                count={records.length}
                action={(
                    <SegmentedControl
                        aria-label={t('view_label')}
                        value={view}
                        onChange={(v) => { setView(v as View); setOpen(null); onSelectPlace(null); }}
                        disabled={records.length === 0}
                        options={[{ v: 'decade', l: t('by_decade') }, { v: 'lanes', l: t('who_when') }]}
                    />
                )}
            />
            {records.length === 0 ? (
                <p className="m-0 text-sm text-text-muted">
                    {t('nothing_yet')}
                    {deletable && <> {t('nothing_yet_delete')}</>}
                </p>
            ) : view === 'decade' ? (
                <>
                    <div className="flex flex-wrap gap-2 mt-1.5 mb-1" role="group" aria-label={t('chips_label')}>
                        <FilterChip active={chip === 'all'} count={records.length} onClick={() => setChip('all')}>{t('chip_all')}</FilterChip>
                        {(Object.keys(CHIP_GROUPS) as ChipGroup[]).filter((g) => counts.has(g)).map((g) => (
                            <FilterChip key={g} active={chip === g} count={counts.get(g)} onClick={() => setChip(g)}>{t(`chip_${g}`)}</FilterChip>
                        ))}
                    </div>
                    <p className="m-0 mt-2 text-meta text-text-muted">{t('oldest_first', { count: filtered.length })}</p>
                    <div>
                        {blocks.map((b) => decade(
                            b.decade,
                            t('decade', { decade: b.decade }),
                            b.decade === busiest ? t('decade_count_busiest', { count: b.records.length }) : t('quiet_count', { count: b.records.length }),
                            b.records,
                        ))}
                        {undated.length > 0 && decade(-1, t('undated'), t('quiet_count', { count: undated.length }), undated)}
                        {filtered.length === 0 && <p className="m-0 mt-3 text-sm text-text-muted">{tp('no_records_here')}</p>}
                    </div>
                </>
            ) : (
                <Lanes records={records} people={people} placeId={placeId} placeName={placeName} canEdit={canEdit} treeId={treeId} onSelectPlace={onSelectPlace} />
            )}
        </section>
    );
}

/** A lane marker's look: born, married, died, emigrated, immigrated or any other record. */
function markKind(type: string): 'b' | 'm' | 'd' | 'e' | 'i' | 'o' {
    if (type === 'BIRT' || type === 'BAPM' || type === 'CHR') return 'b';
    if (type === 'MARR') return 'm';
    if (type === 'DEAT' || type === 'BURI') return 'd';
    if (type === 'EMIG') return 'e';
    if (type === 'IMMI') return 'i';
    return 'o';
}

function MarkDot({ kind }: { kind: ReturnType<typeof markKind> }) {
    return (
        <span className="place-mk__dot" aria-hidden="true">
            {(kind === 'e' || kind === 'i') && (
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d={kind === 'e' ? 'M7 17 17 7M9 7h8v8' : 'M17 7 7 17M7 9v8h8'} />
                </svg>
            )}
        </span>
    );
}

/** Who was here when: one lane per person on a shared axis, long quiet stretches folded. */
function Lanes({ records, people, placeId, placeName, canEdit, treeId, onSelectPlace }: {
    records: PlaceRecord[]; people: PlacePersonEntry[]; placeId: number | null; placeName: string; canEdit: boolean; treeId: number | null;
    onSelectPlace: (placeId: number | null) => void;
}) {
    const t = useTranslations('placeDesktop');
    const typeLabel = useTypeLabel();
    const date = useDate();
    const [unfold, setUnfold] = useState(false);
    const [all, setAll] = useState(false);
    const [pop, setPop] = useState<{ record: PlaceRecord; mark: string; x: number; y: number; above: boolean } | null>(null);
    const popRef = useRef<HTMLDivElement>(null);
    const markRef = useRef<HTMLElement | null>(null);
    const rows = useMemo(() => lanes(records), [records]);
    const shownRows = all ? rows : rows.slice(0, FIRST_LANES);
    const years = records.flatMap((r) => (r.year != null ? [r.year] : []));
    const parts = axisParts(years, unfold);
    const x = axisScale(parts);
    const first = years.length ? Math.min(...years) : null;
    const last = years.length ? Math.max(...years) : null;
    const life = useMemo(() => {
        const m = new Map<number, string>();
        for (const p of people) {
            const b = sortableYear(p.BirthDate);
            const d = sortableYear(p.DeathDate);
            if (b != null || d != null) m.set(p.Id, `${b ?? '?'} – ${d ?? ''}`.trim());
        }
        return m;
    }, [people]);

    // Each to-scale stretch is labelled at its ends and every 20 years between, where there's room.
    const ticks = parts.flatMap((p) => {
        if (p.folded) return [];
        if (p.from === p.to) return [p.from];
        const inner: number[] = [];
        for (let y = Math.ceil((p.from + 8) / 20) * 20; y <= p.to - 8; y += 20) inner.push(y);
        return [p.from, ...inner, p.to];
    }).filter((y, i, all) => i === 0 || x(y) - x(all[i - 1]!) > 0.045 || i === all.length - 1);
    const grid = parts.flatMap((p) => {
        if (p.folded) return [];
        const out: number[] = [];
        for (let y = Math.ceil(p.from / 10) * 10; y <= p.to; y += 10) out.push(y);
        return out;
    });
    const folds = parts.filter((p) => p.folded);

    // Records by decade, the histogram over the axis; a folded stretch is one hatched bar.
    const hist = new Map<number, number>();
    for (const y of years) hist.set(Math.floor(y / 10) * 10, (hist.get(Math.floor(y / 10) * 10) ?? 0) + 1);
    const histMax = Math.max(1, ...hist.values());
    const busiest = [...hist.entries()].reduce<[number, number] | null>((a, e) => (!a || e[1] > a[1] ? e : a), null);

    useEffect(() => {
        if (!pop) return;
        popRef.current?.focus();
        const close = () => { setPop(null); onSelectPlace(null); };
        const onDown = (e: PointerEvent) => {
            if (!popRef.current?.contains(e.target as Node) && !markRef.current?.contains(e.target as Node)) close();
        };
        // Escape hands focus back to the marker that opened it.
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); markRef.current?.focus(); } };
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('keydown', onKey);
        window.addEventListener('scroll', close, true);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('scroll', close, true);
        };
    }, [pop, onSelectPlace]);

    const openMark = (r: PlaceRecord, id: string, el: HTMLElement) => {
        if (pop?.mark === id) { setPop(null); onSelectPlace(null); return; }
        markRef.current = el;
        const rect = el.getBoundingClientRect();
        // Flips above the marker when there's no room below.
        const above = window.innerHeight - rect.bottom < 260;
        setPop({ record: r, mark: id, x: Math.min(rect.left - 24, window.innerWidth - 310), y: above ? rect.top - 8 : rect.bottom + 8, above });
        onSelectPlace(r.placeId);
    };

    const legend: [ReturnType<typeof markKind>, string][] = [['b', t('lleg_born')], ['m', t('lleg_married')], ['d', t('lleg_died')], ['e', t('lleg_emigrated')], ['i', t('lleg_immigrated')]];
    return (
        <div>
            <div className="flex justify-between items-baseline gap-3 flex-wrap mt-1.5 mb-3.5">
                <span className="text-meta text-text-muted">
                    {first != null && last != null ? t('lanes_caption', { from: first, to: last }) : t('lanes_caption_undated')}
                </span>
                <div className="place-lleg">
                    <span><i className="place-lleg__sw" aria-hidden="true" />{t('lleg_records')}</span>
                    {legend.map(([k, l]) => <span key={k}><span className={`place-mk place-mk--${k}`}><MarkDot kind={k} /></span>{l}</span>)}
                </div>
            </div>
            <div className="place-lanes">
                <div className="grid content-end pb-1.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">{t('records_by_decade')}</span>
                    {busiest && <span className="text-meta text-text-muted">{t('busiest', { decade: busiest[0], count: busiest[1] })}</span>}
                </div>
                <div className="place-lanes__hist" role="img" aria-label={busiest ? t('busiest', { decade: busiest[0], count: busiest[1] }) : t('records_by_decade')}>
                    {[...hist.entries()].filter(([d]) => !folds.some((f) => d + 9 > f.from && d < f.to)).map(([d, n]) => {
                        const l = x(d) * 100;
                        const r = x(d + 10) * 100;
                        return <i key={d} className={busiest?.[0] === d ? 'is-top' : undefined} style={{ left: `${l + 0.15}%`, width: `${Math.max(0.6, r - l - 0.3)}%`, height: `${Math.max(4, (n / histMax) * 100)}%` }} />;
                    })}
                    {folds.map((f) => {
                        const n = years.filter((y) => y > f.from && y < f.to).length;
                        const l = x(f.from + 1) * 100 - 1;
                        return <i key={f.from} className="is-fold" style={{ left: `${l}%`, width: '2%', height: `${Math.max(6, (n / histMax) * 100)}%` }} />;
                    })}
                </div>
                <span />
                <div className="place-lanes__axis" aria-hidden="true">
                    {ticks.map((y, i) => <span key={`${y}-${i}`} style={{ left: `${x(y) * 100}%` }}>{y}</span>)}
                </div>
                <div>
                    {shownRows.map((lane) => (
                        <Link key={lane.personId} href={`/people/view?id=${lane.personId}`} className="place-lanes__name focus-ring-inset">
                            <PersonAvatar mediaId={lane.marks[0]?.people.find((p) => p.id === lane.personId)?.mediaId ?? null} treeId={treeId} sex={null} name={lane.name} initials={initialsFromName(lane.name)} size={30} />
                            <span className="grid min-w-0">
                                <span className="place-lanes__nm">{lane.name || '?'}</span>
                                {life.get(lane.personId) && <span className="place-lanes__yrs">{life.get(lane.personId)}</span>}
                            </span>
                        </Link>
                    ))}
                </div>
                <div>
                    {shownRows.map((lane) => (
                        <div key={lane.personId} className="place-lane" role="group" aria-label={lane.name || '?'}>
                            {grid.map((y) => <span key={y} className="place-lane__grid" style={{ left: `${x(y) * 100}%` }} />)}
                            {folds.map((f) => <span key={f.from} className="place-lane__fold" style={{ left: `${x(f.from + 1) * 100 - 1}%`, width: '2%' }} />)}
                            {lane.undated ? (
                                <span className="place-lane__undated" style={{ left: '2%' }}>{t('lane_undated', { count: lane.marks.length })}</span>
                            ) : lane.spans.map((s) => (
                                <span key={s.from} aria-hidden="true" className="place-lane__span"
                                    style={{ left: `${x(s.from) * 100}%`, width: `${Math.max(0.8, (x(s.to) - x(s.from)) * 100)}%` }} />
                            ))}
                            {lane.marks.filter((m) => m.year != null).map((m, _i, marks) => {
                                const k = markKind(m.type);
                                // A year label is left off where it would run into the one before it.
                                const labelled = marks.filter((o) => markKind(o.type) !== 'o');
                                const at = labelled.indexOf(m);
                                const showYear = k !== 'o' && (at <= 0 || x(m.year!) - x(labelled[at - 1]!.year!) > 0.035);
                                const id = `${lane.personId}:${m.key}`;
                                const label = `${typeLabel(m.type)} ${date(m.date)}`;
                                return (
                                    <button
                                        key={m.key}
                                        type="button"
                                        onClick={(e) => openMark(m, id, e.currentTarget)}
                                        aria-label={`${lane.name || '?'}: ${label}`}
                                        aria-expanded={pop?.mark === id}
                                        title={label}
                                        className={`place-mk place-mk--${k} focus-ring`}
                                        style={{ left: `${x(m.year!) * 100}%` }}
                                    >
                                        <MarkDot kind={k} />
                                        {showYear && <span className="place-mk__lb" aria-hidden="true">{m.year}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3">
                {rows.length > FIRST_LANES && (
                    <ActionLink kind="expand" expanded={all} onClick={() => setAll((a) => !a)}>
                        {all ? t('show_fewer_people') : t('show_all_people', { count: rows.length })}
                    </ActionLink>
                )}
                {rows.length > FIRST_LANES && !all && <span className="text-meta text-text-muted">{t('more_people', { count: rows.length - FIRST_LANES })}</span>}
                {(folds.length > 0 || unfold) && (
                    <ActionLink kind="expand" expanded={unfold} onClick={() => { setUnfold((u) => !u); setPop(null); }}>
                        {unfold ? t('fold_quiet') : t('full_scale')}
                    </ActionLink>
                )}
            </div>
            {pop && createPortal(
                <div
                    ref={popRef}
                    role="dialog"
                    tabIndex={-1}
                    aria-label={typeLabel(pop.record.type)}
                    className="fixed z-50 w-[300px] grid gap-1.5 rounded-[10px] border border-border bg-card px-3.5 py-3 shadow-[var(--shadow-lg)] text-text focus:outline-none"
                    style={{ left: Math.max(8, pop.x), top: pop.above ? undefined : pop.y, bottom: pop.above ? window.innerHeight - pop.y : undefined }}
                >
                    <p className="m-0 text-base"><b>{typeLabel(pop.record.type)}</b>{pop.record.date && <> · <span className="date-mono text-sm">{date(pop.record.date)}</span></>}</p>
                    <p className="m-0 text-meta text-text-muted"><RecordPlace record={pop.record} placeId={placeId} placeName={placeName} /></p>
                    <RecordPeople record={pop.record} treeId={treeId} />
                    {canEdit && <div className="mt-1"><EditLink record={pop.record} /></div>}
                </div>,
                document.body,
            )}
        </div>
    );
}
