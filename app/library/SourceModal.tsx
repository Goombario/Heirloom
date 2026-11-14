'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/app/components/Modal';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import { Button, HeroEditButton, InlineDataError, ScrollArea } from '@/app/components/ui';
import { SourceFields } from '@/app/components/SourceFields';
import { useSourceEditor } from '@/app/library/useSourceEditor';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { useDocumentScrollLock } from '@/app/hooks/useDocumentScrollLock';
import { useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import { RecordNotFoundMessage } from '@/app/components/RecordNotFound';
import { Pencil, Link2Off, Trash2, Plus, X } from '@/lib/icons';
import {
  SourceIdentity,
  SourceDetailBody,
  MobilePanel,
  MobileBackButton,
  MobilePanelHeader,
} from '@/app/library/source-modal/parts';
import { CiteOnPanel } from '@/app/library/source-modal/CiteOnPanel';

export interface SourceModalProps {
  /** Existing source id to view/edit, or `null` to open the editor in new-source mode. */
  sourceId: number | null;
  treeId: number | null;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onChanged: () => void;
  /** New-source mode: open the saved source (#799). Without it, saving closes. */
  onCreated?: (id: number) => void;
}

/**
 * View ⇄ edit ⇄ delete of a single source. On desktop (≥768px) this renders a
 * centered `Modal` over the library list; on mobile (<768px) it renders a
 * full-screen **push panel** (slide-in). Both branches share the same
 * `useSourceEditor` state, the identity/evidence fragments (`SourceIdentity` /
 * `SourceDetailBody` in `source-modal/parts`), and the citation-aware delete
 * `ConfirmDialog`; only the surrounding chrome differs.
 */
export default function SourceModal({
  sourceId,
  treeId,
  canEdit,
  canDelete,
  onClose,
  onChanged,
  onCreated,
}: SourceModalProps) {
  const t = useTranslations('library');
  const tc = useTranslations('common');
  const tNav = useTranslations('nav');
  const titleId = useId();
  const loadingId = useId();
  const isMobile = useIsMobile();
  const isNew = sourceId === null;

  const {
    source,
    citedBy,
    form,
    setForm,
    loading,
    saving,
    deleting,
    error,
    isDirty,
    loadError,
    notFound,
    titleValid,
    save,
    remove,
    reload,
    discard,
  } = useSourceEditor(sourceId, treeId);

  const [mode, setMode] = useState<'view' | 'edit' | 'cite'>(isNew ? 'edit' : 'view');
  // "Cite on…" (#799): Cancel returns focus to its button, a save to the result line.
  const citeOnRef = useRef<HTMLButtonElement>(null);
  const citeNoticeRef = useRef<HTMLParagraphElement>(null);
  const [citeNotice, setCiteNotice] = useState<string | null>(null);
  // The Cite on… write is in flight: Escape neither closes nor asks to discard (#846).
  const [citeSaving, setCiteSaving] = useState(false);
  const focusAfterCite = useRef<'button' | 'notice' | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { guardNavigation } = useUnsavedChangesGuard(isDirty);
  const requestClose = useCallback(() => {
    if (guardNavigation()) onClose();
  }, [guardNavigation, onClose]);
  const cancelEdit = useCallback(() => {
    if (!guardNavigation()) return;
    if (isNew) onClose();
    else {
      discard();
      setMode('view');
    }
  }, [discard, guardNavigation, isNew, onClose]);

  const cancelCite = useCallback(() => {
    if (!guardNavigation()) return;
    focusAfterCite.current = 'button';
    setMode('view');
  }, [guardNavigation]);
  const handleCited = useCallback((count: number) => {
    setCiteNotice(t('cite_on_done', { count }));
    focusAfterCite.current = 'notice';
    setMode('view');
    reload();
    onChanged();
  }, [t, reload, onChanged]);
  useEffect(() => {
    if (mode !== 'view' || !focusAfterCite.current) return;
    (focusAfterCite.current === 'notice' ? citeNoticeRef.current : citeOnRef.current)?.focus();
    focusAfterCite.current = null;
  }, [mode]);

  // Mobile full-screen panel: lock document scroll.
  useDocumentScrollLock(isMobile);

  // Esc closes the current mobile layer.
  useEffect(() => {
    if (!isMobile) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || saving || deleting || citeSaving) return;
      e.stopPropagation();
      if (mode === 'edit' && !isNew) cancelEdit();
      else if (mode === 'cite') cancelCite();
      else requestClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isMobile, saving, deleting, citeSaving, mode, isNew, cancelEdit, cancelCite, requestClose]);

  async function handleSave() {
    try {
      const saved = await save();
      onChanged();
      if (isNew) {
        if (onCreated) onCreated(saved.Id);
        else onClose();
      } else setMode('view');
    } catch {
      // Error surfaced via `error` from the hook.
    }
  }

  async function handleDelete() {
    try {
      await remove();
      onChanged();
      onClose();
    } catch {
      setConfirmingDelete(false);
    }
  }

  const errorAlert = error ? (
    <div
      role="alert"
      className="mb-3 rounded-md text-sm border border-[color:var(--error)] py-2.5 px-3.5"
      style={{ background: 'var(--error-bg)', color: 'var(--error)' }}
    >
      {error}
    </div>
  ) : null;

  const loadErrorAlert = loadError ? (
    <InlineDataError
      message={t('failed_load_source')}
      retryLabel={tc('retry')}
      onRetry={reload}
    />
  ) : null;

  const citeNoticeLine = citeNotice ? (
    <p ref={citeNoticeRef} tabIndex={-1} role="status" className="text-sm text-text-secondary mt-0 mb-3 outline-none">
      {citeNotice}
    </p>
  ) : null;

  const citePanel = source ? (
    <CiteOnPanel
      source={source}
      treeId={treeId}
      citedBy={citedBy}
      titleId={titleId}
      isMobile={isMobile}
      onCancel={cancelCite}
      onCited={handleCited}
      onSavingChange={setCiteSaving}
    />
  ) : null;

  // Citation-aware delete confirm — shared by both chromes (portals above via `elevated`).
  const confirmDialog = (
    <ConfirmDialog
      open={confirmingDelete}
      variant="calm"
      tone="danger"
      elevated
      title={t('delete_source_q')}
      body={t('delete_source_body')}
      warning={
        citedBy.length > 0
          ? t('delete_unsourced_warning', { count: citedBy.length })
          : t('delete_no_cites')
      }
      confirmLabel={deleting ? t('deleting_source') : t('delete_source')}
      busy={deleting}
      onConfirm={handleDelete}
      onCancel={() => setConfirmingDelete(false)}
    />
  );

  // ===== Mobile: full-screen push panels =====
  if (isMobile) {
    let panel: React.ReactNode;

    if (loading && !source) {
      panel = (
        <MobilePanel labelledBy={loadingId}>
          <MobilePanelHeader onBack={requestClose} backLabel={tNav('library')} ariaBack={t('back_to_library')} />
          <div id={loadingId} className="flex-1 p-10 text-center text-text-muted text-sm" aria-busy="true">
            {tc('loading')}
          </div>
        </MobilePanel>
      );
    } else if (notFound && !isNew) {
      panel = (
        <MobilePanel labelledBy={titleId}>
          <MobilePanelHeader onBack={requestClose} backLabel={tNav('library')} ariaBack={t('back_to_library')} />
          <div className="flex-1 overflow-y-auto py-10">
            <RecordNotFoundMessage record="source" titleId={titleId} onBack={requestClose} />
          </div>
        </MobilePanel>
      );
    } else if (loadError && !source && !isNew) {
      panel = (
          <MobilePanel labelledBy={titleId}>
          <MobilePanelHeader onBack={requestClose} backLabel={tNav('library')} ariaBack={t('back_to_library')} />
          <div className="flex-1 overflow-y-auto p-[18px]">
            <h2 id={titleId} className="sr-only">{t('source_not_found')}</h2>
            {loadErrorAlert}
          </div>
        </MobilePanel>
      );
    } else if (source && mode === 'cite') {
      panel = <MobilePanel labelledBy={titleId}>{citePanel}</MobilePanel>;
    } else if ((source || isNew) && mode === 'edit') {
      panel = (
        <MobilePanel labelledBy={titleId}>
          <div
            className="flex items-center justify-between gap-2.5 border-b border-border bg-card"
            style={{ padding: 'max(env(safe-area-inset-top), 18px) 16px 12px' }}
          >
            <div className="flex items-center gap-2.5">
              {isNew
                ? <Plus size={17} aria-hidden="true" style={{ color: 'var(--text-secondary)' }} />
                : <Pencil size={17} aria-hidden="true" style={{ color: 'var(--text-secondary)' }} />}
              <h2 id={titleId} className="title-dialog text-text m-0">
                {isNew ? t('new_source_title') : t('edit_source')}
              </h2>
            </div>
            <button
              type="button"
              onClick={cancelEdit}
              title={tc('cancel')}
              aria-label={tc('cancel')}
              disabled={saving}
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] -mr-2 rounded text-text-muted hover:text-text hover:bg-[color:var(--color-hover-surface)] transition"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
            {loadErrorAlert}
            {!loadError && errorAlert}
            <SourceFields value={form} onChange={setForm} disabled={saving} idPrefix="modal-sf" treeId={treeId} />
            {canDelete && !isNew && (
              <Button
                variant="outline"
                onClick={() => setConfirmingDelete(true)}
                disabled={saving || deleting}
                icon={<Trash2 size={14} aria-hidden="true" />}
                className="w-full justify-center min-h-[44px] mt-1"
                style={{ color: 'var(--error)', borderColor: 'var(--error)' }}
              >
                {t('delete_source')}
              </Button>
            )}
          </div>

          <div
            className="flex items-center gap-2.5 border-t border-border bg-card"
            style={{ padding: '11px 14px max(env(safe-area-inset-bottom), 22px)' }}
          >
            <Button
              variant="outline"
              onClick={cancelEdit}
              disabled={saving}
              className="flex-1 justify-center min-h-[44px]"
            >
              {tc('cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving || !titleValid}
              className="flex-[1.3] justify-center min-h-[44px]"
            >
              {saving ? tc('saving') : tc('save')}
            </Button>
          </div>
        </MobilePanel>
      );
    } else if (source) {
      panel = (
        <MobilePanel labelledBy={titleId}>
          <div
            className="sticky top-0 z-[2] flex items-center gap-1.5 border-b border-border bg-card"
            style={{ padding: 'max(env(safe-area-inset-top), 18px) 14px 12px' }}
          >
            <MobileBackButton onBack={requestClose} backLabel={tNav('library')} ariaBack={t('back_to_library')} />
            <div className="flex-1" />
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMode('edit')}
                icon={<Pencil size={13} aria-hidden="true" />}
                className="min-h-[44px]"
              >
                {tc('edit')}
              </Button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-[18px] pt-[18px] pb-[30px]">
            <SourceIdentity source={source} titleId={titleId} t={t} />
            <div className="mt-5">
              {citeNoticeLine}
              <SourceDetailBody source={source} citedBy={citedBy} isMobile={isMobile} t={t} canEdit={canEdit} canDelete={canDelete} treeId={treeId} onCiteOn={canEdit ? () => { setCiteNotice(null); setMode('cite'); } : undefined} citeOnRef={citeOnRef} />
            </div>
          </div>
        </MobilePanel>
      );
    } else {
      panel = null;
    }

    return (
      <>
        {panel}
        {confirmDialog}
      </>
    );
  }

  // ===== Desktop: centered modal =====
  return (
    <Modal open onClose={mode === 'cite' ? cancelCite : requestClose} size="lg" labelledBy={titleId} disableClose={saving || deleting || citeSaving}>
      <div className="bg-card rounded-2xl shadow-xl overflow-hidden flex flex-col" style={{ maxHeight: '88vh' }}>
        {loading && !source ? (
          <div className="p-10 text-center text-text-muted text-sm" aria-busy="true">
            {tc('loading')}
          </div>
        ) : notFound && !isNew ? (
          <div className="py-10">
            <RecordNotFoundMessage record="source" titleId={titleId} onBack={requestClose} />
          </div>
        ) : loadError && !source && !isNew ? (
          <div className="p-6">
            <h2 id={titleId} className="sr-only">{t('source_not_found')}</h2>
            {loadErrorAlert}
            <div className="flex justify-end mt-4">
              <Button variant="outline" size="sm" onClick={requestClose}>
                {tc('close')}
              </Button>
            </div>
          </div>
        ) : source && mode === 'cite' ? (
          citePanel
        ) : (source || isNew) && mode === 'edit' ? (
          /* ===== EDIT / NEW MODE ===== */
          <>
            <div className="flex items-center justify-between gap-3 border-b border-border py-[18px] px-6">
              <div className="flex items-center gap-2.5">
                {isNew
                  ? <Plus size={16} aria-hidden="true" style={{ color: 'var(--text-secondary)' }} />
                  : <Pencil size={16} aria-hidden="true" style={{ color: 'var(--text-secondary)' }} />}
                <h2 id={titleId} className="serif text-lg font-semibold text-text m-0">
                  {isNew ? t('new_source_title') : t('edit_source')}
                </h2>
              </div>
              <button
                type="button"
                onClick={requestClose}
                title={tc('close')}
                aria-label={tc('close')}
                className="inline-flex p-1 rounded text-text-muted hover:text-text hover:bg-[color:var(--color-hover-surface)] transition"
                disabled={saving}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <ScrollArea className="py-[18px] px-6">
              {loadErrorAlert}
              {!loadError && errorAlert}
              <SourceFields value={form} onChange={setForm} disabled={saving} idPrefix="modal-sf" treeId={treeId} />
            </ScrollArea>

            <div className="flex items-center justify-between gap-2.5 border-t border-border bg-card-alt py-[13px] px-6">
              {canDelete && !isNew ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={saving || deleting}
                  icon={<Link2Off size={14} aria-hidden="true" />}
                  style={{ color: 'var(--error)' }}
                >
                  {t('delete_source')}
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={cancelEdit}
                  disabled={saving}
                >
                  {tc('cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSave}
                  disabled={saving || !titleValid}
                >
                  {saving ? tc('saving') : tc('save')}
                </Button>
              </div>
            </div>
          </>
        ) : source ? (
          /* ===== VIEW MODE ===== */
          <>
            {/* Hero — identity only */}
            <div className="border-b border-border bg-card-alt pt-5 px-6 pb-[18px]">
              <div className="flex items-start justify-between gap-3.5">
                <div className="flex-1 min-w-0"><SourceIdentity source={source} titleId={titleId} t={t} /></div>
                <div className="flex items-center gap-2 shrink-0">
                  {canEdit && (
                    <HeroEditButton onClick={() => setMode('edit')} />
                  )}
                  <button
                    type="button"
                    onClick={requestClose}
                    title={tc('close')}
                    aria-label={tc('close')}
                    className="inline-flex p-1 rounded text-text-muted hover:text-text hover:bg-[color:var(--color-hover-surface)] transition"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            {/* Body — evidence ledger + catalog details */}
            <ScrollArea className="pt-[18px] px-6 pb-[22px]">
              {loadErrorAlert}
              {citeNoticeLine}
              <SourceDetailBody source={source} citedBy={citedBy} isMobile={isMobile} t={t} canEdit={canEdit} canDelete={canDelete} treeId={treeId} onCiteOn={canEdit ? () => { setCiteNotice(null); setMode('cite'); } : undefined} citeOnRef={citeOnRef} />
            </ScrollArea>
          </>
        ) : null}
      </div>

      {confirmDialog}
    </Modal>
  );
}
