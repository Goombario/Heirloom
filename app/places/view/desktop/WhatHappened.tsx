'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ActionLink, AvatarStack, Card, FilterChip, SectionHeader, SegmentedControl, cx } from '@/app/components/ui';
import { useLanguage } from '@/app/components/LanguageProvider';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { familyEventLabel } from '@/app/components/familyEventTypes';
import { formatDateForDisplay } from '@/lib/date-utils';
import { placeHref } from '@/lib/places/place-key';
import type { PlaceFactLinkEntry } from '@/lib/data/types';
import {
    CHIP_GROUPS, axisParts, axisScale, chipGroupOf, decadeBlocks, lanes, placeRecords,
    type ChipGroup, type PlaceRecord,
} from './placeRecords';

type View = 'decade' | 'lanes';
const FACES = 5;
const shortName = (name: string) => name.split(',')[0]?.trim() || name;

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

/**
 * The read-only summary of one record (#56): its date, the place when it is one
 * within this one, its people, and "Edit on X's page ↗" for those who can edit.
 * Lines with nothing to say are left out.
 */
function RecordSummary({ record, placeId, canEdit }: { record: PlaceRecord; placeId: number | null; canEdit: boolean }) {
    const t = useTranslations('placeDesktop');
    const date = useDate();
    const typeLabel = useTypeLabel();
    const owner = record.kind === 'marriage' ? null : record.people[0];
    return (
        <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-text-muted">{t('summary_what')}</dt>
            <dd className="m-0 text-text">{typeLabel(record.type)}</dd>
            {record.date && (
                <>
                    <dt className="text-text-muted">{t('summary_date')}</dt>
                    <dd className="m-0 date-mono">{date(record.date)}</dd>
                </>
            )}
            {record.placeId !== placeId && (
                <>
                    <dt className="text-text-muted">{t('summary_place')}</dt>
                    <dd className="m-0"><Link href={placeHref({ id: record.placeId, name: record.placeName })} className="text-link hover:underline">{shortName(record.placeName)}</Link></dd>
                </>
            )}
            <dt className="text-text-muted">{t('summary_people', { count: record.people.length })}</dt>
            <dd className="m-0 flex flex-wrap gap-x-2">
                {record.people.map((p, i) => (
                    <span key={p.id}>
                        <Link href={`/people/view?id=${p.id}`} className="text-text hover:underline">{p.name || '?'}</Link>
                        {i < record.people.length - 1 && ','}
                    </span>
                ))}
            </dd>
            {canEdit && (
                <dd className="col-start-2 m-0 mt-1">
                    <ActionLink kind="leave" href={editHref(record)}>
                        {owner ? t('edit_on_page', { name: owner.name || '?' }) : t('edit_on_family')}
                    </ActionLink>
                </dd>
            )}
        </dl>
    );
}

/** One row of the chronicle; it opens in place into the summary. */
function ChronicleRow({ record, open, onToggle, placeId, canEdit, treeId }: {
    record: PlaceRecord; open: boolean; onToggle: () => void; placeId: number | null; canEdit: boolean; treeId: number | null;
}) {
    const date = useDate();
    const typeLabel = useTypeLabel();
    const names = record.people.map((p) => p.name || '?').join(', ');
    return (
        <li className="border-b border-border-light last:border-0">
            <button
                type="button"
                aria-expanded={open}
                onClick={onToggle}
                className={cx('w-full grid grid-cols-[120px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left text-sm border-0 bg-transparent cursor-pointer rounded-btn hover:bg-hover-surface focus-ring-inset', open && 'bg-surface-2')}
            >
                <span className="date-mono truncate">{record.date ? date(record.date) : ''}</span>
                <span className="min-w-0 truncate text-text">
                    <span className="font-medium">{typeLabel(record.type)}</span>
                    <span className="text-text-secondary"> · {names}</span>
                    {record.placeId !== placeId && <span className="text-text-muted"> · {shortName(record.placeName)}</span>}
                </span>
                <AvatarStack people={record.people.map((p) => ({ id: p.id, name: p.name, sex: p.sex, mediaId: p.mediaId }))} size={24} max={FACES} treeId={treeId} />
            </button>
            {open && <div className="px-3 pb-3 pt-1 pl-[135px]"><RecordSummary record={record} placeId={placeId} canEdit={canEdit} /></div>}
        </li>
    );
}

