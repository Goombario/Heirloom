'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import { Button } from '@/app/components/ui';
import { Trash2 } from '@/lib/icons';

export interface LibraryPhotoDeleteFailure {
  id: number;
  title: string;
  code: 'delete_failed';
  retryable: true;
}

export interface LibraryPhotoBulkToolbarProps {
  canDelete: boolean;
  selectionMode: boolean;
  selectedCount: number;
  visibleCount: number;
  allVisibleSelected: boolean;
  busy: boolean;
  onEnter: () => void;
  onDone: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  onDelete: () => void;
}

/**
 * The photo selection controls are deliberately presentational. The Library
 * page owns selection and mutation state; this component only presents the
 * temporary mode, confirmation, and stable item-level outcomes.
 */
export default function LibraryPhotoBulkToolbar({
  canDelete,
  selectionMode,
  selectedCount,
  visibleCount,
  allVisibleSelected,
  busy,
  onEnter,
  onDone,
  onSelectAll,
  onClear,
  onDelete,
}: LibraryPhotoBulkToolbarProps) {
  const t = useTranslations('library');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const wasBusy = useRef(false);
  const wasSelecting = useRef(selectionMode);
  const selectControl = useRef<HTMLDivElement>(null);

  // A completed request closes the confirmation. While busy it stays mounted,
  // and ConfirmDialog disables both actions and Escape through its Modal.
  useEffect(() => {
    // The transition is an external mutation lifecycle (busy is owned by the
    // Library controller), so close the local dialog when that lifecycle ends.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (wasBusy.current && !busy) setConfirmOpen(false);
    wasBusy.current = busy;
  }, [busy]);

  // Modal restores focus to the trigger when it unmounts. A successful delete
  // also removes that trigger with selection mode, so explicitly focus the
  // stable replacement control after the mode transition.
  useEffect(() => {
    if (wasSelecting.current && !selectionMode) {
      selectControl.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }
    wasSelecting.current = selectionMode;
  }, [selectionMode]);

  if (!canDelete) return null;

  if (!selectionMode) {
    return (
      <div ref={selectControl}>
        <Button variant="outline" size="md" onClick={onEnter} className="!bg-card enabled:hover:!bg-surface-2 pointer-coarse:min-h-11">
          {t('select')}
        </Button>
      </div>
    );
  }

  const deleteLabel = t('delete_selected', { count: selectedCount });

  return (
    <>
      <div
        data-testid="photo-selection-dock-wrap"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[calc(env(safe-area-inset-bottom)+var(--space-3))] md:left-[220px] md:right-0 md:bottom-4 md:px-7 md:pb-0"
      >
        <div
          data-testid="photo-selection-dock"
          className="pointer-events-auto flex w-full max-w-3xl flex-wrap items-center justify-center gap-2 rounded-panel border border-border bg-card/95 px-3 py-2.5 shadow-lg backdrop-blur-md md:w-auto md:max-w-full md:justify-start lg:flex-nowrap"
        >
          <div className="flex items-center gap-2 pointer-coarse:min-h-11">
            <span
              className="inline-flex h-9 min-w-9 items-center justify-center rounded-btn bg-surface-2 px-2 text-xs font-semibold text-text"
              aria-hidden="true"
            >
              {selectedCount}
            </span>
            <span className="flex min-w-[100px] flex-col" aria-live="polite">
              <strong className="text-xs font-semibold text-text">{t('selected_count', { count: selectedCount })}</strong>
              <small className="text-[10px] text-text-muted">{t('selection_mode_label')}</small>
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={allVisibleSelected ? onClear : onSelectAll}
            disabled={busy || visibleCount === 0}
            className="pointer-coarse:min-h-11"
          >
            {allVisibleSelected ? t('clear_selection') : t('select_all_results', { count: visibleCount })}
          </Button>
          {!allVisibleSelected && (
            <Button variant="ghost" size="sm" onClick={onClear} disabled={busy} className="pointer-coarse:min-h-11">
              {t('clear_selection')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onDone} disabled={busy} className="pointer-coarse:min-h-11">
            {t('done')}
          </Button>
          <div className="w-auto border-l border-border pl-2 ml-1 md:pl-3">
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={15} aria-hidden="true" />}
              onClick={() => setConfirmOpen(true)}
              disabled={busy || selectedCount === 0}
              aria-label={busy ? t('deleting_selected') : deleteLabel}
              className="w-full md:w-auto pointer-coarse:min-h-11"
            >
              {busy ? t('deleting_selected') : t('delete_selected_short', { count: selectedCount })}
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        variant="calm"
        tone="danger"
        title={t('delete_selected_title')}
        body={t('delete_selected_body', { count: selectedCount })}
        confirmLabel={t('delete_selected_confirm')}
        busy={busy}
        onConfirm={onDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
