'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import Modal from '@/app/components/Modal';
import LocationMap from '@/app/components/LocationMap';
import GeocodingPrompt from '@/app/components/GeocodingPrompt';
import { useGeocodingChoice } from '@/app/hooks/useGeocodingChoice';
import { Button, DialogActions, DialogHeader, InlinePanel, Input, SectionHeader, cx } from '@/app/components/ui';
import { useMenuKeyboard } from '@/app/components/ui/useMenuKeyboard';
import { ChevronDown, MapPin, Search } from '@/lib/icons';
import { fetchCandidates, type PhotonCandidate } from '@/lib/geocode/photon';
import { isGeocodingEnabled } from '@/lib/geocode/prefs';
import { distanceKm, parseCoordinate, parseCoordinatePair } from '@/lib/geo/coordinates';

export type FixMode = 'search' | 'drag' | 'type';
type Point = { lat: number; lng: number };

/** A result this far from the current pin asks before it moves it (#56). */
const FAR_KM = 50;
const fmt = (n: number) => n.toFixed(4);

/**
 * Fix the location ⌄ (#56): one button under Details with three ways to put the
 * pin right: search the map again, drag the pin, or type coordinates. A place
 * with no pin of its own reads Put it on the map, and drags from its parent's
 * pin; with no pin anywhere there is nothing to drag.
 */
export function FixLocationMenu({ pinned, canDrag, onPick, triggerRef }: {
    pinned: boolean;
    canDrag: boolean;
    onPick: (mode: FixMode) => void;
    triggerRef: React.Ref<HTMLButtonElement>;
}) {
    const t = useTranslations('placeDesktop');
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
    const wrap = useRef<HTMLSpanElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const menuId = useId();
    const close = (returnFocus: boolean) => {
        setOpen(false);
        if (returnFocus) wrap.current?.querySelector('button')?.focus();
    };
    const onKeyDown = useMenuKeyboard({ open, menuRef: menu, onClose: close });

    useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent) => {
            const target = e.target as Node;
            if (wrap.current?.contains(target) || menu.current?.contains(target)) return;
            setOpen(false);
        };
        const onMove = () => setOpen(false);
        document.addEventListener('pointerdown', onDown);
        window.addEventListener('resize', onMove);
        window.addEventListener('scroll', onMove, true);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            window.removeEventListener('resize', onMove);
            window.removeEventListener('scroll', onMove, true);
        };
    }, [open]);

    const items: { mode: FixMode; label: string }[] = [
        { mode: 'search', label: pinned ? t('fix_search') : t('fix_search_new') },
        ...(canDrag ? [{ mode: 'drag' as const, label: pinned ? t('fix_drag') : t('fix_drop') }] : []),
        { mode: 'type', label: t('fix_type') },
    ];
    const label = pinned ? t('fix_location') : t('put_on_map');

    return (
        <span ref={wrap} className="inline-block">
            <Button
                ref={triggerRef}
                variant="outline"
                size="sm"
                icon={<MapPin size={14} aria-hidden="true" />}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                onClick={(e) => {
                    if (open) { setOpen(false); return; }
                    const r = e.currentTarget.getBoundingClientRect();
                    // Opens above the button when there's no room for it below.
                    setPos(window.innerHeight - r.bottom < 160 ? { bottom: window.innerHeight - r.top + 4, left: r.left } : { top: r.bottom + 4, left: r.left });
                    setOpen(true);
                }}
            >
                <span className="inline-flex items-center gap-1">{label}<ChevronDown size={14} aria-hidden="true" /></span>
            </Button>
            {open && pos && createPortal(
                <div
                    ref={menu}
                    id={menuId}
                    role="menu"
                    aria-label={label}
                    onKeyDown={onKeyDown}
                    className="fixed z-50 w-60 rounded-lg border border-border bg-card p-1.5 shadow-[var(--shadow-lg)] text-text"
                    style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
                >
                    {items.map((item) => (
                        <button
                            key={item.mode}
                            type="button"
                            role="menuitem"
                            tabIndex={-1}
                            onClick={() => { setOpen(false); onPick(item.mode); }}
                            className="flex w-full min-h-9 items-center rounded-md px-2.5 py-1.5 text-left text-sm cursor-pointer hover:bg-hover-surface focus-ring-inset"
                        >
                            {item.label}
                        </button>
                    ))}
                </div>,
                document.body,
            )}
        </span>
    );
}

/**
 * Type coordinates, in place of Details: latitude and longitude, each taking
 * decimal degrees or degrees, minutes and seconds. Pasting "lat, lon" into
 * either box fills both.
 */
