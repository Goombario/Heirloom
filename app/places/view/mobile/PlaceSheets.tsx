'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import LocationMap from '@/app/components/LocationMap';
import GeocodingPrompt from '@/app/components/GeocodingPrompt';
import { Banner, Button, MobileRow, showChangeToast } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useGeocodingChoice } from '@/app/hooks/useGeocodingChoice';
import { getDataClient } from '@/lib/data';
import type { PlaceDetail } from '@/lib/data/types';
import { chainFromCandidate, fetchCandidates, type PhotonCandidate } from '@/lib/geocode/photon';
import { isGeocodingEnabled } from '@/lib/geocode/prefs';
import { ArrowLeftRight, Globe, MapPin, Move, Search, Tag, Trash2, Type } from '@/lib/icons';
import { parseCoords } from '../PlaceEditFields';
import { placeHref } from '@/lib/places/place-key';
import { MoveRecordsSheet } from '../MoveRecords';
import { PlaceInUseHint, placeUnused } from '../PlaceInUse';
import { RenameChoices, type RenameChoice } from '../OtherNames';
import { mergeTargetNames, sortOtherNames } from '@/lib/places/other-names';

/*
 * The phone place page's edits (#1118). The pencil opens a small sheet: Rename or merge,
 * Move the pin, Match on the map again (Find it on the map with no pin), Type
 * coordinates, Move records to another place (#1186), and Delete a place nothing
 * uses (#1229, editors only; it asks first, in the sheet). Each opens its own sheet over it. A rename or merge offers Undo, which
 * reverts its one audit entry; pin edits return no audit ids yet, so they confirm.
 */

export type PlaceSheet = 'edit' | 'rename' | 'move' | 'match' | 'coords' | 'records';

const short = (name: string) => name.split(',')[0]?.trim() || name;

