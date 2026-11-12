'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTree } from '@/app/contexts/TreeContext';
import { useTranslations } from 'next-intl';
import { Button, Badge, Card, CoverBand, DataTable, EmptyState, InlineDataError, PageShell, TablePanel, showChangeToast, type Column } from '@/app/components/ui';
import type { AuditLogEntryWithUser, AuditFieldChanges, AuditSnapshotChanges } from '@/lib/db/schema';
import type { AuditEditor } from '@/lib/data/types';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import { getDataClient, DATA_MODE } from '@/lib/data';
import { errorToastKey } from '@/lib/utils/data-error';
import { useErrorToast } from '@/app/components/useErrorToast';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import { RotateCcw, UserRound } from '@/lib/icons';
import PersonAvatar from '@/app/components/PersonAvatar';
import { summarizeAuditEntry } from '@/lib/utils/audit-summary';
import { AuditFilterBar, type AuditFilters } from './AuditFilterBar';
import { SkeletonList } from '@/app/components/SkeletonLoader';
import { useAuditFieldFormat, EMPTY_AUDIT_REFS } from './useAuditFieldFormat';
import { useAuditRecord, useAuditDescription, EMPTY_AUDIT_RECORDS } from './useAuditRecord';
import type { AuditFieldSpec } from '@/lib/utils/audit-fields';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { MobileAudit } from './MobileAudit';

/**
 * A 'place' revert trail marker records that a rename, merge or geocode edit was
 * undone. It carries `snapshot.revertOf`, so — unlike the original entry — it is
 * not itself revertable and should not offer a revert button.
 */
function isPlaceRevertMarker(e: AuditLogEntryWithUser): boolean {
    if (e.EntityType !== 'place') return false;
    const snapshot = (e.Changes as Partial<AuditSnapshotChanges>).snapshot as { revertOf?: unknown } | undefined;
    return snapshot?.revertOf != null;
}

function isCanonicalMediaSummary(e: AuditLogEntryWithUser): boolean {
    const summary = (e.Changes as { summary?: { kind?: unknown } } | null)?.summary;
    return e.EntityType === 'media'
        && e.Action === 'update'
        && (summary?.kind === 'canonical_primary' || summary?.kind === 'canonical_ownership');
}

/**
 * A journal entry's edit or delete from before entries became append-only (#1227):
 * reverting would change the entry again (ADR 0042), so only its strikes revert (#1251).
 */
function isFixedJournalChange(e: AuditLogEntryWithUser): boolean {
    if (e.EntityType !== 'casenote') return false;
    const snapshot = (e.Changes as Partial<AuditSnapshotChanges>).snapshot as { struck?: unknown } | undefined;
    return typeof snapshot?.struck !== 'boolean';
}

/**
 * 'import' summaries are informational only. A 'datacheck' confirmation is
 * reopened (or confirmed again) from the Data checks page, not reverted here (#830).
 */
function isAuditEntryRevertible(e: AuditLogEntryWithUser): boolean {
    return e.EntityType !== 'import' && e.EntityType !== 'datacheck' && !isPlaceRevertMarker(e) && !isCanonicalMediaSummary(e)
        && !isFixedJournalChange(e);
}

const INITIAL_FILTERS: AuditFilters = {
    entityType: '',
    action: '',
    who: null,
    dateFrom: undefined,
    dateTo: undefined,
    search: '',
    sort: 'when',
    dir: 'desc',
};

