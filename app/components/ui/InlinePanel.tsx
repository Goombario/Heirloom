'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { escapeToCancel, useFocusFirstField } from '@/app/hooks/useEditorFocusReturn';
import { useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import { hasUncommittedDate } from '@/app/components/date-input/DateInput';
import { EditorActions } from './HeroEditorPanel';
import { cx } from './cx';

export interface InlinePanelProps {
  /** Names the panel for assistive tech ("Edit Birth", "Add another name"). */
  label: string;
  children: React.ReactNode;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  /** Defaults to "Save changes"; an add panel names what it adds ("Add name"). */
  saveLabel?: string;
  saveDisabled?: boolean;
  /**
   * Unsaved edits. They guard navigation away and Escape asks before discarding
   * them (#798). A date typed but not yet blurred counts too.
   */
  dirty?: boolean;
  /** The row's delete, as quiet red text on the left. Editors only. */
  onDelete?: () => void;
  deleteLabel?: string;
  className?: string;
}

/**
 * The inline edit panel (#55): opens in place under its row, focuses its first
 * field, ends in `EditorActions` at `sm`, and asks before discarding changes on
 * Escape or navigation (#798). The opener keeps `useEditorFocusReturn` so focus
 * goes back to the row's Edit when the panel closes. It is the base for the
 * event, name, note, biography, child relationship, Move and Edit family panels.
 */
export function InlinePanel({
  label, children, onSave, onCancel, saving, saveLabel, saveDisabled, dirty = false, onDelete, deleteLabel, className,
}: InlinePanelProps) {
  const tc = useTranslations('common');
  const { guardNavigation } = useUnsavedChangesGuard(dirty);
  const ref = useRef<HTMLDivElement>(null);
  useFocusFirstField(ref);
  const onKeyDown = escapeToCancel((panel) => {
    if (saving) return;
    if (dirty) { if (guardNavigation()) onCancel(); return; }
    if (!hasUncommittedDate(panel) || window.confirm(tc('unsaved_changes_confirm'))) onCancel();
  });
  return (
    <div ref={ref} role="group" aria-label={label} className={cx('inline-panel flex flex-col gap-3', className)} onKeyDown={onKeyDown}>
      {children}
      <EditorActions size="sm" onSave={onSave} onCancel={onCancel} saving={saving} saveLabel={saveLabel} saveDisabled={saveDisabled} onDelete={onDelete} deleteLabel={deleteLabel} />
    </div>
  );
}
