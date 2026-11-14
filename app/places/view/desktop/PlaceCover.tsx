'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import LocationMap, { type MapMarker } from '@/app/components/LocationMap';
import { CoverBand, RecordMenu, buttonClass, cx, type RecordMenuItem } from '@/app/components/ui';
import { MapIcon } from '@/lib/icons';
import { placeHref } from '@/lib/places/place-key';
import type { PlaceDetail } from '@/lib/data/types';

/** Chains longer than this fold their middle into "…" (#56). */
const CHAIN_FOLD = 3;

const shortName = (name: string) => name.split(',')[0]?.trim() || name;

/** What the cover shows: the place's own pin, the pins inside it, a parent's pin, or nothing. */
export type CoverMap =
    | { kind: 'pins'; markers: MapMarker[]; draggable: boolean; onDrag?: (lat: number, lng: number) => void }
    | { kind: 'borrowed'; markers: MapMarker[]; from: string; draggable: boolean; onDrag?: (lat: number, lng: number) => void }
    | { kind: 'none' };

/** "City · Part of Uppland › Sweden", as links, its middle folded when it runs deep. The
 *  kind (#45) leads when the place's FORM gives one; with no parents it stands alone. */
function PartOf({ parents, kind }: { parents: NonNullable<PlaceDetail['parents']>; kind?: string | null }) {
    const t = useTranslations('places');
    const tp = useTranslations('placeDesktop');
    // Nearest first, the way a reader says it: "Uppsala › Uppland › Sweden".
    const chain = [...parents].reverse();
    const folded = chain.length > CHAIN_FOLD;
    const shown = folded ? [chain[0]!, ...chain.slice(-2)] : chain;
    const hidden = folded ? chain.slice(1, -2) : [];
    return (
        <p className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm text-[color:var(--color-text-secondary)]">
            {kind && <span data-testid="place-kind">{kind}</span>}
            {kind && chain.length > 0 && <span aria-hidden="true">·</span>}
            {chain.length > 0 && <span>{t('part_of')}</span>}
            {shown.map((p, i) => (
                <span key={p.id} className="inline-flex min-w-0 items-baseline gap-x-1.5">
                    {i > 0 && <span aria-hidden="true">›</span>}
                    {folded && i === 1 && (
                        <>
                            <span title={hidden.map((h) => shortName(h.name)).join(' › ')} aria-label={tp('chain_more', { count: hidden.length })}>…</span>
                            <span aria-hidden="true">›</span>
                        </>
                    )}
                    <Link href={placeHref(p)} className="min-w-0 break-words text-[color:var(--color-text)] underline decoration-[color:var(--color-text-muted)] underline-offset-2 hover:decoration-[color:var(--color-text)] focus-ring rounded-sm">
                        {shortName(p.name)}
                    </Link>
                </span>
            ))}
        </p>
    );
}

/** "12 people · 48 records · 3 places within · 1820–1951". */
function Counts({ people, records, within, years }: { people: number; records: number; within: number; years: { first: number; last: number } | null }) {
    const t = useTranslations('placeDesktop');
    const parts: React.ReactNode[] = [
        t('cover_people', { count: people }),
        t('cover_records', { count: records }),
        ...(within > 0 ? [t('cover_within', { count: within })] : []),
        ...(years ? [<span key="y" className="date-mono">{years.first === years.last ? years.first : `${years.first}–${years.last}`}</span>] : []),
    ];
    return (
        <p className="m-0 text-sm text-[color:var(--color-text-secondary)] tabular-nums">
            {parts.map((p, i) => <span key={i}>{i > 0 && ' · '}{p}</span>)}
        </p>
    );
}

/** The cover's stat row (fix 06): big numbers over small words, on the right. */
function Stats({ people, records, within, years }: { people: number; records: number; within: number; years: { first: number; last: number } | null }) {
    const t = useTranslations('placeDesktop');
    const stats: Array<{ key: string; n: React.ReactNode; label: string; date?: boolean }> = [
        { key: 'p', n: people, label: t('stat_people', { count: people }) },
        { key: 'r', n: records, label: t('stat_records', { count: records }) },
        ...(within > 0 ? [{ key: 'w', n: within, label: t('stat_within', { count: within }) }] : []),
        ...(years ? [{ key: 'y', n: years.first === years.last ? String(years.first) : `${years.first} – ${years.last}`, label: t('stat_years'), date: true }] : []),
    ];
    return (
        <dl className="place-cover__stats">
            {stats.map((s) => (
                <div key={s.key}>
                    <dt className={s.date ? 'date-mono place-cover__stat-years' : 'place-cover__stat-n'}>{s.n}</dt>
                    <dd>{s.label}</dd>
                </div>
            ))}
        </dl>
    );
}

