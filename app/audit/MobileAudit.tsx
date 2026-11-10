'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AuditLogEntryWithUser } from '@/lib/db/schema';
import type { AuditEditor } from '@/lib/data/types';
import { ArrowUpRight, Package, Pencil, Plus, RotateCcw, Trash2 } from '@/lib/icons';
import {
    EmptyState, InlineDataError, MobileListDivider, MobileListFilters, MobileListHeader, MobileListMeta, MobileListPager,
    MobileListToggleChip, MobileRow, PageShell, RadioRow, SortSheet, cx,
} from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { SkeletonList } from '@/app/components/SkeletonLoader';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import { ENTITY_TYPES, type AuditFilters } from './AuditFilterBar';
import type { AuditRecordText } from './useAuditRecord';

/** One changed field: an update's old and new, or a created or deleted record's value. */
interface AuditChangeRow { key: string; label: string; old?: React.ReactNode; new?: React.ReactNode }

const ACTIONS = ['create', 'update', 'delete'] as const;

function isoOffset(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The phone audit log (#1122). The people-list standard: the record filter and four
 * chips (Type, Action, Who, Date), each with its own small sheet; the count and a Sort
 * by sheet; dividers that follow the sort. Every entry is the same row: an action tile,
 * the record with the time, "Updated person · Who", then one summary line. The diff
 * has no red or green, and Revert lives in the entry's sheet behind a confirm.
 */
export function MobileAudit(p: {
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    entries: AuditLogEntryWithUser[];
    total: number;
    page: number;
    pages: number;
    onPage: (page: number) => void;
    filters: AuditFilters;
    onPatch: (patch: Partial<AuditFilters>) => void;
    onSort: (sort: string, dir: 'asc' | 'desc') => void;
    editors: AuditEditor[];
    showWho: boolean;
    canEdit: boolean;
    reverting: boolean;
    isRevertible: (e: AuditLogEntryWithUser) => boolean;
    onRevert: (id: number) => void;
    /** The record the change belongs to (#930): its name, the item that changed, and its page. */
    record: (e: AuditLogEntryWithUser) => AuditRecordText;
    changes: (e: AuditLogEntryWithUser) => AuditChangeRow[];
    /** A one-line summary ("Born 1920 · Female", "Renamed Dover → Dover, Kent"), when there is one. */
    summary: (e: AuditLogEntryWithUser) => string | null;
}) {
    const t = useTranslations('audit');
    const tm = useTranslations('mobileAudit');
    const tc = useTranslations('common');
    const { timestamp } = useTimestamp();
    const [sheet, setSheet] = useState<'type' | 'action' | 'who' | 'date' | 'sort' | null>(null);
    const [openId, setOpenId] = useState<number | null>(null);
    const [confirmId, setConfirmId] = useState<number | null>(null);
    const { filters, onPatch } = p;

    const actionWord = (a: string) => t(a === 'create' ? 'action_created' : a === 'delete' ? 'action_deleted' : 'action_updated');
    const whoName = (e: AuditLogEntryWithUser) => e.UserName || (e.UserEmail ?? t('unknown_user'));
    const today = isoOffset(0);
    const last7 = isoOffset(6);
    const last30 = isoOffset(29);
    const dateMode = !filters.dateFrom ? '' : filters.dateFrom === today ? 'today' : filters.dateFrom === last7 ? 'last7' : filters.dateFrom === last30 ? 'last30' : 'custom';
    const dateLabels: Record<string, string> = { today: t('date_today'), last7: t('date_last_7_days'), last30: tm('date_last_30_days'), custom: t('filter_date') };
    const editorName = filters.who == null ? null : (p.editors.find((ed) => ed.userId === filters.who)?.name ?? t('unknown_user'));
    const anyFilter = !!(filters.entityType || filters.action || filters.who != null || filters.dateFrom);
    const clearAll = () => onPatch({ entityType: '', action: '', who: null, dateFrom: undefined, dateTo: undefined, search: '' });

    const sortColumns = [
        { key: 'when', label: t('col_when'), orders: [tm('oldest_first'), tm('newest_first')] as [string, string] },
        ...(p.showWho ? [{ key: 'who', label: t('col_who'), orders: [tm('a_z'), tm('z_a')] as [string, string] }] : []),
        { key: 'action', label: t('col_action'), orders: [tm('a_z'), tm('z_a')] as [string, string] },
        { key: 'record', label: t('col_record'), orders: [tm('a_z'), tm('z_a')] as [string, string] },
        { key: 'type', label: t('col_type'), orders: [tm('a_z'), tm('z_a')] as [string, string] },
    ];
    const column = sortColumns.find((c) => c.key === filters.sort) ?? sortColumns[0];
    const ascending = filters.dir === 'asc';

    const divider = (e: AuditLogEntryWithUser): string => {
        switch (filters.sort) {
            case 'who': return whoName(e);
            case 'action': return actionWord(e.Action);
            case 'type': return t('filter_' + e.EntityType);
            case 'record': return (p.record(e).name.trim()[0] ?? '#').toUpperCase();
            default: return timestamp(e.CreatedAt, 'date');
        }
    };

    const open = p.entries.find((e) => e.Id === openId) ?? null;
    const confirming = p.entries.find((e) => e.Id === confirmId) ?? null;

    const heads = p.entries.map((e, i) => i === 0 || divider(e) !== divider(p.entries[i - 1]));
    return (
        <PageShell topBar={<MobileListHeader title={t('title')} />} contentClassName="max-md:p-0!" busy={p.loading}>
            <MobileListFilters value={filters.search} onChange={(search) => onPatch({ search })} placeholder={tm('filter_record')}>
                <MobileListToggleChip label={filters.entityType ? tm('chip_named', { chip: t('col_type'), value: t('filter_' + filters.entityType) }) : t('col_type')}
                    on={!!filters.entityType} clearLabel={tc('clear_filter_named', { name: t('col_type') })}
                    onTap={() => (filters.entityType ? onPatch({ entityType: '' }) : setSheet('type'))} onClear={() => onPatch({ entityType: '' })} />
                <MobileListToggleChip label={filters.action ? tm('chip_named', { chip: t('col_action'), value: actionWord(filters.action) }) : t('col_action')}
                    on={!!filters.action} clearLabel={tc('clear_filter_named', { name: t('col_action') })}
                    onTap={() => (filters.action ? onPatch({ action: '' }) : setSheet('action'))} onClear={() => onPatch({ action: '' })} />
                {p.showWho && (
                    <MobileListToggleChip label={editorName ? tm('chip_named', { chip: t('col_who'), value: editorName }) : t('col_who')}
                        on={filters.who != null} clearLabel={tc('clear_filter_named', { name: t('col_who') })}
                        onTap={() => (filters.who != null ? onPatch({ who: null }) : setSheet('who'))} onClear={() => onPatch({ who: null })} />
                )}
                <MobileListToggleChip label={dateMode ? dateLabels[dateMode] : t('filter_date')}
                    on={!!dateMode} clearLabel={tc('clear_filter_named', { name: t('filter_date') })}
                    onTap={() => (dateMode ? onPatch({ dateFrom: undefined, dateTo: undefined }) : setSheet('date'))}
                    onClear={() => onPatch({ dateFrom: undefined, dateTo: undefined })} />
                {anyFilter && (
                    <button type="button" onClick={clearAll}
                        className="relative shrink-0 h-[34px] px-3 text-sm font-semibold text-link cursor-pointer rounded-full focus-ring before:absolute before:-inset-y-[5px] before:inset-x-0 before:content-['']">
                        {t('clear_all')}
                    </button>
                )}
            </MobileListFilters>

            {p.error && <div className="px-4 pt-3"><InlineDataError message={p.error} retryLabel={tc('retry')} onRetry={p.onRetry} /></div>}

            {p.loading && p.entries.length === 0 ? (
                <div className="pt-4" data-testid="audit-skeleton"><SkeletonList rows={8} /></div>
            ) : p.entries.length === 0 ? (
                p.error ? null : anyFilter || filters.search
                    ? <EmptyState variant="filtered" message={t('no_matches')} clearLabel={tc('clear_filters')} onClear={clearAll} />
                    : <EmptyState variant="empty" title={t('empty_title')} message={t('no_entries')} />
            ) : (
                <>
                    <MobileListMeta count={t('entry_count', { count: p.total })}
                        sortLabel={`${column.label} · ${ascending ? column.orders[0] : column.orders[1]}`} onSort={() => setSheet('sort')} />
                    <ul className="m-0 p-0 list-none">
                        {p.entries.map((e, i) => {
                            const head = heads[i];
                            const rows = p.changes(e);
                            const first = rows[0];
                            const line = p.summary(e) ?? (e.Action === 'update'
                                ? (rows.length === 1 && first
                                    ? <><span className="text-text-muted">{first.label}</span>{' '}<Diff old={first.old} next={first.new} /></>
                                    : rows.length > 1
                                        ? <><span className="text-text-muted">{tm('n_fields', { count: rows.length })}</span>{' '}{rows.map((r) => r.label).join(', ')}</>
                                        : <span className="text-text-muted">{t('details_updated')}</span>)
                                : null);
                            const Icon = e.EntityType === 'import' ? Package : e.Action === 'create' ? Plus : e.Action === 'delete' ? Trash2 : Pencil;
                            const time = filters.sort === 'when' ? timestamp(e.CreatedAt, 'time') : `${timestamp(e.CreatedAt, 'date')} ${timestamp(e.CreatedAt, 'time')}`;
                            return (
                                <li key={e.Id}>
                                    {head && <MobileListDivider>{divider(e)}</MobileListDivider>}
                                    <button type="button" onClick={() => setOpenId(e.Id)} aria-haspopup="dialog"
                                        className={cx('flex w-full items-start gap-3 min-h-20 px-4 py-3 text-left cursor-pointer active:bg-surface-2 focus-ring-inset', !head && 'border-t border-border')}>
                                        <span aria-hidden="true" className="grid place-items-center w-[34px] h-[34px] mt-px shrink-0 rounded-[10px] bg-surface-2 text-text">
                                            <Icon className="w-[17px] h-[17px]" />
                                        </span>
                                        <span className="flex-1 min-w-0 grid gap-[3px]">
                                            <span className="flex items-baseline gap-2.5 min-w-0">
                                                <span className="flex-1 min-w-0 text-base leading-snug text-text-secondary">{p.record(e).node(false)}</span>
                                                <span className="shrink-0 text-meta text-text-muted tabular-nums">{time}</span>
                                            </span>
                                            <span className="text-meta text-text-muted truncate">
                                                {tm('row_kind', { action: actionWord(e.Action), type: t('filter_' + e.EntityType).toLowerCase() })}
                                                {p.showWho && <> · {whoName(e)}</>}
                                            </span>
                                            {line && <span className="text-meta text-text-secondary truncate">{line}</span>}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    <MobileListPager page={p.page} pages={p.pages} onPage={p.onPage} />
                </>
            )}
            <div className="h-8" aria-hidden="true" />

            <PickSheet open={sheet === 'type'} title={t('col_type')} onClose={() => setSheet(null)}
                options={ENTITY_TYPES.map((v) => ({ value: v, label: v ? t('filter_' + v) : t('filter_all') }))}
                value={filters.entityType} onPick={(entityType) => onPatch({ entityType })} />
            <PickSheet open={sheet === 'action'} title={t('col_action')} onClose={() => setSheet(null)}
                options={[{ value: '', label: t('action_all') }, ...ACTIONS.map((a) => ({ value: a, label: actionWord(a) }))]}
                value={filters.action} onPick={(action) => onPatch({ action })} />
            <PickSheet open={sheet === 'who'} title={t('col_who')} onClose={() => setSheet(null)}
                options={[{ value: '', label: t('who_everyone') }, ...p.editors.map((ed) => ({ value: String(ed.userId), label: ed.name }))]}
                value={filters.who == null ? '' : String(filters.who)} onPick={(v) => onPatch({ who: v ? Number(v) : null })} />
            <PickSheet open={sheet === 'date'} title={t('filter_date')} onClose={() => setSheet(null)}
                options={[{ value: '', label: t('date_any') }, { value: 'today', label: t('date_today') }, { value: 'last7', label: t('date_last_7_days') }, { value: 'last30', label: tm('date_last_30_days') }]}
                value={dateMode === 'custom' ? '' : dateMode}
                onPick={(v) => onPatch(v === 'today' ? { dateFrom: today, dateTo: today } : v === 'last7' ? { dateFrom: last7, dateTo: today } : v === 'last30' ? { dateFrom: last30, dateTo: today } : { dateFrom: undefined, dateTo: undefined })} />
            <SortSheet open={sheet === 'sort'} onClose={() => setSheet(null)} title={tm('sort_by')} columns={sortColumns}
                column={column.key} ascending={ascending} onChange={(c, asc) => p.onSort(c, asc ? 'asc' : 'desc')} />

            <Sheet open={open != null} onClose={() => setOpenId(null)} title={open ? tm('row_kind', { action: actionWord(open.Action), type: t('filter_' + open.EntityType).toLowerCase() }) : ''}>
                {open && <EntryBody entry={open} rows={p.changes(open)} summary={p.summary(open)} record={p.record(open)}
                    who={p.showWho ? whoName(open) : null} when={`${timestamp(open.CreatedAt, 'date')} · ${timestamp(open.CreatedAt, 'time')}`}
                    canRevert={p.canEdit && p.isRevertible(open)} revertible={p.isRevertible(open)} reverting={p.reverting}
                    onRevert={() => { setConfirmId(open.Id); setOpenId(null); }} />}
            </Sheet>
            <ConfirmSheet open={confirming != null} title={tm('revert_title')} confirmLabel={t('revert')} keepLabel={tm('keep')} busy={p.reverting}
                body={confirming ? tm(confirming.Action === 'create' ? 'revert_body_create' : confirming.Action === 'delete' ? 'revert_body_delete' : 'revert_body_update', { record: p.record(confirming).name }) : ''}
                onConfirm={() => { if (confirmId != null) p.onRevert(confirmId); setConfirmId(null); }} onClose={() => setConfirmId(null)} />
        </PageShell>
    );
}

/** Old struck through and muted, new in ink: no red or green. */
function Diff({ old, next }: { old?: React.ReactNode; next?: React.ReactNode }) {
    return (
        <>
            {old != null && old !== '' && <s className="text-text-muted">{old}</s>}
            {old != null && old !== '' && next != null && next !== '' && ' → '}
            {next != null && next !== '' && <span className="text-text font-medium">{next}</span>}
        </>
    );
}

function EntryBody({ entry, rows, summary, record, who, when, canRevert, revertible, reverting, onRevert }: {
    entry: AuditLogEntryWithUser; rows: AuditChangeRow[]; summary: string | null; record: AuditRecordText;
    who: string | null; when: string; canRevert: boolean; revertible: boolean; reverting: boolean; onRevert: () => void;
}) {
    const t = useTranslations('audit');
    const tm = useTranslations('mobileAudit');
    const href = record.href;
    return (
        <div className="-mx-4 -mt-3">
            <div className="eyebrow px-4 pt-3.5 pb-1.5 normal-case tracking-normal text-sm font-normal text-text-secondary">{record.node(true)}</div>
            {who && <Fact label={t('col_who')} value={who} first />}
            <Fact label={t('col_when')} value={<span className="text-sm tabular-nums">{when}</span>} first={!who} />
            {summary && <p className="m-0 px-4 pt-2 text-sm text-text-secondary">{summary}</p>}
            {rows.length > 0 && (
                <>
                    <div className="eyebrow flex justify-between px-4 pt-4 pb-1.5">{tm('changes')}<span className="font-mono normal-case tracking-normal">{rows.length}</span></div>
                    {rows.map((r, i) => (
                        <div key={r.key} className={cx('grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm', i > 0 && 'border-t border-border')}>
                            <span className="text-text-muted">{r.label}</span>
                            <span className="grid gap-px min-w-0 [overflow-wrap:anywhere]">
                                {entry.Action === 'update'
                                    ? <>{r.old != null && r.old !== '' && <s className="text-text-muted">{r.old}</s>}{r.new != null && r.new !== '' && <span className="text-text font-medium">{r.new}</span>}</>
                                    : <span className="text-text">{entry.Action === 'delete' ? r.old : r.new}</span>}
                            </span>
                        </div>
                    ))}
                </>
            )}
            {(href || canRevert) && (
                <div className="mt-3 border-t border-border">
                    {href && <MobileRow icon={<ArrowUpRight className="w-[18px] h-[18px]" aria-hidden="true" />} label={tm('open_record')} end="leave" href={href} />}
                    {canRevert && (
                        <MobileRow divided={!!href} icon={<RotateCcw className="w-[18px] h-[18px]" aria-hidden="true" />} label={tm('revert_change')}
                            sub={tm('revert_hint')} disabled={reverting} onClick={onRevert} />
                    )}
                </div>
            )}
            {!revertible && <p className="m-0 px-4 pt-3 text-meta text-text-muted">{tm('not_revertible')}</p>}
        </div>
    );
}

function Fact({ label, value, first = false }: { label: string; value: React.ReactNode; first?: boolean }) {
    return (
        <div className={cx('flex justify-between gap-3 px-4 py-[11px] text-base', !first && 'border-t border-border')}>
            <span className="text-text-muted">{label}</span><span className="text-right min-w-0">{value}</span>
        </div>
    );
}

function PickSheet({ open, title, onClose, options, value, onPick }: {
    open: boolean; title: string; onClose: () => void; options: { value: string; label: string }[]; value: string; onPick: (value: string) => void;
}) {
    return (
        <Sheet open={open} onClose={onClose} title={title}>
            <div role="radiogroup" aria-label={title} className="-mx-4 -mt-3">
                {options.map((o, i) => (
                    <RadioRow key={o.value || 'all'} checked={o.value === value} label={o.label} divided={i > 0} onSelect={() => { onPick(o.value); onClose(); }} />
                ))}
            </div>
        </Sheet>
    );
}
