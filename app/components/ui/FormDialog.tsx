'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import Modal from '@/app/components/Modal';
import { useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import { DialogHeader } from './DialogHeader';
import { cx } from './cx';

export interface FormDialogProps {
  open: boolean;
  onClose: () => void;
  /** "Add a person", "New family". */
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  /**
   * The right of the footer: Cancel, then the one copper main action ("Save and open").
   * As a function it gets the guarded close, for the Cancel button.
   */
  footer: React.ReactNode | ((requestClose: () => void) => React.ReactNode);
  /** The left of the footer ("Save and add another"). */
  footerStart?: React.ReactNode;
  /** Unsaved changes: ×, the footer's guarded close, Escape, the backdrop and navigation all ask first. */
  dirty?: boolean;
  /** While saving, nothing closes the dialog. */
  busy?: boolean;
}

/**
 * The v1.1 form dialog shell (#55): 640px over the page it was opened from, with
 * a title and ×, a scrolling body and a footer bar. Opening it focuses the first
 * field. Closing it any way asks before
 * dropping unsaved changes. The Add person and New family quick-add forms, Research's
 * New lead, Places' "Search the map again" and Import's preflight use it. The footer
 * buttons are the caller's, so the copper main action stays one per dialog.
 */
export function FormDialog({ open, onClose, title, subtitle, children, footer, footerStart, dirty = false, busy = false }: FormDialogProps) {
  const titleId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  // Opening focuses the first field, not the ×. This runs after Modal's own
  // focus-on-open, because a parent's effects run after its children's.
  useEffect(() => {
    if (!open) return;
    bodyRef.current?.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), [role="combobox"]:not([disabled])')?.focus();
  }, [open]);
  const { guardNavigation } = useUnsavedChangesGuard(open && dirty);
  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty && !guardNavigation()) return;
    onClose();
  }, [busy, dirty, guardNavigation, onClose]);

  return (
    <Modal open={open} onClose={requestClose} size="form" labelledBy={titleId} disableClose={busy}>
      <div className="form-dialog flex max-h-[calc(100dvh-32px)] flex-col overflow-hidden rounded-panel bg-card shadow-xl">
        <DialogHeader className="px-6 pt-5 pb-3" title={title} titleId={titleId} subtitle={subtitle} onClose={requestClose} closeDisabled={busy} />
        <div ref={bodyRef} className="scroll-area min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
        <div className={cx('flex items-center gap-3 border-t border-border bg-card-alt px-6 py-3.5', footerStart ? 'justify-between' : 'justify-end')}>
          {footerStart && <div className="flex items-center gap-2">{footerStart}</div>}
          <div className="flex items-center gap-2">{typeof footer === 'function' ? footer(requestClose) : footer}</div>
        </div>
      </div>
    </Modal>
  );
}