export function TypeCoordinatesPanel({ placeName, current, saving, onSave, onCancel }: {
    placeName: string;
    current: Point | null;
    saving: boolean;
    onSave: (p: Point) => void;
    onCancel: () => void;
}) {
    const t = useTranslations('placeDesktop');
    const tp = useTranslations('places');
    const [lat, setLat] = useState(current ? fmt(current.lat) : '');
    const [lng, setLng] = useState(current ? fmt(current.lng) : '');
    const [tried, setTried] = useState(false);
    const latV = parseCoordinate(lat, 'lat');
    const lngV = parseCoordinate(lng, 'lng');
    const dirty = current ? lat !== fmt(current.lat) || lng !== fmt(current.lng) : lat !== '' || lng !== '';

    // A pasted pair fills both boxes, whichever one it was pasted into.
    const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        const pair = parseCoordinatePair(e.clipboardData.getData('text'));
        if (!pair) return;
        e.preventDefault();
        setLat(fmt(pair.lat));
        setLng(fmt(pair.lng));
    };
    const save = () => {
        setTried(true);
        if (latV == null || lngV == null) return;
        onSave({ lat: latV, lng: lngV });
    };

    return (
        <section aria-labelledby="place-type-title">
            <SectionHeader level="rail" headingId="place-type-title" title={t('fix_type')} />
            <InlinePanel label={t('fix_type_for', { place: placeName })} onSave={save} onCancel={onCancel} saving={saving} saveDisabled={!dirty} dirty={dirty}>
                <Input
                    label={t('latitude')}
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    onPaste={onPaste}
                    placeholder="51.5072"
                    className="tabular-nums"
                    aria-invalid={tried && latV == null ? true : undefined}
                    hint={tried && latV == null ? <span role="alert" className="text-error">{t('latitude_invalid')}</span> : undefined}
                />
                <Input
                    label={t('longitude')}
                    value={lng}
                    onChange={(e) => setLng(e.target.value)}
                    onPaste={onPaste}
                    placeholder="-0.1276"
                    className="tabular-nums"
                    aria-invalid={tried && lngV == null ? true : undefined}
                    hint={tried && lngV == null ? <span role="alert" className="text-error">{t('longitude_invalid')}</span> : undefined}
                />
                <p className="m-0 text-meta text-text-muted">{t('coords_hint')}</p>
                {current && <p className="m-0 text-meta text-text-muted">{tp('coordinates')}: <span className="tabular-nums">{fmt(current.lat)}, {fmt(current.lng)}</span></p>}
            </InlinePanel>
        </section>
    );
}

/** Drag the pin: the bar over the cover while the pin is being moved. */
export function DragBar({ placeName, from, to, saving, onSave, onCancel }: {
    placeName: string;
    from: Point | null;
    to: Point | null;
    saving: boolean;
    onSave: () => void;
    onCancel: () => void;
}) {
    const t = useTranslations('placeDesktop');
    const tc = useTranslations('common');
    const moved = to != null && (from == null || to.lat !== from.lat || to.lng !== from.lng);
    return (
        <div role="region" aria-label={t('drag_title', { place: placeName })} className="place-cover__dragbar flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-[var(--shadow-lg)] text-text">
            <span className="text-sm font-medium">{t('drag_title', { place: placeName })}</span>
            <span className="text-meta text-text-muted tabular-nums">
                {from ? `${fmt(from.lat)}, ${fmt(from.lng)}` : t('no_pin_yet')}
                {' → '}
                {moved ? `${fmt(to.lat)}, ${fmt(to.lng)}` : t('drag_not_moved')}
            </span>
            <span className="flex-1" />
            <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>{tc('cancel')}</Button>
            <Button variant="primary" size="sm" onClick={onSave} disabled={saving || !moved}>{saving ? tc('saving') : tc('save')}</Button>
        </div>
    );
}

/**
 * Search the map again: the place's name searched straight away, the results
 * with a preview of the one in focus, the current match marked. Picking one far
 * from the pin asks first. Only the pin and "On the map as" change.
 */
