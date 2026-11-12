'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { X } from '@/lib/icons';
import { InlineDataError } from '@/app/components/ui';
import { useFocusTrap } from '@/app/hooks/useFocusTrap';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { useTreePersonEditor } from './person-sidebar/useTreePersonEditor';
import { SidebarContent } from './person-sidebar/SidebarContent';

interface PersonSidebarProps {
  personId: number;
  onClose: () => void;
  onFocusPerson: (id: number) => void;
  onDataChanged?: () => void;
}

export default function PersonSidebar({ personId, onClose, onFocusPerson, onDataChanged }: PersonSidebarProps) {
  const t = useTranslations('treeSidebar');
  const tCommon = useTranslations('common');
  const editor = useTreePersonEditor({ personId, onClose, onDataChanged });
  const {
    person,
    loading,
    loadError,
    retryLoad,
    mediaError,
    retryMedia,
    visible,
    isMobile,
    showLoadingOverlay,
    handleClose,
    displayName,
  } = editor;
  // Only the mobile bottom sheet is truly modal (it has a backdrop). The desktop
  // panel is a non-modal side editor — the tree behind it stays interactive — so
  // it gets dialog semantics + Escape but no focus trap / aria-modal.
  const trapRef = useFocusTrap<HTMLDivElement>(isMobile);
  // lg and up: the v1.1 person panel (#71), with its close button in the navy head.
  const panel = !useIsMobile('lg') && !isMobile;

  // Escape closes the sidebar (honoring the unsaved-changes confirm in handleClose).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleClose]);

  // A failed person read can leave the previously loaded form mounted while the
  // sidebar reports the current error. Do not let the delayed loading veil cover
  // the retry action (the hook intentionally keeps the stale form non-editable).
  const loadingOverlay = showLoadingOverlay && !loadError && (
    <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--color-card) 70%, transparent)', backdropFilter: 'blur(4px)' }}>
      <span className="muted text-sm">{tCommon('loading')}</span>
    </div>
  );

  const notFoundMsg = (
    <div className="p-6 text-center text-text-secondary">{t('person_not_found')}</div>
  );

  const body = !person && loading ? null : !person && !loading && loadError ? (
    <div className="p-5">
      <InlineDataError message={loadError} retryLabel={tCommon('retry')} onRetry={retryLoad} />
    </div>
  ) : !person && !loading ? notFoundMsg : (
    <>
      {loadError && (
        <div className="p-5 pb-0">
          <InlineDataError message={loadError} retryLabel={tCommon('retry')} onRetry={retryLoad} />
        </div>
      )}
      {mediaError && (
        <div className="p-5 pb-0">
          <InlineDataError message={mediaError} retryLabel={tCommon('retry')} onRetry={retryMedia} />
        </div>
      )}
      <SidebarContent editor={editor} personId={personId} onFocusPerson={onFocusPerson} panel={panel} onClose={panel ? handleClose : undefined} />
    </>
  );

  if (isMobile) {
    return (
      <>
        {/* Backdrop */}
        <div
          className={`fixed inset-0 bg-black/40 z-40 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
          onClick={handleClose}
        />
        {/* Bottom sheet */}
        <div
          ref={trapRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={displayName}
          className={`fixed bottom-0 left-0 right-0 z-50 bg-card shadow-2xl rounded-t-2xl overflow-hidden outline-none transition-transform duration-300 ease-in-out ${
            visible ? 'translate-y-0' : 'translate-y-full'
          }`}
          style={{ maxHeight: '82vh' }}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-border" />
          </div>
          {/* Close button */}
          <button onClick={handleClose} className="absolute top-3 right-3 btn-close z-30" aria-label={tCommon('close')} title={tCommon('close')}>
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
          <div className="relative overflow-y-auto" style={{ maxHeight: 'calc(82vh - 36px)' }}>
            {loadingOverlay}
            {body}
          </div>
        </div>
      </>
    );
  }

  return (
    <div
      role="dialog"
      aria-label={displayName}
      className={`absolute top-0 right-0 h-full z-40 bg-card shadow-xl border-l border-border overflow-y-auto transition-transform duration-300 ease-in-out ${
        visible ? 'translate-x-0' : 'translate-x-full'
      }`}
      // Shared with the canvas panel offset (.tree-canvas in globals.css) so the
      // two cannot drift — the panels slide clear by exactly this width.
      style={{ width: 'var(--tree-sidebar-w)' }}
    >
      {/* Close button (the v1.1 panel draws its own, in the navy head) */}
      {!(panel && person) && (
        <button onClick={handleClose} className="absolute top-3 left-3 btn-close z-30" aria-label={tCommon('close')} title={tCommon('close')}>
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      )}
      {loadingOverlay}
      {body}
    </div>
  );
}