/**
 * The desktop place page's header (#56). With a pin to show, a map cover: the
 * place's own pin, or the labelled pins of the places within it, or a parent's
 * pin ringed and dashed, with the name, the "Part of" chain and the counts over
 * its foot. With no pin anywhere up the chain, a short flat navy band instead.
 */
export function PlaceCover({ detail, placeName, map, people, records, years, menu, ringed, canEdit, onPutOnMap, dragBar }: {
    detail: PlaceDetail;
    placeName: string;
    map: CoverMap;
    people: number;
    records: number;
    years: { first: number; last: number } | null;
    /** The ⋯ menu's items; viewers pass none. */
    menu: RecordMenuItem[];
    /** The place of the record open below: its pin grows and is named. */
    ringed?: number | null;
    canEdit: boolean;
    onPutOnMap: () => void;
    /** Drag the pin's bar, over the top of the map while it is open. */
    dragBar?: React.ReactNode;
}) {
    const t = useTranslations('placeDesktop');
    const short = shortName(placeName);
    const ringedIds = useMemo(() => (ringed != null ? [ringed] : []), [ringed]);
    const parents = detail.parents ?? [];
    const within = detail.children?.length ?? 0;
    const otherNames = (detail.otherNames ?? []).map((n) => n.name);
    const counts = <Counts people={people} records={records} within={within} years={years} />;
    const actions = menu.length > 0 ? <RecordMenu recordName={short} items={menu} tone="island" /> : null;

    if (map.kind === 'none') {
        return (
            <CoverBand
                variant="flat"
                title={<span className="line-clamp-3" title={placeName}>{short}</span>}
                meta={(
                    <span className="grid gap-1">
                        {parents.length > 0 ? <PartOf parents={parents} kind={detail.kind} /> : (
                            <span>{detail.kind ? `${detail.kind} · ` : ''}{t('not_inside_yet')}</span>
                        )}
                        <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
                            <span>{t('not_on_map_yet')}</span>
                            {canEdit && (
                                <>
                                    <span aria-hidden="true">·</span>
                                    <button type="button" onClick={onPutOnMap} className="cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold text-[color:var(--color-text)] underline underline-offset-2 focus-ring rounded-sm">
                                        {t('put_on_map')}
                                    </button>
                                </>
                            )}
                        </span>
                    </span>
                )}
                actions={(
                    <>
                        <span className="text-right">{counts}</span>
                        {actions}
                    </>
                )}
            />
        );
    }

    return (
        <header className={cx('place-cover', map.kind === 'borrowed' ? 'place-cover--borrowed' : map.markers.length > 1 && 'place-cover--labels')}>
            {/* Full map, top right of the cover (audit fix 06): Explore, on this place. */}
            {detail.id != null && (
                <Link href={`/places?sel=${detail.id}`} className={cx(buttonClass({ variant: 'outline', size: 'sm' }), 'place-cover__full no-underline')}>
                    <MapIcon className="w-4 h-4" aria-hidden="true" />{t('full_map')}
                </Link>
            )}
            <LocationMap
                markers={map.markers}
                variant="full"
                height={340}
                highlightedIds={ringedIds}
                draggable={map.draggable}
                onMarkerDragEnd={map.onDrag}
                className="place-cover__map"
            />
            {dragBar && <div className="place-cover__drag">{dragBar}</div>}
            <div className="hero-dark place-cover__foot">
                <div className="min-w-0 grid gap-1">
                    <p className="eyebrow m-0 text-[color:var(--color-text-muted)]">{t('cover_eyebrow')}</p>
                    <div className="flex items-start gap-3 min-w-0">
                        <h1 className="title-record m-0 min-w-0 line-clamp-3 text-[color:var(--color-text)] [overflow-wrap:anywhere]" title={placeName}>{short}</h1>
                        {actions && <div className="shrink-0 pt-1">{actions}</div>}
                    </div>
                    {(parents.length > 0 || detail.kind) && <PartOf parents={parents} kind={detail.kind} />}
                    {otherNames.length > 0 && (
                        <p className="m-0 text-sm text-[color:var(--color-text-secondary)]">{t('also_recorded_as', { names: otherNames.join(', ') })}</p>
                    )}
                    {map.kind === 'borrowed' && (
                        <p className="m-0 text-meta text-[color:var(--color-text-muted)]" role="note">
                            {t('borrowed_note', { place: short, parent: shortName(map.from) })}
                        </p>
                    )}
                </div>
                <Stats people={people} records={records} within={within} years={years} />
            </div>
        </header>
    );
}
