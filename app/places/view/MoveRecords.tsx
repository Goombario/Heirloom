'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/app/components/Modal';
import { Button, DialogActions, DialogHeader, fieldClass, showChangeToast, showSuccessToast } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import { useErrorToast } from '@/app/components/useErrorToast';
import { getDataClient } from '@/lib/data';
import type { PlaceDetail, PlaceMovedRecord } from '@/lib/data/types';
import { foldForSearch } from '@/lib/utils/search-fold';
import { usePlaceFactReason } from '../usePlaceFactReason';

/*
 * "Move records to another place" (#1186). Two places may share a name, and a typed
 * or imported "Paris" links to the most-used one, so some records land on the wrong
 * Paris; a duplicate place can't be folded into its twin by renaming either. This
 * points the chosen facts of this place at another place. Both places stay; Undo
 * reverts the one audit entry. The desktop page opens it as a dialog, the phone page
 * as a sheet.
 */

/** Places listed at once; typing narrows the rest. */
const TARGET_LIMIT = 50;

interface Target {
    id: number;
    name: string;
    /** What tells it apart: "Part of Ontario", else the map's name for it. */
    sub: string | null;
    count: number;
}

/** One fact of this place, once, with everyone it names (a marriage names two). */
interface FactRow {
    key: string;
    record: PlaceMovedRecord;
    names: string[];
    reason: string;
}

const recordKey = (r: PlaceMovedRecord) => `${r.kind}:${r.recordId}`;

/** The tree's other places, for the list to pick from. */
function useTargets(placeId: number, treeId: number | null) {
    const t = useTranslations('places');
    const [targets, setTargets] = useState<Target[] | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let live = true;
        getDataClient()
            .then((client) => client.places.list(treeId))
            .then(({ places, gazetteer }) => {
                if (!live) return;
                const counts = new Map(places.filter((p) => p.id != null).map((p) => [p.id!, p.count]));
                const names = new Map(gazetteer.map((g) => [g.id, g.name]));
                setTargets(gazetteer.filter((g) => g.id !== placeId).map((g) => {
                    const parent = g.parentId != null ? names.get(g.parentId) : undefined;
                    return {
                        id: g.id,
                        name: g.name,
                        sub: parent ? t('move_records_part_of', { place: parent }) : g.displayName,
                        count: counts.get(g.id) ?? 0,
                    };
                }));
            })
            .catch(() => { if (live) setFailed(true); });
        return () => { live = false; };
    }, [placeId, treeId, t]);
    return { targets, failed };
}

/** The facts that point at this place itself, not at a place within it. */
function useFactRows(detail: PlaceDetail, placeId: number): FactRow[] {
    const reason = usePlaceFactReason();
    return useMemo(() => {
        const rows = new Map<string, FactRow>();
        for (const link of detail.factLinks) {
            if (link.placeId !== placeId) continue;
            const record = { kind: link.kind, recordId: link.recordId };
            const key = recordKey(record);
            const row = rows.get(key);
            if (row) row.names.push(link.name);
            else rows.set(key, { key, record, names: [link.name], reason: reason(link) });
        }
        return [...rows.values()];
    }, [detail.factLinks, placeId, reason]);
}

interface MoveState {
    targetId: number | null;
    /** Facts the user unticked; every fact is ticked to begin with. */
    skipped: Set<string>;
}