export function SearchMapDialog({ placeName, current, currentOsm, saving, onPick, onClose }: {
    placeName: string;
    current: Point | null;
    currentOsm: { type: string | null; id: number | null };
    saving: boolean;
    onPick: (c: PhotonCandidate) => void;
    onClose: () => void;
}) {
    const t = useTranslations('placeDesktop');
    const tp = useTranslations('places');
    const tc = useTranslations('common');
    const titleId = useId();
    const choice = useGeocodingChoice();
    const [query, setQuery] = useState(placeName.split(',')[0]?.trim() || placeName);
    const [results, setResults] = useState<PhotonCandidate[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [picked, setPicked] = useState<number>(0);
    const [confirmFar, setConfirmFar] = useState(false);
    const abort = useRef<AbortController | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const search = (q: string) => {
        abort.current?.abort();
        if (!isGeocodingEnabled() || q.trim().length < 3) { setResults([]); return; }
        const ctrl = new AbortController();
        abort.current = ctrl;
        setFailed(false);
        setResults(null);
        fetchCandidates(q.trim(), { signal: ctrl.signal })
            .then((r) => { setResults(r); setPicked(0); setConfirmFar(false); })
            .catch((e) => { if ((e as Error).name !== 'AbortError') { setResults([]); setFailed(true); } });
    };
    // Opening searches the name at once: what the map thinks it is IS the question.
    const started = useRef(false);
    useEffect(() => {
        if (started.current || choice !== 'on') return;
        started.current = true;
        const id = setTimeout(() => search(query), 0);
        return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when lookups are on
    }, [choice]);
    useEffect(() => () => { abort.current?.abort(); if (timer.current) clearTimeout(timer.current); }, []);

    const sel = results?.[picked] ?? null;
    const selPoint = sel ? { lat: sel.result.lat, lng: sel.result.lng } : null;
    const far = current && selPoint ? distanceKm(current, selPoint) : 0;
    const isCurrent = (c: PhotonCandidate) => currentOsm.id != null && c.result.osmId === currentOsm.id && c.result.osmType === currentOsm.type;
    const use = () => {
        if (!sel) return;
        if (far > FAR_KM && !confirmFar) { setConfirmFar(true); return; }
        onPick(sel);
    };

    return (
        <Modal open onClose={onClose} size="lg" labelledBy={titleId} disableClose={saving}>
            <div className="bg-card rounded-2xl shadow-xl overflow-hidden">
            <div className="p-5 pb-3">
                <DialogHeader title={t('search_title')} titleId={titleId} subtitle={t('search_sub', { place: placeName })} onClose={onClose} closeDisabled={saving} />
            </div>
            {choice === null ? (
                <div className="px-5 pb-5"><GeocodingPrompt onEnabled={() => search(query)} /></div>
            ) : choice === 'off' ? (
                <p className="px-5 pb-5 m-0 text-sm text-text-muted">{tp('rematch_geocoding_off')}</p>
            ) : (
                <div className="px-5 pb-5 grid gap-3">
                    <Input
                        size="sm"
                        autoFocus
                        icon={<Search size={14} aria-hidden="true" />}
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            if (timer.current) clearTimeout(timer.current);
                            const v = e.target.value;
                            timer.current = setTimeout(() => search(v), 350);
                        }}
                        aria-label={tp('rematch_search_placeholder')}
                        placeholder={tp('rematch_search_placeholder')}
                    />
                    <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-3 min-h-[240px]">
                        <div aria-live="polite" className="max-h-[300px] overflow-y-auto scroll-area">
                            {results == null ? <p className="m-0 text-sm text-text-muted">{tp('rematch_searching')}</p>
                                : failed ? <p className="m-0 text-sm text-text-muted">{tp('rematch_search_failed')}</p>
                                : results.length === 0 ? <p className="m-0 text-sm text-text-muted">{tp('rematch_no_results')}</p>
                                : (
                                    <ul role="listbox" aria-label={t('search_results')} className="m-0 p-0 list-none grid gap-0.5">
                                        {results.map((c, i) => (
                                            <li key={`${c.result.osmType ?? ''}-${c.result.osmId ?? i}`} role="option" aria-selected={i === picked}>
                                                <button
                                                    type="button"
                                                    onClick={() => { setPicked(i); setConfirmFar(false); }}
                                                    className={cx('w-full text-left rounded-md px-2.5 py-2 text-sm cursor-pointer focus-ring-inset', i === picked ? 'bg-surface-2' : 'hover:bg-hover-surface')}
                                                >
                                                    <span className="block text-text">{c.result.name}</span>
                                                    {isCurrent(c) && <span className="block text-meta text-text-muted">{t('search_current')}</span>}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                        </div>
                        <div className="rounded-md overflow-hidden border border-border bg-card-alt">
                            {selPoint && (
                                <LocationMap
                                    key={`${selPoint.lat},${selPoint.lng}`}
                                    variant="mini"
                                    height={240}
                                    markers={[
                                        { lat: selPoint.lat, lng: selPoint.lng, label: sel!.result.name },
                                        ...(current ? [{ lat: current.lat, lng: current.lng, label: t('old_pin'), ghost: true }] : []),
                                    ]}
                                />
                            )}
                        </div>
                    </div>
                    {confirmFar && (
                        <p role="alert" className="m-0 text-sm text-warning-text">{t('search_far', { km: Math.round(far).toLocaleString() })}</p>
                    )}
                    <p className="m-0 text-meta text-text-muted">{t('search_keeps_records')}</p>
                </div>
            )}
            <DialogActions>
                <Button variant="outline" onClick={onClose} disabled={saving}>{tc('cancel')}</Button>
                <Button variant="primary" onClick={use} disabled={!sel || saving}>
                    {saving ? tc('saving') : confirmFar ? t('search_use_anyway') : t('search_use')}
                </Button>
            </DialogActions>
            </div>
        </Modal>
    );
}