/**
 * What happened here (#56), the place page's main section: every record at the
 * place, By decade (a chronicle with type chips, quiet stretches folded onto a
 * dotted rail) or Who was here when (one lane per person). Opening a record
 * reports its place, so the cover map can ring that pin.
 */
export function WhatHappened({ links, placeId, treeId, canEdit, deletable, onSelectPlace }: {
    links: PlaceFactLinkEntry[];
    placeId: number | null;
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
    const [shown, setShown] = useState<Set<number>>(() => new Set());
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
    const dated = filtered.filter((r) => r.year != null);
    const undated = filtered.filter((r) => r.year == null);
    const blocks = decadeBlocks(dated);

    const toggle = (r: PlaceRecord) => {
        const next = open === r.key ? null : r.key;
        setOpen(next);
        onSelectPlace(next ? r.placeId : null);
    };
    const row = (r: PlaceRecord) => (
        <ChronicleRow key={r.key} record={r} open={open === r.key} onToggle={() => toggle(r)} placeId={placeId} canEdit={canEdit} treeId={treeId} />
    );

    return (
        <section aria-labelledby="place-events-title">
            <SectionHeader
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
                    <div className="flex flex-wrap gap-1.5 mb-3" role="group" aria-label={t('chips_label')}>
                        <FilterChip active={chip === 'all'} count={records.length} onClick={() => setChip('all')}>{t('chip_all')}</FilterChip>
                        {(Object.keys(CHIP_GROUPS) as ChipGroup[]).filter((g) => counts.has(g)).map((g) => (
                            <FilterChip key={g} active={chip === g} count={counts.get(g)} onClick={() => setChip(g)}>{t(`chip_${g}`)}</FilterChip>
                        ))}
                    </div>
                    <div className="grid gap-4">
                        {blocks.map((b) => b.kind === 'decade' ? (
                            <div key={b.decade}>
                                <h3 className="m-0 mb-1 text-meta font-semibold date-mono">{t('decade', { decade: b.decade })}</h3>
                                <Card pad={false}><ul className="m-0 p-1 list-none">{b.records.map(row)}</ul></Card>
                            </div>
                        ) : (
                            <div key={`q${b.from}`} className="relative pl-4 border-l-2 border-dotted border-border">
                                <p className="m-0 text-meta text-text-muted">
                                    <span className="date-mono">{b.from === b.to ? t('decade', { decade: b.from }) : t('decade_span', { from: b.from, to: b.to })}</span>
                                    {' · '}
                                    {b.records.length === 0 ? t('quiet_none') : (
                                        shown.has(b.from) ? t('quiet_count', { count: b.records.length }) : (
                                            <ActionLink kind="expand" onClick={() => setShown((s) => new Set(s).add(b.from))}>{t('show_records', { count: b.records.length })}</ActionLink>
                                        )
                                    )}
                                </p>
                                {shown.has(b.from) && b.records.length > 0 && (
                                    <Card pad={false} className="mt-2"><ul className="m-0 p-1 list-none">{b.records.map(row)}</ul></Card>
                                )}
                            </div>
                        ))}
                        {undated.length > 0 && (
                            <div>
                                <h3 className="m-0 mb-1 text-meta font-semibold text-text-secondary">{t('undated')}</h3>
                                <Card pad={false}><ul className="m-0 p-1 list-none">{undated.map(row)}</ul></Card>
                            </div>
                        )}
                        {filtered.length === 0 && <p className="m-0 text-sm text-text-muted">{tp('no_records_here')}</p>}
                    </div>
                </>
            ) : (
                <Lanes records={records} placeId={placeId} canEdit={canEdit} onSelectPlace={onSelectPlace} />
            )}
        </section>
    );
}

const MARK_GLYPH: Record<string, string> = { BIRT: '●', DEAT: '✝', MARR: '⚭', EMIG: '↗', IMMI: '↙' };

