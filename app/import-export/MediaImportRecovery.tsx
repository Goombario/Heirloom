'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DATA_MODE } from '@/lib/data';
import type { GedcomImportWarning } from '@/lib/data/types';
import type { MediaImportItem } from '@/lib/db/schema';
import { Banner, Badge, Button, buttonClass, Card } from '@/app/components/ui';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import GuardedLink from '@/app/components/GuardedLink';
import { useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import { AlertTriangle, CheckCircle2, CirclePause, Loader2 } from '@/lib/icons';
import { formatGedcomImportWarning } from '@/lib/gedcom/import-warning';
import { useMediaImportRecovery } from './useMediaImportRecovery';

export interface ImportResultSummary {
  mode: string;
  /** The tree the records went into, as the page named it (FR-2). */
  treeName?: string;
  peopleCount: number;
  familiesCount: number;
  tagsCount?: number;
  libraryMediaCount?: number;
  zipWarnings: string[];
  warnings?: GedcomImportWarning[];
  sourcesCount?: number;
  citationsCount?: number;
  preservedCount?: number;
  skippedCount?: number;
  matchedPeopleCount?: number;
  matchedFamiliesCount?: number;
}

export interface MediaImportRecoveryProps {
  treeId?: number | null;
  initialTreeId?: number | null;
  initialItems?: MediaImportItem[];
  initialArchive?: File | null;
  result?: ImportResultSummary | null;
  /** The result's View people and View families; off where the page already offers them (#60). */
  links?: boolean;
  /** The page heading already names the people count, so the records step leaves it out (#206). */
  peopleInHeading?: boolean;
}

const STATUS_TONES: Record<MediaImportItem['status'], 'neutral' | 'green' | 'red' | 'warning'> = {
  pending: 'neutral', ready: 'green', missing: 'warning', failed: 'red',
};

type LifecyclePhase = 'processing' | 'complete' | 'attention';

export default function MediaImportRecovery({ treeId = null, initialTreeId, initialItems, initialArchive = null, result = null, links = true, peopleInHeading = false }: MediaImportRecoveryProps) {
  const t = useTranslations('importExport');
  const seedTreeId = initialTreeId === undefined ? treeId : initialTreeId;
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const lifecycleInputRef = useRef<HTMLInputElement | null>(null);
  // The items a confirm is open for: one row's Remove, or a group's selection (#859).
  const [removeIds, setRemoveIds] = useState<number[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const { items, busy, error, progress, reusedCount, recover, remove, removeMany, stop } = useMediaImportRecovery({ treeId, initialTreeId: seedTreeId, initialItems });
  const autoRecoveryKey = useRef<string | null>(null);

  const currentImportId = initialItems?.[0]?.importId ?? null;
  const currentItems = useMemo(() => {
    if (currentImportId === null) return [];
    // The page keeps this component mounted before an import. On the first
    // result render, the hook's prop-sync effect has not run yet, so derive the
    // phase from the new seed immediately and let durable hook outcomes replace
    // those rows by id as they arrive. This prevents a one-frame false 0/0
    // completion announcement before photo processing starts.
    const byId = new Map(
      (initialItems ?? [])
        .filter((item) => item.importId === currentImportId)
        .map((item) => [item.id, item]),
    );
    for (const item of items) {
      if (item.importId === currentImportId) byId.set(item.id, item);
    }
    return Array.from(byId.values());
  }, [currentImportId, initialItems, items]);
  const readyCount = currentItems.filter((item) => item.status === 'ready').length;
  const failedCount = currentItems.filter((item) => item.status === 'failed' || item.status === 'missing').length;
  const pendingCount = currentItems.filter((item) => item.status === 'pending').length;
  const canAutoRecover = Boolean(initialArchive && currentItems.length > 0);
  const phase: LifecyclePhase = busy || (pendingCount > 0 && canAutoRecover)
    ? 'processing'
    : failedCount > 0 || pendingCount > 0 || error
      ? 'attention'
      : 'complete';
  // The selected File object only lives in this page. Register the active phase
  // with the app-wide navigation guard so links, history traversal, refresh and
  // tab close cannot silently interrupt materialization.
  useUnsavedChangesGuard(Boolean(result && phase === 'processing' && (initialArchive || busy)));

  useEffect(() => {
    if (seedTreeId !== treeId || !initialArchive || !initialItems || initialItems.length === 0) return;
    const key = `${seedTreeId ?? 'default'}:${initialArchive.name}:${initialArchive.size}:${initialItems.map((item) => item.id).join(',')}`;
    if (autoRecoveryKey.current === key) return;
    autoRecoveryKey.current = key;
    void recover(initialArchive, initialItems[0].importId, initialItems);
  }, [initialArchive, initialItems, recover, seedTreeId, treeId]);

  const handleArchive = async (event: React.ChangeEvent<HTMLInputElement>, importId: string) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    try {
      await recover(selected, importId);
    } finally {
      // A corrected archive with the same name must still fire a change event.
      event.target.value = '';
    }
  };

  const confirmRemove = async () => {
    if (removeIds === null) return;
    const ids = removeIds;
    setRemoveIds(null);
    setSelected((previous) => new Set([...previous].filter((id) => !ids.includes(id))));
    if (ids.length === 1) await remove(ids[0]);
    else await removeMany(ids);
  };

  const toggleSelected = (ids: number[], on: boolean) => setSelected((previous) => {
    const next = new Set(previous);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    return next;
  });

  const groups = Array.from(items.reduce((byImport, item) => {
    const group = byImport.get(item.importId) ?? [];
    group.push(item);
    byImport.set(item.importId, group);
    return byImport;
  }, new Map<string, MediaImportItem[]>()).values());

  const lifecycleGroups = currentImportId === null
    ? groups
    : groups.filter((group) => group[0]?.importId === currentImportId);

  const formatImportWarning = (warning: GedcomImportWarning): string =>
    formatGedcomImportWarning(warning, (key, values) => t(key, values));

  const renderItem = (item: MediaImportItem) => (
    <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2.5">
        {item.status !== 'ready' && (
          <input
            type="checkbox"
            className="m-0 h-4 w-4 shrink-0 accent-primary"
            aria-label={t('media_recovery_select_item', { name: item.originalFilename })}
            checked={selected.has(item.id)}
            disabled={busy}
            onChange={(event) => toggleSelected([item.id], event.target.checked)}
          />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">{item.originalFilename}</p>
          <p className="mt-0.5 text-xs text-text-muted">{t(`media_recovery_status_${item.status}`)}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={STATUS_TONES[item.status]}>
          {item.failureCode ? t(`media_recovery_failure_${item.failureCode}`) : t(`media_recovery_status_${item.status}`)}
        </Badge>
        {item.status !== 'ready' && (
          <Button variant="ghost" size="sm" onClick={() => setRemoveIds([item.id])} disabled={busy}>
            {t('media_recovery_remove')}
          </Button>
        )}
      </div>
    </li>
  );

  if (items.length === 0 && !busy && !error && !result) return null;

  // After an import, list only the photos that still need something (#206).
  const detailGroups = result
    ? lifecycleGroups.map((group) => group.filter((item) => item.status !== 'ready')).filter((group) => group.length > 0)
    : groups;
  const hasMedia = currentItems.length > 0;
  // Waiting: photos still need their archive but none has failed, as after
  // Stop or a plain GEDCOM. Its rows would only repeat "Waiting" (#206).
  const waiting = phase === 'attention' && failedCount === 0 && pendingCount > 0 && !error;
  const showDetails = !result || (phase === 'attention' && !waiting);
  const totalCount = currentItems.length;
  const percent = hasMedia ? Math.round((readyCount / totalCount) * 100) : 0;
  const showBar = hasMedia && (phase === 'processing' || waiting);
  const records = result
    ? [
      !peopleInHeading && t('media_lifecycle_count_people', { count: result.peopleCount }),
      t('media_lifecycle_count_families', { count: result.familiesCount }),
      (result.sourcesCount ?? 0) > 0 && t('media_lifecycle_count_sources', { count: result.sourcesCount ?? 0 }),
      (result.citationsCount ?? 0) > 0 && t('media_lifecycle_count_citations', { count: result.citationsCount ?? 0 }),
      (result.tagsCount ?? 0) > 0 && t('media_lifecycle_count_tags', { count: result.tagsCount ?? 0 }),
      (result.libraryMediaCount ?? 0) > 0 && t('media_lifecycle_count_library', { count: result.libraryMediaCount ?? 0 }),
    ].filter(Boolean).join(', ')
    : '';
  const recordNotes: string[] = result
    ? [
      ...((result.preservedCount ?? 0) > 0 ? [`${t('success_preserved')} ${result.preservedCount}`] : []),
      ...((result.matchedPeopleCount ?? 0) > 0 || (result.matchedFamiliesCount ?? 0) > 0
        ? [t('success_matched', { people: result.matchedPeopleCount ?? 0, families: result.matchedFamiliesCount ?? 0 })]
        : []),
      ...((result.skippedCount ?? 0) > 0 ? [`${t('success_skipped')} ${result.skippedCount}`] : []),
      ...(result.zipWarnings.length > 0 ? [t('success_zip_warnings'), ...result.zipWarnings] : []),
      ...(result.warnings ?? []).map(formatImportWarning),
    ]
    : [];
  const photoTitle = phase === 'processing'
    ? t('media_lifecycle_photos_preparing')
    : phase === 'complete'
      ? t('media_lifecycle_photos_complete', { count: totalCount })
      : waiting
        ? t('media_lifecycle_photos_waiting')
        : t('media_lifecycle_photos_attention', { ready: readyCount, total: totalCount });
  const photoHint = phase === 'processing'
    ? t('media_lifecycle_stay_open')
    : waiting
      ? t('media_lifecycle_hint_waiting', { count: pendingCount })
      : phase === 'attention' && failedCount > 0
        ? t('media_lifecycle_hint_attention', { count: failedCount })
        : null;
  const PhotoIcon = phase === 'processing' ? Loader2 : phase === 'complete' ? CheckCircle2 : waiting ? CirclePause : AlertTriangle;
  const photoIconTone = phase === 'processing'
    ? 'animate-spin text-primary'
    : phase === 'complete'
      ? 'text-success'
      : waiting
        ? 'text-text-muted'
        : 'text-warning-text';

  const lifecycleSteps = result && (
    <ol className="m-0 list-none divide-y divide-border p-0" role="status" aria-live="polite">
      <li className="flex items-start gap-3 pb-4 last:pb-0">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="m-0 font-semibold text-text">{t('media_lifecycle_records_saved')}</p>
          {records && <p className="m-0 mt-1 text-sm text-text-muted">{records}</p>}
          {recordNotes.length > 0 && (
            <ul className="m-0 mt-2 list-disc space-y-1 pl-4 text-xs text-text-muted">
              {recordNotes.map((note, index) => <li key={index}>{note}</li>)}
            </ul>
          )}
        </div>
      </li>
      {hasMedia && (
        <li className="flex flex-wrap items-start gap-3 pt-4 sm:flex-nowrap">
          <PhotoIcon className={`mt-0.5 h-5 w-5 shrink-0 ${photoIconTone}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="m-0 font-semibold text-text">{photoTitle}</p>
              {showBar && (
                <span className="text-sm tabular-nums text-text-secondary">
                  {t('media_lifecycle_photos_count', { current: readyCount, total: totalCount })}
                </span>
              )}
            </div>
            {showBar && (
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
                role="progressbar"
                aria-label={t('media_lifecycle_progress_label')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <span
                  className={`block h-full rounded-full transition-[width] duration-200 ${phase === 'processing' ? 'bg-primary' : 'bg-text-muted'}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
            )}
            {photoHint && <p className="m-0 mt-2 text-sm text-text-muted">{photoHint}</p>}
          </div>
          {busy && progress && (
            <Button variant="outline" onClick={stop}>{t('media_recovery_stop')}</Button>
          )}
          {!busy && phase === 'attention' && currentImportId !== null && (pendingCount > 0 || failedCount > 0) && (
            <>
              <input
                ref={lifecycleInputRef}
                id="media-lifecycle-archive"
                data-testid="media-lifecycle-archive"
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => void handleArchive(event, currentImportId)}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
              />
              <Button onClick={() => lifecycleInputRef.current?.click()}>{t('media_lifecycle_choose_zip')}</Button>
            </>
          )}
        </li>
      )}
    </ol>
  );

  const recoveryBody = (
    <>
      {progress && progress.total > 0 && !result && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-text-muted" role="status">
            {t('media_recovery_progress', { current: progress.current, total: progress.total })}
          </p>
          {busy && <Button variant="outline" size="sm" onClick={stop}>{t('media_recovery_stop')}</Button>}
        </div>
      )}
      {reusedCount > 0 && (
        <p className="mt-3 text-sm text-text-muted" role="status">
          {t('media_recovery_reused', { count: reusedCount })}
        </p>
      )}
      {error && (
        <Banner tone="error" className="mt-4">
          {t(`media_recovery_${error}`)}
        </Banner>
      )}

      {showDetails && detailGroups.length > 0 && (
        <div className={`mt-4 space-y-4 ${result ? 'border-t border-border pt-4' : ''}`} aria-live="polite">
          {detailGroups.map((group, index) => {
            const ordinal = index + 1;
            const inputId = `media-recovery-archive-${index}`;
            const groupHeadingId = `media-recovery-group-${index}`;
            const archiveLabel = t('media_recovery_choose_archive_for_group', { group: ordinal });
            const removable = group.filter((item) => item.status !== 'ready').map((item) => item.id);
            const chosen = removable.filter((id) => selected.has(id));
            return (
              <section key={group[0]?.importId ?? index} aria-labelledby={groupHeadingId} data-testid={`media-recovery-group-${index}`}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
                  <h3 id={groupHeadingId} className="text-sm font-semibold text-text">
                    {t('media_recovery_group_heading', { group: ordinal, count: group.length })}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {removable.length > 1 && (
                      <label className="flex min-h-8 items-center gap-2 text-sm text-text-secondary">
                        <input
                          type="checkbox"
                          className="m-0 h-4 w-4 accent-primary"
                          checked={chosen.length === removable.length}
                          ref={(element) => { if (element) element.indeterminate = chosen.length > 0 && chosen.length < removable.length; }}
                          disabled={busy}
                          onChange={(event) => toggleSelected(removable, event.target.checked)}
                        />
                        {t('media_recovery_select_all')}
                      </label>
                    )}
                    {chosen.length > 0 && (
                      <Button variant="danger" size="sm" onClick={() => setRemoveIds(chosen)} disabled={busy}>
                        {t('media_recovery_remove_selected', { count: chosen.length })}
                      </Button>
                    )}
                    {/* After an import the photos step carries Choose ZIP (#206). */}
                    {!result && (
                      <>
                        <label htmlFor={inputId} className="sr-only">{archiveLabel}</label>
                        <input
                          ref={(element) => { inputRefs.current[index] = element; }}
                          id={inputId}
                          data-testid={inputId}
                          type="file"
                          accept=".zip,application/zip"
                          onChange={(event) => void handleArchive(event, group[0].importId)}
                          disabled={busy}
                          className="sr-only"
                          aria-label={archiveLabel}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={archiveLabel}
                          onClick={() => inputRefs.current[index]?.click()}
                          disabled={busy}
                        >
                          {busy ? t('media_recovery_processing') : t('media_recovery_choose_archive')}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <ul className="divide-y divide-border" aria-label={t('media_recovery_group_heading', { group: ordinal, count: group.length })}>
                  {group.map(renderItem)}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );

  const recoveryContent = result ? (
    <div className="space-y-2">
      <Card className="sm:p-5" data-testid="import-lifecycle-panel">
        {lifecycleSteps}
        {recoveryBody}
        {links && (
          <div className="mt-4 flex flex-wrap gap-2">
            {phase === 'complete' && (
              <GuardedLink href="/people" className={buttonClass({ variant: 'primary', size: 'lg' })}>
                {t('view_people')}
              </GuardedLink>
            )}
            <GuardedLink href={phase === 'complete' ? '/families' : '/people'} className={buttonClass({ variant: 'outline', size: 'lg' })}>
              {t(phase === 'complete' ? 'view_families' : 'media_lifecycle_view_records')}
            </GuardedLink>
          </div>
        )}
      </Card>
      <p className="m-0 px-1 text-xs text-text-muted">{t(DATA_MODE === 'local' ? 'import_recorded_note' : 'import_recorded_note_hosted')}</p>
    </div>
  ) : (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-text">{t('media_recovery_title')}</h2>
          <p className="mt-1 text-sm text-text-secondary">{t('media_recovery_description')}</p>
        </div>
      </div>
      {recoveryBody}
    </>
  );

  return (
    <>
      {result ? recoveryContent : <Card className="mt-6" data-testid="media-recovery-panel">{recoveryContent}</Card>}

      <ConfirmDialog
        open={removeIds !== null}
        variant="calm"
        tone="danger"
        title={(removeIds?.length ?? 0) > 1 ? t('media_recovery_remove_many_title', { count: removeIds!.length }) : t('media_recovery_remove_title')}
        body={t('media_recovery_remove_body')}
        confirmLabel={(removeIds?.length ?? 0) > 1 ? t('media_recovery_confirm_remove_many', { count: removeIds!.length }) : t('media_recovery_confirm_remove')}
        busy={busy}
        onConfirm={confirmRemove}
        onCancel={() => setRemoveIds(null)}
      />
    </>
  );
}