export default function AuditPage() {
    const { activeTreeId, activePermission, currentUserId } = useTree();
    const treeKey = activeTreeId == null ? 'default' : String(activeTreeId);
    const [entries, setEntries] = useState<AuditLogEntryWithUser[]>([]);
    const [refs, setRefs] = useState(EMPTY_AUDIT_REFS);
    const [records, setRecords] = useState(EMPTY_AUDIT_RECORDS);
    const [total, setTotal] = useState(0);
    const [entriesTreeKey, setEntriesTreeKey] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(50);
    const [filters, setFilters] = useState<AuditFilters>(INITIAL_FILTERS);
    const [editors, setEditors] = useState<AuditEditor[]>([]);
    const [editorsTreeKey, setEditorsTreeKey] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [loading, setLoading] = useState(true);
    const [reverting, setReverting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [errorTreeKey, setErrorTreeKey] = useState<string | null>(null);
    const [confirmRevert, setConfirmRevert] = useState<number[] | null>(null);
    const requestIdRef = useRef(0);
    const { reportError, redirectIfUnauthorized } = useErrorToast();
    const isMobile = useIsMobile();

    const anyFilter = filters.entityType !== '' || filters.action !== '' || filters.who != null || !!filters.dateFrom || filters.search !== '';

    const canEdit = activePermission === 'owner' || activePermission === 'edit';
    const currentEntries = useMemo(() => entriesTreeKey === treeKey ? entries : [], [entriesTreeKey, treeKey, entries]);
    const currentTotal = entriesTreeKey === treeKey ? total : 0;
    const currentEditors = editorsTreeKey === treeKey ? editors : [];
    const currentSelectedIds = entriesTreeKey === treeKey ? selectedIds : new Set<number>();
    const currentError = errorTreeKey === treeKey ? error : null;
    const totalPages = Math.ceil(currentTotal / pageSize);
    const t = useTranslations('audit');
    const tChecks = useTranslations('dataChecks');
    const tCommon = useTranslations('common');
    const tMobile = useTranslations('mobileAudit');
    const tCases = useTranslations('cases');
    const tNav = useTranslations('nav');
    const tEventTypes = useTranslations('eventTypes');
    // A case's Status is a stored code; readers see the Cases status names (#701).
    const caseStatusLabel = useCallback(
        (code: string) => (tCases.has(`status_${code}`) ? tCases(`status_${code}`) : code),
        [tCases],
    );
    const fieldFormat = useAuditFieldFormat(refs);
    const recordText = useAuditRecord(records);
    const describe = useAuditDescription();
    /**
     * The fields a reader can make sense of, labelled (#551). Internal columns
     * are dropped, and a crop or tag region's four numbers become one row.
     */
    const readableFields = (entityType: string, fields: string[]) => {
        const seen = new Set<string>();
        const rows: { field: string; spec: AuditFieldSpec }[] = [];
        for (const field of fields) {
            const spec = fieldFormat.spec(entityType, field);
            if (!spec || (spec.kind === 'opaque' && seen.has(spec.label))) continue;
            seen.add(spec.label);
            rows.push({ field, spec });
        }
        return rows;
    };
    const { timestamp } = useTimestamp();

    const summaryLabels = useMemo(() => ({
        photoAdded: t('summary_photo_added'),
        sexPrefix: t('summary_sex'),
        bornPrefix: t('summary_born'),
        diedPrefix: t('summary_died'),
        statusPrefix: t('summary_status'),
        caseStatus: caseStatusLabel,
        eventType: (code: string) => (tEventTypes.has(code) ? tEventTypes(code) : code),
        dataCheck: (action: 'create' | 'delete', rule: string, threshold: number | null) => {
            const key = `rule_${rule}`;
            const check = tChecks.has(key) ? tChecks(key, { threshold: threshold ?? 0 }) : rule;
            return t(action === 'create' ? 'summary_check_confirmed' : 'summary_check_reopened', { check });
        },
    }), [t, tChecks, tEventTypes, caseStatusLabel]);

    const fetchAuditLog = useCallback(async () => {
        if (currentUserId === null) return;
        const requestId = ++requestIdRef.current;
        const isCurrent = () => requestIdRef.current === requestId;
        setLoading(true);
        setError(null);
        setErrorTreeKey(null);
        try {
            const client = await getDataClient();
            if (!isCurrent()) return;
            const data = await client.audit.list({
                page,
                pageSize,
                treeId: activeTreeId,
                entityType: filters.entityType || undefined,
                action: filters.action || undefined,
                who: filters.who ?? undefined,
                dateFrom: filters.dateFrom,
                dateTo: filters.dateTo,
                search: filters.search || undefined,
                sort: filters.sort,
                dir: filters.dir,
            });
            if (!isCurrent()) return;
            setEntries(data.entries || []);
            setRefs(data.refs ?? EMPTY_AUDIT_REFS);
            setRecords(data.records ?? EMPTY_AUDIT_RECORDS);
            setTotal(data.total || 0);
            setEntriesTreeKey(treeKey);
        } catch (err) {
            if (!isCurrent()) return;
            if (redirectIfUnauthorized(err)) return;
            const key = errorToastKey(err);
            setError(key === 'error_generic' ? t('error_generic') : tCommon(key));
            setErrorTreeKey(treeKey);
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, [activeTreeId, currentUserId, page, pageSize, filters, redirectIfUnauthorized, t, tCommon, treeKey]);

    useEffect(() => {
        if (currentUserId !== null) fetchAuditLog();
    }, [currentUserId, fetchAuditLog]);

    useEffect(() => {
        if (currentUserId === null) return;
        let cancelled = false;
        (async () => {
            try {
                const client = await getDataClient();
                const r = await client.audit.users(activeTreeId);
                if (!cancelled) {
                    setEditors(r.users);
                    setEditorsTreeKey(treeKey);
                }
            } catch {
                /* editors are a non-critical enhancement */
            }
        })();
        return () => { cancelled = true; };
    }, [activeTreeId, currentUserId, treeKey]);

    useEffect(() => {
        setSelectedIds(new Set());
        setConfirmRevert(null);
    }, [activeTreeId]);

    useDocumentTitle(t('title'));

    const entryDates = useMemo(() => {
        const s = new Set<string>();
        for (const e of currentEntries) {
            const d = new Date(e.CreatedAt);
            if (!isNaN(d.getTime())) {
                s.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
            }
        }
        return s;
    }, [currentEntries]);

    const patchFilters = (patch: Partial<AuditFilters>) => {
        setFilters(f => ({ ...f, ...patch }));
        setPage(1);
        setSelectedIds(new Set());
    };

    const handleSortChange = (key: string) => {
        setFilters(f => f.sort === key
            ? { ...f, dir: f.dir === 'asc' ? 'desc' : 'asc' }
            : { ...f, sort: key, dir: key === 'when' ? 'desc' : 'asc' });
        setPage(1);
        setSelectedIds(new Set());
    };

    const toggleSelect = (id: string | number) => {
        const entry = currentEntries.find(candidate => candidate.Id === Number(id));
        if (!entry || !isAuditEntryRevertible(entry)) return;
        setSelectedIds(prev => {
            const next = new Set(prev);
            const n = Number(id);
            if (next.has(n)) next.delete(n); else next.add(n);
            return next;
        });
    };

    const toggleSelectAll = () => {
        const eligibleIds = currentEntries.filter(isAuditEntryRevertible).map(e => e.Id);
        setSelectedIds(prev => eligibleIds.every(id => prev.has(id)) ? new Set() : new Set(eligibleIds));
    };

    const handleRevert = async (ids: number[]): Promise<boolean> => {
        setConfirmRevert(null);
        setReverting(true);
        setError(null);
        try {
            const client = await getDataClient();
            await client.audit.revert(ids, activeTreeId);
            setSelectedIds(new Set());
            await fetchAuditLog();
            return true;
        } catch (err) {
            reportError(err);
            return false;
        } finally {
            setReverting(false);
        }
    };

    // Date and time as separate parts: one `toLocaleString` line made the column
    // the widest thing in the table and pushed Record/Changes into a squeeze.
    const formatDateParts = (dateStr: string) => ({
        date: timestamp(dateStr, 'date'),
        time: timestamp(dateStr, 'time'),
    });

    const getActionBadge = (action: string) => {
        switch (action) {
            case 'create': return <Badge tone="green">{t('action_created')}</Badge>;
            case 'update': return <Badge>{t('action_updated')}</Badge>;
            case 'delete': return <Badge tone="red">{t('action_deleted')}</Badge>;
            default: return <Badge>{action}</Badge>;
        }
    };

    // One line naming what changed and whose it is, each name linked to its page (#930).
    const getEntityLink = (entry: AuditLogEntryWithUser) => recordText(entry).node(true);

    const renderChanges = (entry: AuditLogEntryWithUser) => {
        const description = describe(entry);
        if (description) return <div className="text-xs italic" style={{ color: 'var(--text-2)' }}>{description}</div>;
        if (entry.Action === 'update') {
            const changes = entry.Changes as AuditFieldChanges;
            const rows = readableFields(entry.EntityType, Object.keys(changes.fields ?? {}));
            if (rows.length === 0) {
                return <div className="text-xs italic" style={{ color: 'var(--text-2)' }}>{t('details_updated')}</div>;
            }
            return (
                <div className="space-y-1">
                    {rows.map(({ field, spec }) => (
                        <div key={field} className="text-xs" style={{ color: 'var(--text)' }}>
                            <span className="font-medium" style={{ color: 'var(--text-2)' }}>{fieldFormat.label(spec)}</span>
                            {spec.kind === 'opaque' ? (
                                <>
                                    <span style={{ color: 'var(--text-muted)' }}> · </span>
                                    <span>{fieldFormat.value(spec, true)}</span>
                                </>
                            ) : (
                                <>
                                    <span style={{ color: 'var(--text-muted)' }}> · </span>
                                    {/* "Birth date 1846 → 14 Mar 1846": the old value struck, the new one plain (#59). */}
                                    <span className="line-through text-text-muted">{fieldFormat.value(spec, changes.fields[field].old)}</span>
                                    <span style={{ color: 'var(--text-muted)' }}> → </span>
                                    <span className="font-medium text-text">{fieldFormat.value(spec, changes.fields[field].new)}</span>
                                </>
                            )}
                        </div>
                    ))}
                </div>
            );
        }
        // create / delete: one-line summary + expandable full snapshot
        const summary = summarizeAuditEntry(entry, summaryLabels);
        const snapshot = (entry.Changes as AuditSnapshotChanges).snapshot ?? {};
        const displayFields = readableFields(entry.EntityType, Object.keys(snapshot))
            .filter(({ spec }) => spec.kind !== 'opaque')
            .filter(({ field }) => snapshot[field] != null && snapshot[field] !== '');
        return (
            <div className="text-xs" style={{ color: 'var(--text)' }}>
                {summary && <div className={`italic ${displayFields.length ? 'mb-1' : 'mb-0'}`} style={{ color: 'var(--text-2)' }}>{summary}</div>}
                {displayFields.length > 0 && (
                    <details>
                        <summary className="cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                            {entry.Action === 'create' ? t('view_created') : t('view_deleted')}
                        </summary>
                        <div className="mt-1 space-y-0.5 pl-2 border-l-[2px] border-l-[color:var(--border)]">
                            {displayFields.map(({ field, spec }) => (
                                <div key={field}><span className="font-medium">{fieldFormat.label(spec)}:</span> {fieldFormat.value(spec, snapshot[field])}</div>
                            ))}
                        </div>
                    </details>
                )}
            </div>
        );
    };

    // The static build is single-user, so "Who" is the same person on every row.
    // Same flag the rest of the app uses to tell the build flavours apart.
    const showWho = DATA_MODE !== 'local';

    const columns: Column<AuditLogEntryWithUser>[] = [
        {
            key: 'when',
            header: t('col_when'),
            sortable: true,
            className: 'whitespace-nowrap',
            render: (e) => {
                const { date, time } = formatDateParts(e.CreatedAt);
                return (
                    <div className="text-meta tabular-nums leading-[1.35]">
                        <div style={{ color: 'var(--text)' }}>{date}</div>
                        <div style={{ color: 'var(--text-muted)' }}>{time}</div>
                    </div>
                );
            },
        },
        ...(showWho ? [{
            key: 'who',
            header: t('col_who'),
            sortable: true,
            render: (e: AuditLogEntryWithUser) => (
                <span className="inline-flex items-center gap-2">
                    <PersonAvatar as="span" icon={<UserRound size={13} aria-hidden />} size={24} />
                    <span className="text-sm whitespace-nowrap">{e.UserName || (e.UserEmail ?? t('unknown_user'))}</span>
                </span>
            ),
        }] as Column<AuditLogEntryWithUser>[] : []),
        {
            key: 'action',
            header: t('col_action'),
            sortable: true,
            render: (e) => getActionBadge(e.Action),
        },
        {
            // Type was a pill stacked under the record label, which made every row
            // two lines tall and left the type unscannable. Sortable now that
            // SORT_COLUMNS whitelists a."EntityType".
            key: 'type',
            header: t('col_type'),
            sortable: true,
            className: 'whitespace-nowrap',
            render: (e) => (
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('filter_' + e.EntityType)}</span>
            ),
        },
        {
            key: 'record',
            header: t('col_record'),
            sortable: true,
            render: (e) => (
                <div className="min-w-0 text-sm leading-[1.45]" style={{ color: 'var(--text-2)' }}>{getEntityLink(e)}</div>
            ),
        },
        {
            key: 'changes',
            header: t('col_changes'),
            render: (e) => renderChanges(e),
        },
        {
            key: 'revert',
            header: '',
            align: 'right',
            // 'import' summary entries are informational only — not revertable (see auditImport).
            // A 'place' revert trail marker (`snapshot.revertOf`) is likewise not
            // revertable — only the original rename, merge or geocode edit entry is.
            render: (e) => canEdit && isAuditEntryRevertible(e) ? (
                <button
                    type="button"
                    onClick={() => setConfirmRevert([e.Id])}
                    disabled={reverting}
                    className="audit-revert inline-flex items-center gap-1 text-xs py-1 px-[9px] rounded-[8px] border border-[color:var(--border)] cursor-pointer"
                    aria-label={t('revert')}
                    style={{ background: 'var(--card)', color: 'var(--text-muted)' }}
                >
                    <RotateCcw size={12} aria-hidden />{t('revert')}
                </button>
            ) : null,
        },
    ];

    if (isMobile) {
        // The phone's rows read the same formatting the desktop columns do (#1122).
        const changeRows = (e: AuditLogEntryWithUser) => {
            if (e.Action === 'update') {
                const changes = e.Changes as AuditFieldChanges;
                return readableFields(e.EntityType, Object.keys(changes.fields ?? {})).map(({ field, spec }) => spec.kind === 'opaque'
                    ? { key: field, label: fieldFormat.label(spec), new: fieldFormat.value(spec, true) }
                    : { key: field, label: fieldFormat.label(spec), old: fieldFormat.value(spec, changes.fields[field].old), new: fieldFormat.value(spec, changes.fields[field].new) });
            }
            const snapshot = (e.Changes as AuditSnapshotChanges).snapshot ?? {};
            return readableFields(e.EntityType, Object.keys(snapshot))
                .filter(({ spec }) => spec.kind !== 'opaque')
                .filter(({ field }) => snapshot[field] != null && snapshot[field] !== '')
                .map(({ field, spec }) => ({ key: field, label: fieldFormat.label(spec), [e.Action === 'delete' ? 'old' : 'new']: fieldFormat.value(spec, snapshot[field]) }));
        };
        return (
            <MobileAudit
                loading={loading || (entriesTreeKey !== treeKey && !currentError)}
                error={currentError}
                onRetry={fetchAuditLog}
                entries={currentEntries}
                total={currentTotal}
                page={page}
                pages={totalPages}
                onPage={setPage}
                filters={filters}
                onPatch={patchFilters}
                onSort={(sort, dir) => { setFilters(f => ({ ...f, sort, dir })); setPage(1); }}
                editors={currentEditors}
                showWho={showWho}
                canEdit={canEdit}
                reverting={reverting}
                isRevertible={isAuditEntryRevertible}
                onRevert={(id) => { void handleRevert([id]).then((ok) => { if (ok) showChangeToast({ message: tMobile('reverted') }); }); }}
                record={recordText}
                changes={changeRows}
                summary={(e) => describe(e) ?? (e.Action === 'update' ? null : summarizeAuditEntry(e, summaryLabels) || null)}
            />
        );
    }

    // The Tools pages' short band (#59): "Tools", the title, the counts line.
    const band = (meta: React.ReactNode) => (
        <div className="mb-4"><CoverBand variant="short" eyebrow={tNav('tools')} title={t('title')} meta={meta} /></div>
    );

    if ((loading || (entriesTreeKey !== treeKey && !currentError)) && currentEntries.length === 0) {
        // The loaded page's own title and table card, with placeholder rows (#698).
        return (
            <PageShell busy>
                {band(t('subtitle'))}
                <Card pad={false} data-testid="audit-skeleton">
                    <SkeletonList rows={8} />
                </Card>
            </PageShell>
        );
    }

    return (
        <PageShell>
                {band(<>{t('subtitle')} · <span className="tabular-nums">{t('entry_count', { count: currentTotal })}</span></>)}
                {currentError && (
                    <InlineDataError
                        className="mb-4"
                        message={currentError}
                        retryLabel={tCommon('retry')}
                        onRetry={fetchAuditLog}
                    />
                )}

                {/* Desktop filter toolbar */}
                <div className="hidden md:block">
                    <AuditFilterBar
                        filters={filters}
                        onPatch={patchFilters}
                        editors={currentEditors}
                        entryDates={entryDates}
                    />
                </div>

                {/* Bulk revert */}
                {canEdit && currentSelectedIds.size > 0 && (
                    // "2 selected · Revert 2 changes · Clear" (#59).
                    <Card role="status" pad={false} className="flex items-center gap-3 py-2 px-3.5 mb-3">
                        <span className="text-sm font-semibold text-text tabular-nums">{t('selected_count', { count: currentSelectedIds.size })}</span>
                        <Button variant="outline" size="sm" onClick={() => setConfirmRevert(Array.from(currentSelectedIds))} disabled={reverting}
                            icon={<RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />}>
                            {reverting ? t('reverting') : t('revert_n', { count: currentSelectedIds.size })}
                        </Button>
                        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelectedIds(new Set())}>{t('clear')}</Button>
                    </Card>
                )}

                <ConfirmDialog
                    open={confirmRevert != null}
                    variant="calm"
                    tone="danger"
                    title={t('confirm_revert_title')}
                    body={confirmRevert == null ? '' : confirmRevert.length === 1 ? t('confirm_revert_body_one', { count: confirmRevert.length }) : t('confirm_revert_body_other', { count: confirmRevert.length })}
                    confirmLabel={t('revert')}
                    cancelLabel={t('cancel')}
                    onConfirm={() => { if (confirmRevert) handleRevert(confirmRevert); }}
                    onCancel={() => setConfirmRevert(null)}
                />

                {/* Table */}
                {currentEntries.length === 0 ? (
                    currentError ? null : anyFilter ? (
                        <EmptyState
                            variant="filtered"
                            message={t('no_matches')}
                            clearLabel={tCommon('clear_filters')}
                            onClear={() => patchFilters({ entityType: '', action: '', who: null, dateFrom: undefined, dateTo: undefined, search: '' })}
                        />
                    ) : (
                        <EmptyState variant="empty" title={t('empty_title')} message={t('no_entries')} />
                    )
                ) : (
                    <>
                        {/* Desktop table */}
                        <TablePanel page={page} pageSize={pageSize} total={currentTotal} onPage={(n) => { setPage(n); setSelectedIds(new Set()); }}>
                            <DataTable
                                columns={columns}
                                rows={currentEntries}
                                rowKey={(e) => e.Id}
                                sort={{ key: filters.sort, dir: filters.dir }}
                                onSortChange={handleSortChange}
                                selection={canEdit ? {
                                    selected: currentSelectedIds,
                                    onToggle: toggleSelect,
                                    allSelected: currentEntries.some(isAuditEntryRevertible)
                                        && currentEntries.filter(isAuditEntryRevertible).every(e => currentSelectedIds.has(e.Id)),
                                    onToggleAll: toggleSelectAll,
                                    isRowSelectable: isAuditEntryRevertible,
                                } : undefined}
                            />
                        </TablePanel>
                    </>
                )}

        </PageShell>
    );
}