/** The two choices: which place, and which records. Shared by the dialog and the sheet. */
function MoveRecordsFields({ placeName, targets, failed, rows, state, onState }: {
    placeName: string;
    targets: Target[] | null;
    failed: boolean;
    rows: FactRow[];
    state: MoveState;
    onState: (next: MoveState) => void;
}) {
    const t = useTranslations('places');
    const ids = useId();
    const [query, setQuery] = useState('');

    // Same-name places first (the other Paris), then the most-used.
    const shown = useMemo(() => {
        if (!targets) return [];
        const q = foldForSearch(query.trim());
        const same = foldForSearch(placeName);
        return targets
            .filter((p) => !q || foldForSearch(p.name).includes(q))
            .sort((a, b) => Number(foldForSearch(b.name) === same) - Number(foldForSearch(a.name) === same) || b.count - a.count || a.name.localeCompare(b.name))
            .slice(0, TARGET_LIMIT);
    }, [targets, query, placeName]);
    const allTicked = state.skipped.size === 0;

    const toggle = (key: string) => {
        const skipped = new Set(state.skipped);
        if (skipped.has(key)) skipped.delete(key); else skipped.add(key);
        onState({ ...state, skipped });
    };

    return (
        <div className="grid gap-5">
            <fieldset className="grid gap-2 min-w-0">
                <legend className="text-sm font-semibold text-text-secondary mb-1">{t('move_records_to')}</legend>
                <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('move_records_search')}
                    aria-label={t('move_records_search')}
                    aria-controls={`${ids}-places`}
                    autoComplete="off"
                    className={fieldClass()}
                />
                <div id={`${ids}-places`} className="max-h-64 overflow-y-auto rounded-lg border border-border">
                    {failed ? (
                        <p className="m-0 p-3 text-sm text-error">{t('move_records_load_failed')}</p>
                    ) : !targets ? (
                        <p className="m-0 p-3 text-sm text-text-muted">{t('move_records_loading')}</p>
                    ) : shown.length === 0 ? (
                        <p className="m-0 p-3 text-sm text-text-muted">{t('move_records_none_found')}</p>
                    ) : shown.map((p) => (
                        <label key={p.id} className="flex items-start gap-3 px-3 py-2.5 min-h-[44px] cursor-pointer border-b border-border-light last:border-0 hover:bg-[color:var(--color-hover-surface)] has-[:checked]:bg-surface">
                            <input
                                type="radio"
                                name={`${ids}-target`}
                                checked={state.targetId === p.id}
                                onChange={() => onState({ ...state, targetId: p.id })}
                                className="mt-1 accent-[color:var(--color-primary)]"
                            />
                            <span className="grid flex-1 min-w-0">
                                <span className="serif text-base text-text truncate">{p.name}</span>
                                {p.sub && <span className="text-meta text-text-muted truncate">{p.sub}</span>}
                            </span>
                            <span className="text-meta text-text-muted tabular-nums shrink-0 mt-0.5">{t('move_records_count', { count: p.count })}</span>
                        </label>
                    ))}
                </div>
            </fieldset>

            <fieldset className="grid gap-2 min-w-0">
                <legend className="text-sm font-semibold text-text-secondary mb-1">{t('move_records_which')}</legend>
                {rows.length === 0 ? (
                    <p className="m-0 text-sm text-text-muted">{t('move_records_all_hint')}</p>
                ) : (
                    <div className="rounded-lg border border-border">
                        <label className="flex items-center gap-3 px-3 py-2.5 min-h-[44px] cursor-pointer border-b border-border-light">
                            <input
                                type="checkbox"
                                checked={allTicked}
                                onChange={() => onState({ ...state, skipped: allTicked ? new Set(rows.map((r) => r.key)) : new Set() })}
                                className="accent-[color:var(--color-primary)]"
                            />
                            <span className="text-sm font-medium text-text">{t('move_records_all', { count: rows.length })}</span>
                        </label>
                        <div className="max-h-56 overflow-y-auto">
                            {rows.map((r) => (
                                <label key={r.key} className="flex items-start gap-3 px-3 py-2 min-h-[44px] cursor-pointer border-b border-border-light last:border-0">
                                    <input
                                        type="checkbox"
                                        checked={!state.skipped.has(r.key)}
                                        onChange={() => toggle(r.key)}
                                        className="mt-1 accent-[color:var(--color-primary)]"
                                    />
                                    <span className="grid min-w-0">
                                        <span className="text-sm text-text truncate">{r.names.join(' & ')}</span>
                                        <span className="text-meta text-text-muted">{r.reason}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                )}
            </fieldset>
        </div>
    );
}

/** State, the list and the save, for either wrapper. */
function useMoveRecords({ detail, placeId, treeId, canUndo, onChanged, toast }: {
    detail: PlaceDetail;
    placeId: number;
    treeId: number | null;
    canUndo: boolean;
    onChanged: () => Promise<void>;
    toast: 'desktop' | 'phone';
}) {
    const t = useTranslations('places');
    const tc = useTranslations('common');
    const { reportError } = useErrorToast();
    const { targets, failed } = useTargets(placeId, treeId);
    const rows = useFactRows(detail, placeId);
    const [state, setState] = useState<MoveState>({ targetId: null, skipped: new Set() });
    const [saving, setSaving] = useState(false);
    const picked = rows.length - rows.filter((r) => state.skipped.has(r.key)).length;
    const ready = state.targetId != null && (rows.length === 0 || picked > 0) && !saving;

    const save = async (): Promise<boolean> => {
        if (!ready || state.targetId == null) return false;
        const target = targets?.find((p) => p.id === state.targetId);
        setSaving(true);
        try {
            const client = await getDataClient();
            // Everything ticked moves the whole place, so facts the list can't show
            // (an event of a family, say) go too.
            const records = state.skipped.size === 0 ? undefined : rows.filter((r) => !state.skipped.has(r.key)).map((r) => r.record);
            const { moved, auditIds } = await client.places.moveRecords(placeId, state.targetId, records, treeId);
            await onChanged();
            const message = t('move_records_done', { count: moved, place: target?.name ?? '' });
            const undo = canUndo && auditIds.length > 0 ? async () => {
                try {
                    const undoClient = await getDataClient();
                    await undoClient.audit.revert(auditIds, treeId);
                    await onChanged();
                } catch (e) { reportError(e); }
            } : undefined;
            if (toast === 'phone') showChangeToast({ message, onUndo: undo });
            else showSuccessToast(message, undo ? { label: tc('undo'), onClick: () => { void undo(); } } : undefined);
            return true;
        } catch (e) {
            reportError(e);
            return false;
        } finally {
            setSaving(false);
        }
    };

    return { targets, failed, rows, state, setState, saving, ready, picked, save };
}

interface MoveRecordsProps {
    detail: PlaceDetail;
    placeId: number;
    placeName: string;
    treeId: number | null;
    canUndo: boolean;
    onChanged: () => Promise<void>;
    onClose: () => void;
}

/** The desktop dialog. Mounted only while open, so each opening starts fresh. */
export function MoveRecordsDialog({ onClose, ...props }: MoveRecordsProps) {
    const t = useTranslations('places');
    const tc = useTranslations('common');
    const titleId = useId();
    const move = useMoveRecords({ ...props, toast: 'desktop' });
    const short = props.placeName.split(',')[0]?.trim() || props.placeName;

    return (
        <Modal open onClose={onClose} size="md" disableClose={move.saving} labelledBy={titleId}>
            <form
                className="bg-card rounded-2xl shadow-xl overflow-hidden"
                onSubmit={async (e) => { e.preventDefault(); if (await move.save()) onClose(); }}
            >
                <div className="p-5">
                    <DialogHeader
                        title={t('move_records_title')}
                        titleId={titleId}
                        subtitle={t('move_records_intro', { place: short })}
                        onClose={onClose}
                        closeDisabled={move.saving}
                        className="mb-4"
                    />
                    <MoveRecordsFields placeName={props.placeName} targets={move.targets} failed={move.failed} rows={move.rows} state={move.state} onState={move.setState} />
                </div>
                <DialogActions>
                    <Button type="button" variant="outline" onClick={onClose} disabled={move.saving}>{tc('cancel')}</Button>
                    <Button type="submit" variant="primary" disabled={!move.ready}>
                        {move.rows.length === 0 ? t('move_records_confirm_all') : t('move_records_confirm', { count: move.picked })}
                    </Button>
                </DialogActions>
            </form>
        </Modal>
    );
}

/** The phone sheet, opened from the place's edit sheet. */
export function MoveRecordsSheet({ onClose, onDone, ...props }: MoveRecordsProps & { onDone: () => void }) {
    const t = useTranslations('places');
    const move = useMoveRecords({ ...props, toast: 'phone' });
    const short = props.placeName.split(',')[0]?.trim() || props.placeName;

    return (
        <Sheet
            open
            onClose={onClose}
            title={t('move_records_title')}
            size="full"
            dirty={move.state.targetId != null}
            onSave={async () => { if (await move.save()) onDone(); }}
            saveLabel={t('move_records_save')}
            saveDisabled={!move.ready}
        >
            <p className="m-0 mb-4 text-sm text-text-muted">{t('move_records_intro', { place: short })}</p>
            <MoveRecordsFields placeName={props.placeName} targets={move.targets} failed={move.failed} rows={move.rows} state={move.state} onState={move.setState} />
        </Sheet>
    );
}
