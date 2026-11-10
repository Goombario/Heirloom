'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { compareText } from '@/lib/collation';
import { DataTable, Card, type Column } from '@/app/components/ui';
import { Users } from '@/lib/icons';
import { PinMark } from './PinMark';
import type { PlaceFace } from '@/lib/data/types';
import { placeHref } from '@/lib/places/place-key';

export interface PlacesTableRow {
    id?: number | null;
    name: string;
    count: number;
    peopleCount: number;
    faces: PlaceFace[];
    latitude?: number | null;
    longitude?: number | null;
}

type SortKey = 'name' | 'count' | 'peopleCount';

function splitPlace(name: string): { label: string; region: string } {
    const i = name.indexOf(',');
    if (i === -1) return { label: name.trim(), region: '' };
    return { label: name.slice(0, i).trim(), region: name.slice(i + 1).trim() };
}

export function PlacesTable({ places }: { places: PlacesTableRow[] }) {
    const t = useTranslations('places');
    const locale = useLocale();
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });

    const sorted = useMemo(() => {
        const copy = [...places];
        copy.sort((a, b) => {
            const cmp = sort.key === 'name'
                ? compareText(a.name, b.name, locale)
                : sort.key === 'count' ? a.count - b.count : a.peopleCount - b.peopleCount;
            return sort.dir === 'asc' ? cmp : -cmp;
        });
        return copy;
    }, [places, sort, locale]);

    function handleSortChange(key: string) {
        if (key !== 'name' && key !== 'count' && key !== 'peopleCount') return;
        setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
    }

    const columns: Column<PlacesTableRow>[] = [
        {
            key: 'name',
            header: t('col_name'),
            sortable: true,
            render: (row) => {
                const { label, region } = splitPlace(row.name);
                return (
                    <Link
                        href={placeHref(row)}
                        className="block rounded-card focus-ring"
                    >
                        <div className="serif text-sm font-semibold text-text">{label}</div>
                        {region && <div className="text-xs text-text-muted mt-0.5">{region}</div>}
                    </Link>
                );
            },
        },
        {
            key: 'count',
            header: t('col_records'),
            sortable: true,
            align: 'right',
            render: (row) => (
                <span className="tabular-nums text-text-secondary" title={t('records_total', { count: row.count })}>
                    <span aria-hidden="true">{row.count}</span>
                    <span className="sr-only">{t('records_total', { count: row.count })}</span>
                </span>
            ),
        },
        {
            key: 'peopleCount',
            header: t('col_people'),
            sortable: true,
            render: (row) => (
                <span className="inline-flex items-center gap-1.5 text-text-secondary" title={t('people_linked', { count: row.peopleCount })}>
                    <Users size={13} className="opacity-60" aria-hidden="true" />
                    {row.peopleCount}
                </span>
            ),
        },
        {
            key: 'coordinates',
            header: t('col_coordinates'),
            render: (row) => {
                const own = row.latitude != null && row.longitude != null;
                return (
                    // The geocode-state mark from the one canonical set (#266). Only the
                    // own-pin mark: these rows carry no parent, so the hollow ring — which
                    // means "no pin anywhere" — would be a claim the list cannot make about
                    // a place that inherits one. "Not geocoded" already says the rest.
                    <span className="inline-flex items-center gap-1.5 tabular-nums text-text-muted">
                        {own && <PinMark state="own" />}
                        {own ? `${row.latitude!.toFixed(4)}, ${row.longitude!.toFixed(4)}` : t('not_geocoded')}
                    </span>
                );
            },
        },
    ];

    return (
        <>
            {/* Desktop: the shared sortable table primitive. Row navigation is via
                a Link in the name cell, following the People page pattern. */}
            <Card pad={false} className="hidden md:block overflow-hidden">
                <DataTable
                    columns={columns}
                    rows={sorted}
                    rowKey={(row) => row.name}
                    sort={sort}
                    onSortChange={handleSortChange}
                />
            </Card>

            {/* Mobile: DataTable is desktop-only by design (its own doc comment says
                "pair it with a bespoke mobile card list") — stacked compact rows with
                the same 4 fields, matching the People/Families mobile-list precedent. */}
            <div className="md:hidden flex flex-col gap-2">
                {sorted.map((row) => {
                    const { label, region } = splitPlace(row.name);
                    return (
                        <Link
                            key={row.id ?? row.name}
                            href={placeHref(row)}
                            className="block rounded-card focus-ring"
                        >
                            <Card pad={false} className="p-3 min-h-[44px]">
                                <div className="serif text-sm font-semibold text-text">{label}</div>
                                {region && <div className="text-xs text-text-muted mt-0.5">{region}</div>}
                                <div className="flex items-center gap-3 mt-1.5 text-xs text-text-muted">
                                    <span className="inline-flex items-center gap-1 tabular-nums" title={t('records_total', { count: row.count })}>
                                        <span aria-hidden="true">{row.count}</span>
                                        <span className="sr-only">{t('records_total', { count: row.count })}</span>
                                    </span>
                                    <span className="inline-flex items-center gap-1">
                                        <Users size={12} className="opacity-60" aria-hidden="true" />
                                        {row.peopleCount}
                                    </span>
                                    {/* Same mark as the desktop column — a fixed MapPin here
                                        meant the "no pin" row still showed a pin (#266). */}
                                    <span className="inline-flex items-center gap-1 tabular-nums">
                                        {row.latitude != null && row.longitude != null && <PinMark state="own" />}
                                        {row.latitude != null && row.longitude != null
                                            ? `${row.latitude.toFixed(4)}, ${row.longitude.toFixed(4)}`
                                            : t('not_geocoded')}
                                    </span>
                                </div>
                            </Card>
                        </Link>
                    );
                })}
            </div>
        </>
    );
}