export function PlaceSheets({ sheet, onSheet, detail, placeName, treeId, canUndo, onChanged, renameStart, onAddName }: {
    sheet: PlaceSheet | null;
    onSheet: (sheet: PlaceSheet | null) => void;
    detail: PlaceDetail;
    placeName: string;
    treeId: number | null;
    canUndo: boolean;
    onChanged: () => Promise<void>;
    /** Rename or merge opened with this typed ("Merge X into Y", #1185). */
    renameStart?: { to: string; keepOld: boolean } | null;
    /** Opens the sheet for a new other name (#1185); absent for a place with no id. */
    onAddName?: () => void;
}) {
    const t = useTranslations('mobilePlaces');
    const tp = useTranslations('places');
    const own = detail.latitude != null && detail.longitude != null;
    const name = short(placeName);
    // The pencil sheet stays open beneath the one it opened.
    const [fromEdit, setFromEdit] = useState(false);
    const open = (next: PlaceSheet) => { setFromEdit(sheet === 'edit'); onSheet(next); };
    const closeChild = () => onSheet(fromEdit ? 'edit' : null);
    const done = () => { setFromEdit(false); onSheet(null); };
    const child = sheet !== null && sheet !== 'edit' ? sheet : null;
    const records = detail.factLinks.length;
    const others = sortOtherNames(detail.otherNames ?? []);
    const del = useDeletePlace(detail.id ?? null, placeName, treeId, canUndo);
    const showDelete = canUndo && detail.id != null && detail.uses != null;

    return (
        <>
            <Sheet open={sheet === 'edit' || (child != null && fromEdit)} onClose={() => onSheet(null)} title={t('edit_title', { place: name })}>
                <div className="-mx-4 -mt-3">
                    <MobileRow icon={<Type />} end="chevron" label={t('rename_merge')} sub={t('rename_merge_sub')} onClick={() => open('rename')} />
                    {onAddName && (
                        <MobileRow icon={<Tag />} end="chevron" divided label={t('add_another_name')} onClick={onAddName}
                            sub={others.length ? t('add_name_sub_has', { count: others.length, names: others.slice(0, 2).map((n) => n.name).join(', ') + (others.length > 2 ? '…' : '') }) : t('add_name_sub_none')} />
                    )}
                    {own && <MobileRow icon={<Move />} end="chevron" divided label={t('move_pin')} sub={t('move_pin_sub')} onClick={() => open('move')} />}
                    <MobileRow icon={<Globe />} end="chevron" divided label={own ? t('match_again') : t('find_it')} sub={t('search_map_for', { place: name })} onClick={() => open('match')} />
                    <MobileRow icon={<MapPin />} end="chevron" divided label={t('type_coords')} sub={t('type_coords_sub')} onClick={() => open('coords')} />
                    {detail.id != null && <MobileRow icon={<ArrowLeftRight />} end="chevron" divided label={t('move_records')} sub={t('move_records_sub')} onClick={() => open('records')} />}
                    {showDelete && placeUnused(detail.uses!) && !del.confirming && (
                        <MobileRow icon={<Trash2 />} tone="danger" divided label={tp('delete_place')} onClick={() => del.setConfirming(true)} />
                    )}
                </div>
                {showDelete && placeUnused(detail.uses!) && del.confirming && (
                    <div className="grid gap-3 mt-4">
                        <Banner tone="warning" role="status" className="!text-sm">{tp('delete_place_body')}</Banner>
                        <div className="grid grid-cols-2 gap-2.5">
                            <Button variant="outline" size="lg" onClick={() => del.setConfirming(false)} disabled={del.deleting}>{tp('delete_place_keep')}</Button>
                            <Button variant="danger" size="lg" onClick={() => { void del.remove(done); }} disabled={del.deleting}>{tp('delete_place')}</Button>
                        </div>
                    </div>
                )}
                {showDelete && !placeUnused(detail.uses!) && <PlaceInUseHint place={name} uses={detail.uses!} className="m-0 mt-3" />}
                {child === 'rename' && fromEdit && <RenameSheet placeId={detail.id} placeName={placeName} records={detail.ownNameRecords ?? records} treeId={treeId} canUndo={canUndo} onClose={closeChild} onDone={done} onChanged={onChanged} />}
                {child === 'move' && <MoveSheet detail={detail} placeId={detail.id} placeName={placeName} treeId={treeId} onClose={closeChild} onDone={done} onChanged={onChanged} />}
                {child === 'match' && <MatchSheet placeId={detail.id} placeName={placeName} treeId={treeId} onClose={closeChild} onDone={done} onChanged={onChanged} />}
                {child === 'records' && detail.id != null && <MoveRecordsSheet detail={detail} placeId={detail.id} placeName={placeName} treeId={treeId} canUndo={canUndo} onChanged={onChanged} onClose={closeChild} onDone={done} />}
                {child === 'coords' && <CoordsSheet detail={detail} placeId={detail.id} placeName={placeName} treeId={treeId} onClose={closeChild} onDone={done} onChanged={onChanged} />}
            </Sheet>
            {/* Opened straight from the page (the Details tab, the "Find on the map" row,
                or another place's "Merge X into Y"). */}
            {child === 'rename' && !fromEdit && <RenameSheet placeId={detail.id} placeName={placeName} records={detail.ownNameRecords ?? records} treeId={treeId} canUndo={canUndo}
                start={renameStart ?? undefined} onClose={done} onDone={done} onChanged={onChanged} />}
            {child === 'move' && !fromEdit && <MoveSheet detail={detail} placeId={detail.id} placeName={placeName} treeId={treeId} onClose={done} onDone={done} onChanged={onChanged} />}
            {child === 'match' && !fromEdit && <MatchSheet placeId={detail.id} placeName={placeName} treeId={treeId} onClose={done} onDone={done} onChanged={onChanged} />}
        </>
    );
}

