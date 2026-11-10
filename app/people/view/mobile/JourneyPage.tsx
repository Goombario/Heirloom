'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { EVENT_TYPES, getEventDisplayType } from '@/lib/db/schema';
import type { JourneyStop } from '@/app/components/LocationJourneyModal';
import { useJourneyMap } from '@/app/components/useJourneyMap';
import { Sheet } from '@/app/components/ui/Sheet';
import { cx } from '@/app/components/ui';
import { ArrowUpRight } from '@/lib/icons';
import { miniMapPoints, type JourneyPlace } from './model';

/*
 * The person's journey on the phone (#1052, tracking #1054): a row with a small map
 * at the top of Events, opening a full-screen page with the map and numbered stops.
 * Places with no coordinates can't be pinned, so they're listed under the map.
 */

function useTypeLabel() {
    const tTypes = useTranslations('eventTypes');
    return (type: string) => (EVENT_TYPES[type] ? tTypes(type as Parameters<typeof tTypes>[0]) : getEventDisplayType(type));
}

const years = (s: JourneyPlace) => (s.from == null ? '' : s.to != null && s.to !== s.from ? `${s.from}–${s.to}` : String(s.from));
const town = (place: string) => place.split(',')[0].trim();

/** The small static map: the route and its stops, drawn without tiles. */
function MiniMap({ stops, big = false }: { stops: { lat: number; lng: number }[]; big?: boolean }) {
    const pts = miniMapPoints(stops).map((p) => ({ x: p.x * 400, y: p.y * 300 }));
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    return (
        <svg viewBox="0 0 400 300" aria-hidden="true" className="block w-full h-full">
            <rect width="400" height="300" className="fill-[color:var(--color-surface-2)]" />
            {pts.length > 1 && <path d={path} fill="none" className="stroke-[color:var(--color-primary)]" strokeWidth={big ? 2.5 : 6} strokeDasharray={big ? '6 6' : '12 9'} strokeLinecap="round" />}
            {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={big ? 11 : 18} className="fill-[color:var(--color-primary)]" />)}
        </svg>
    );
}

/** The row atop Events: a mini map, "Journey", and how many places it covers. */
export function JourneyRow({ places, onOpen }: { places: JourneyPlace[]; onOpen: () => void }) {
    const t = useTranslations('mobileProfile');
    const mapped = places.filter((p) => p.at).map((p) => p.at!);
    const first = places[0], last = places[places.length - 1];
    const span = [first?.from, last?.to].filter((y) => y != null);
    const route = first && last && town(first.place) !== town(last.place)
        ? t('journey_route', { from: town(first.place), to: town(last.place) })
        : first ? town(first.place) : '';
    const sub = [t('places_count', { count: places.length }), [route, span.length ? (span[0] === span[1] ? String(span[0]) : span.join('–')) : null].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    return (
        <button type="button" onClick={onOpen}
            className="flex w-full min-h-11 items-center gap-3 px-4 py-3 text-left cursor-pointer border-b border-border active:bg-surface-2 focus-ring-inset">
            <span aria-hidden="true" className="w-16 h-11 shrink-0 overflow-hidden rounded-lg bg-surface-2"><MiniMap stops={mapped} /></span>
            <span className="flex-1 min-w-0 grid gap-px">
                <span className="text-base font-semibold text-text">{t('journey')}</span>
                <span className="text-meta text-text-muted">{sub}</span>
            </span>
            <ArrowUpRight className="w-[18px] h-[18px] shrink-0 text-text-muted" aria-hidden="true" />
        </button>
    );
}

export function JourneyPage({ open, onClose, places }: { open: boolean; onClose: () => void; places: JourneyPlace[] }) {
    const t = useTranslations('mobileProfile');
    return (
        <Sheet open={open} onClose={onClose} onBack={onClose} title={t('journey')} size="screen">
            {open && <JourneyBody places={places} />}
        </Sheet>
    );
}

function JourneyBody({ places }: { places: JourneyPlace[] }) {
    const t = useTranslations('mobileProfile');
    const tc = useTranslations('common');
    const typeLabel = useTypeLabel();
    const mapped = places.filter((p) => p.at);
    const unmapped = places.filter((p) => !p.at);
    const stops: JourneyStop[] = mapped.map((p) => ({
        lat: p.at!.lat, lng: p.at!.lng, label: p.place, title: p.types.map(typeLabel).join(', '), date: years(p) || null,
    }));
    const { elRef, failed, focusStop } = useJourneyMap(stops);

    const row = (p: JourneyPlace, n: number | null, onClick?: () => void) => {
        const body = (
            <>
                {n != null
                    ? <span aria-hidden="true" className="grid place-items-center w-[22px] h-[22px] rounded-full bg-primary text-white text-xs font-semibold">{n}</span>
                    : <span aria-hidden="true" />}
                <span className="min-w-0 grid gap-0.5">
                    <span className="text-base font-semibold text-text">{p.place}</span>
                    <span className="text-meta text-text-muted">
                        {years(p) && <><span className="date-mono">{years(p)}</span> · </>}
                        {p.types.map(typeLabel).join(', ')}
                    </span>
                </span>
            </>
        );
        const cls = 'grid grid-cols-[26px_1fr] gap-2.5 w-full px-4 py-[11px] text-left';
        return onClick
            ? <button type="button" onClick={onClick} className={cx(cls, 'cursor-pointer active:bg-surface-2 focus-ring-inset')}>{n != null && <span className="sr-only">{t('stop_number', { n })}</span>}{body}</button>
            : <div className={cls}>{body}</div>;
    };

    return (
        <div className="-mx-4 -mt-3">
            <div className="relative aspect-[4/3] bg-surface-2 border-b border-border">
                <div ref={elRef} data-vaul-no-drag="" className="absolute inset-0" />
                {failed && (
                    <div className="absolute inset-0 grid place-items-center">
                        <div className="absolute inset-0 opacity-70"><MiniMap stops={mapped.map((p) => p.at!)} big /></div>
                        <span className="relative text-meta text-text-muted bg-card/80 px-2 py-1 rounded">{tc('map_unavailable')}</span>
                    </div>
                )}
            </div>
            <ol className="list-none m-0 p-0 pt-1">
                {mapped.map((p, i) => <li key={`${p.place}-${i}`} className={cx(i > 0 && 'border-t border-border')}>{row(p, i + 1, () => focusStop(i))}</li>)}
            </ol>
            {unmapped.length > 0 && (
                <section className="mt-2 pt-4 border-t border-border">
                    <h2 className="eyebrow m-0 px-4 mb-1">{t('not_on_map')}</h2>
                    <p className="m-0 px-4 pb-1 text-meta text-text-muted">{t('not_on_map_sub')}</p>
                    <ul className="list-none m-0 p-0">
                        {unmapped.map((p, i) => <li key={`${p.place}-${i}`} className={cx(i > 0 && 'border-t border-border')}>{row(p, null)}</li>)}
                    </ul>
                </section>
            )}
        </div>
    );
}