/** Who was here when: one lane per person on a shared axis, long quiet stretches folded. */
function Lanes({ records, placeId, canEdit, onSelectPlace }: {
    records: PlaceRecord[]; placeId: number | null; canEdit: boolean; onSelectPlace: (placeId: number | null) => void;
}) {
    const t = useTranslations('placeDesktop');
    const typeLabel = useTypeLabel();
    const date = useDate();
    const [unfold, setUnfold] = useState(false);
    const [pop, setPop] = useState<{ record: PlaceRecord; x: number; y: number; above: boolean } | null>(null);
    const popRef = useRef<HTMLDivElement>(null);
    const markRef = useRef<HTMLElement | null>(null);
    const rows = useMemo(() => lanes(records), [records]);
    const years = records.flatMap((r) => (r.year != null ? [r.year] : []));
    const parts = axisParts(years, unfold);
    const x = axisScale(parts);
    // Each to-scale stretch is labelled at its ends and every 20 years between, where there's room.
    const ticks = parts.flatMap((p) => {
        if (p.folded) return [];
        if (p.from === p.to) return [p.from];
        const inner: number[] = [];
        for (let y = Math.ceil((p.from + 8) / 20) * 20; y <= p.to - 8; y += 20) inner.push(y);
        return [p.from, ...inner, p.to];
    });

    useEffect(() => {
        if (!pop) return;
        popRef.current?.focus();
        const close = () => { setPop(null); onSelectPlace(null); };
        const onDown = (e: PointerEvent) => { if (!popRef.current?.contains(e.target as Node)) close(); };
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

    const openMark = (r: PlaceRecord, el: HTMLElement) => {
        markRef.current = el;
        const rect = el.getBoundingClientRect();
        // Flips above the marker when there's no room below.
        const above = window.innerHeight - rect.bottom < 240;
        setPop({ record: r, x: Math.min(rect.left, window.innerWidth - 340), y: above ? rect.top - 6 : rect.bottom + 6, above });
        onSelectPlace(r.placeId);
    };

    const folded = parts.some((p) => p.folded);
    return (
        <Card pad={false} className="p-4">
            <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-3">
                <span />
                <div className="relative h-5 mb-2 text-xs date-mono text-text-muted" aria-hidden="true">
                    {ticks.map((y, i) => (
                        <span key={`${y}-${i}`} className="absolute -translate-x-1/2" style={{ left: `${x(y) * 100}%` }}>{y}</span>
                    ))}
                </div>
                {rows.map((lane) => (
                    <div key={lane.personId} className="contents">
                        <Link href={`/people/view?id=${lane.personId}`} className="serif text-sm text-text truncate py-1.5 hover:underline">{lane.name || '?'}</Link>
                        <div className="relative h-8">
                            {/* The folded stretches, as narrow dotted strips the whole height. */}
                            {parts.filter((p) => p.folded).map((p) => (
                                <span key={p.from} aria-hidden="true" className="absolute inset-y-0 border-x border-dotted border-border" style={{ left: `${x(p.from + 1) * 100 - 1}%`, width: '2%' }} />
                            ))}
                            {lane.undated ? (
                                <span className="absolute left-0 top-1/2 -translate-y-1/2 text-meta text-text-muted">{t('undated')}</span>
                            ) : lane.spans.map((s) => (
                                <span key={s.from} aria-hidden="true" className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[color:var(--color-border)]"
                                    style={{ left: `${x(s.from) * 100}%`, width: `${Math.max(0.5, (x(s.to) - x(s.from)) * 100)}%` }} />
                            ))}
                            {lane.marks.filter((m) => m.year != null).map((m) => (
                                <button
                                    key={m.key}
                                    type="button"
                                    onClick={(e) => openMark(m, e.currentTarget)}
                                    aria-label={`${typeLabel(m.type)} ${date(m.date)}`}
                                    title={`${typeLabel(m.type)} ${date(m.date)}`}
                                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center w-6 h-6 rounded-full border border-border bg-card text-sm leading-none text-text cursor-pointer hover:bg-hover-surface focus-ring"
                                    style={{ left: `${x(m.year!) * 100}%` }}
                                >
                                    <span aria-hidden="true">{MARK_GLYPH[m.type] ?? '•'}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            <p className="m-0 mt-3 text-meta text-text-muted">{t('lanes_key')}</p>
            {(folded || unfold) && (
                <div className="mt-2">
                    <ActionLink kind="expand" expanded={unfold} onClick={() => setUnfold((u) => !u)}>
                        {unfold ? t('fold_quiet') : t('full_scale')}
                    </ActionLink>
                </div>
            )}
            {pop && createPortal(
                <div
                    ref={popRef}
                    role="dialog"
                    tabIndex={-1}
                    aria-label={typeLabel(pop.record.type)}
                    className="fixed z-50 w-80 rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-lg)] text-text"
                    style={{ left: Math.max(8, pop.x), top: pop.above ? undefined : pop.y, bottom: pop.above ? window.innerHeight - pop.y : undefined }}
                >
                    <RecordSummary record={pop.record} placeId={placeId} canEdit={canEdit} />
                </div>,
                document.body,
            )}
        </Card>
    );
}