/** Delete a place nothing uses (#1229), then land on Places; Undo brings it back. */
function useDeletePlace(placeId: number | null, placeName: string, treeId: number | null, canUndo: boolean) {
    const tp = useTranslations('places');
    const router = useRouter();
    const { reportError } = useErrorToast();
    const [confirming, setConfirming] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const remove = async (onDone: () => void) => {
        if (placeId == null || deleting) return;
        setDeleting(true);
        let auditIds: number[] = [];
        try {
            ({ auditIds } = await (await getDataClient()).places.remove(placeId, treeId));
        } catch (e) {
            setDeleting(false);
            reportError(e);
            return;
        }
        setDeleting(false);
        setConfirming(false);
        onDone();
        router.push('/places');
        const undo = canUndo && auditIds.length > 0 ? async () => {
            try {
                await (await getDataClient()).audit.revert(auditIds, treeId);
                router.push(placeHref({ id: placeId, name: placeName }));
            } catch (e) { reportError(e); }
        } : undefined;
        showChangeToast({ message: tp('delete_place_done', { place: short(placeName) }), onUndo: undo });
    };
    return { confirming, setConfirming, deleting, remove };
}

interface ChildProps {
    /** The place's id (#1186); edits address it by name when absent. */
    placeId?: number | null;
    placeName: string;
    treeId: number | null;
    onClose: () => void;
    onDone: () => void;
}

/** Rename, or merge into a place that already has the typed name. */
function RenameSheet({ placeId, placeName, records, treeId, canUndo, start, onClose, onDone, onChanged }: ChildProps & {
    /** Records that say the place's own name. */
    records: number;
    canUndo: boolean;
    start?: { to: string; keepOld: boolean };
    onChanged: () => Promise<void>;
}) {
    const t = useTranslations('mobilePlaces');
    const router = useRouter();
    const { reportError } = useErrorToast();
    const ids = useId();
    const [value, setValue] = useState(start?.to ?? placeName);
    const [choice, setChoice] = useState<RenameChoice>({ keepOld: start?.keepOld ?? false, separate: false });
    const [others, setOthers] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        let live = true;
        getDataClient()
            .then((client) => client.places.list(treeId))
            .then((list) => { if (live) setOthers(mergeTargetNames(list, placeName)); })
            .catch(() => { /* without the list a merge reads as a rename until saved */ });
        return () => { live = false; };
    }, [placeName, treeId]);
    const to = value.trim();
    const dirty = to !== '' && to !== placeName;
    const exists = dirty && others.includes(to);
    const merge = exists && !choice.separate;

    const save = async () => {
        if (!dirty || saving) return;
        setSaving(true);
        let auditIds: number[] = [];
        let wasMerge = merge;
        try {
            const client = await getDataClient();
            ({ auditIds, wasMerge } = await client.places.rename(placeId ?? placeName, to, treeId, { keepOldName: choice.keepOld, separate: exists && choice.separate }));
        } catch (e) {
            setSaving(false);
            reportError(e);
            return;
        }
        onDone();
        // A rename keeps the place's id, so the page stays and reloads; a merge lands on
        // the place it merged into, which this sheet only knows by name.
        const renamedInPlace = !wasMerge && placeId != null;
        if (renamedInPlace) void onChanged();
        else router.replace(placeHref({ name: to }));
        const undo = canUndo && auditIds.length > 0 ? async () => {
            try {
                const client = await getDataClient();
                await client.audit.revert(auditIds, treeId);
                if (renamedInPlace) await onChanged();
                else router.replace(placeHref({ id: placeId, name: placeName }));
            } catch (e) { reportError(e); }
        } : undefined;
        showChangeToast({ message: wasMerge ? t('merged') : t('renamed'), detail: `${short(placeName)} → ${short(to)}`, onUndo: undo });
    };

    return (
        <Sheet open onClose={onClose} title={t('rename_merge')} size="full" dirty={dirty} onSave={save}
            saveLabel={merge ? t('merge') : undefined} saveDisabled={saving}>
            <div className="grid gap-1.5 pt-1">
                <label htmlFor={`${ids}-name`} className="text-meta font-semibold text-text-secondary">{t('place_name')}</label>
                <input id={`${ids}-name`} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" maxLength={500}
                    className="w-full h-[46px] rounded-[10px] border border-border bg-surface px-3 text-md text-text input-nozoom focus-ring" />
                <p className="m-0 text-meta leading-snug text-text-muted">{t('rename_hint')}</p>
            </div>
            {dirty && (
                <RenameChoices from={placeName} to={to} target={exists ? to : null} records={records} choice={choice} onChoice={setChoice} disabled={saving} />
            )}
        </Sheet>
    );
}

/** The map full screen with the pin draggable, then Save. */
function MoveSheet({ detail, placeId, placeName, treeId, onClose, onDone, onChanged }: ChildProps & { detail: PlaceDetail; onChanged: () => Promise<void> }) {
    const t = useTranslations('mobilePlaces');
    const { reportError } = useErrorToast();
    const start = { lat: detail.latitude ?? 0, lng: detail.longitude ?? 0 };
    const [point, setPoint] = useState(start);
    const [saving, setSaving] = useState(false);
    const dirty = point.lat !== start.lat || point.lng !== start.lng;
    const save = async () => {
        setSaving(true);
        try {
            const client = await getDataClient();
            await client.places.updateCoordinates(placeId ?? placeName, point.lat, point.lng, treeId);
            await onChanged();
            onDone();
            showChangeToast({ message: t('pin_moved') });
        } catch (e) {
            reportError(e);
        } finally {
            setSaving(false);
        }
    };
    return (
        <Sheet open onClose={onClose} title={t('move_pin')} size="screen" dirty={dirty} onSave={save} saveDisabled={saving}>
            <p className="m-0 pb-2.5 text-meta text-text-muted">{t('move_pin_hint')}</p>
            <div className="-mx-4 overflow-hidden" style={{ background: 'var(--map-well-bg)' }}>
                <LocationMap markers={[{ lat: point.lat, lng: point.lng, label: short(placeName) }]} variant="full" height={420}
                    draggable onMarkerDragEnd={(lat, lng) => setPoint({ lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) })} />
            </div>
            <p className="m-0 pt-2.5 font-mono text-sm text-text-secondary">{point.lat.toFixed(4)}, {point.lng.toFixed(4)}</p>
        </Sheet>
    );
}

/** Search the map for the place and pick the right match. */
function MatchSheet({ placeId, placeName, treeId, onClose, onDone, onChanged }: ChildProps & { onChanged: () => Promise<void> }) {
    const t = useTranslations('mobilePlaces');
    const tp = useTranslations('places');
    const { reportError } = useErrorToast();
    const choice = useGeocodingChoice();
    const [query, setQuery] = useState(placeName);
    const [candidates, setCandidates] = useState<PhotonCandidate[]>([]);
    const [status, setStatus] = useState<'idle' | 'searching' | 'failed' | 'short'>('idle');
    const [busy, setBusy] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abort = useRef<AbortController | null>(null);

    const search = useCallback((raw: string) => {
        abort.current?.abort();
        const q = raw.trim();
        if (!isGeocodingEnabled()) return;
        if (q.length < 3) { setCandidates([]); setStatus('short'); return; }
        const ctrl = new AbortController();
        abort.current = ctrl;
        setStatus('searching');
        fetchCandidates(q, { signal: ctrl.signal })
            .then((results) => { setCandidates(results); setStatus('idle'); })
            .catch((e) => {
                if ((e as Error).name === 'AbortError') return;
                setCandidates([]);
                setStatus('failed');
            });
    }, []);
    // Opening searches the current name at once: what the map thinks it is IS the question.
    useEffect(() => {
        if (choice === 'on') search(placeName);
    }, [choice, placeName, search]);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); abort.current?.abort(); }, []);

    const pick = async (c: PhotonCandidate) => {
        setBusy(true);
        try {
            const client = await getDataClient();
            await client.places.geocodeUpsertHierarchy(chainFromCandidate(c, placeName), treeId, { reparent: true, leafId: placeId });
            await onChanged();
            onDone();
            showChangeToast({ message: t('pin_matched'), detail: c.result.name });
        } catch (e) {
            reportError(e);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Sheet open onClose={onClose} title={t('find_title')} size="full">
            {choice === null ? (
                <GeocodingPrompt onEnabled={() => search(query)} />
            ) : choice === 'off' ? (
                <p className="m-0 py-3 text-base text-text-muted">{tp('rematch_geocoding_off')}</p>
            ) : (
                <>
                    <div className="relative">
                        <Search className="absolute left-[13px] top-[13px] w-[18px] h-[18px] text-text-muted pointer-events-none" aria-hidden="true" />
                        <input type="search" value={query} autoComplete="off" aria-label={tp('rematch_search_placeholder')} placeholder={tp('rematch_search_placeholder')}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                if (timer.current) clearTimeout(timer.current);
                                const v = e.target.value;
                                timer.current = setTimeout(() => search(v), 350);
                            }}
                            className="w-full h-11 rounded-full border border-border bg-surface pl-10 pr-4 text-md text-text placeholder:text-text-muted input-nozoom focus-ring" />
                    </div>
                    <div className="-mx-4 mt-2" aria-live="polite">
                        {status === 'searching' ? <p className="m-0 px-4 py-3 text-base text-text-muted">{tp('rematch_searching')}</p>
                            : status === 'failed' ? <p className="m-0 px-4 py-3 text-base text-text-muted">{tp('rematch_search_failed')}</p>
                            : status === 'short' ? <p className="m-0 px-4 py-3 text-base text-text-muted">{tp('rematch_type_more')}</p>
                            : candidates.length === 0 ? <p className="m-0 px-4 py-3 text-base text-text-muted">{tp('rematch_no_results')}</p>
                            : candidates.map((c, i) => (
                                <MobileRow key={`${c.result.osmType ?? ''}-${c.result.osmId ?? i}`} icon={<MapPin />} end="chevron" divided={i > 0}
                                    label={c.result.name} disabled={busy} onClick={() => { void pick(c); }} />
                            ))}
                    </div>
                </>
            )}
        </Sheet>
    );
}

/** Coordinates typed by hand, for a place the map search can't find. */
function CoordsSheet({ detail, placeId, placeName, treeId, onClose, onDone, onChanged }: ChildProps & { detail: PlaceDetail; onChanged: () => Promise<void> }) {
    const t = useTranslations('mobilePlaces');
    const tp = useTranslations('places');
    const { reportError } = useErrorToast();
    const ids = useId();
    const start = detail.latitude != null && detail.longitude != null ? `${detail.latitude}, ${detail.longitude}` : '';
    const [value, setValue] = useState(start);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const save = async () => {
        const parsed = parseCoords(value);
        if (!parsed) { setError(tp('invalid_coords')); return; }
        setSaving(true);
        try {
            const client = await getDataClient();
            await client.places.updateCoordinates(placeId ?? placeName, parsed.latitude, parsed.longitude, treeId);
            await onChanged();
            onDone();
            showChangeToast({ message: t('coords_saved') });
        } catch (e) {
            reportError(e);
        } finally {
            setSaving(false);
        }
    };
    return (
        <Sheet open onClose={onClose} title={t('type_coords')} size="full" dirty={value.trim() !== start} onSave={save} saveDisabled={saving || !value.trim()}>
            <div className="grid gap-1.5 pt-1">
                <label htmlFor={`${ids}-coords`} className="text-meta font-semibold text-text-secondary">{tp('coordinates')}</label>
                <input id={`${ids}-coords`} value={value} inputMode="decimal" autoComplete="off" placeholder={tp('coords_placeholder')}
                    onChange={(e) => { setValue(e.target.value); setError(null); }} aria-invalid={error ? true : undefined}
                    aria-describedby={`${ids}-help`}
                    className="w-full h-[46px] rounded-[10px] border border-border bg-surface px-3 font-mono text-md text-text input-nozoom focus-ring" />
                <p id={`${ids}-help`} className={error ? 'm-0 text-meta text-error' : 'm-0 text-meta text-text-muted'} role={error ? 'alert' : undefined}>
                    {error ?? tp('coords_help')}
                </p>
            </div>
        </Sheet>
    );
}
