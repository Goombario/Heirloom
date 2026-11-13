'use client';
import React, { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from './Button';
import { cx } from './cx';
import { useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import { escapeToCancel, useFocusFirstField } from '@/app/hooks/useEditorFocusReturn';
import { hasUncommittedDate } from '@/app/components/date-input/DateInput';

export interface HeroEditorPanelProps {
  children: React.ReactNode;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  /** Opens the record's delete confirm. Omit when the user may not delete. */
  onDelete?: () => void;
  /** "Delete person…", "Delete partnership…": names the record, ends in an ellipsis. */
  deleteLabel?: string;
  /** Unsaved edits: they guard navigation away, and Escape asks before discarding them. */
  dirty?: boolean;
  className?: string;
}

/**
 * The record-identity editing pattern (#759, design-system.md §Editing patterns):
 * the hero turns into this panel in place while the page body dims. Person and
 * family heroes share it, so both get the same field rhythm and the same action
 * row (`EditorActions`).
 */
export function HeroEditorPanel({ children, onSave, onCancel, saving, onDelete, deleteLabel, dirty = false, className }: HeroEditorPanelProps) {
  const tc = useTranslations('common');
  const { guardNavigation } = useUnsavedChangesGuard(dirty);
  // Opening the editor puts focus in its first field (#798, KB-2).
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusFirstField(panelRef);
  // Escape is Cancel (#798, KB-3), behind the unsaved-changes confirm when edited.
  // A date typed but not yet blurred counts as an edit: `dirty` can't see it (#861).
  const onKeyDown = escapeToCancel((panel) => {
    if (saving) return;
    if (dirty) { if (guardNavigation()) onCancel(); return; }
    if (!hasUncommittedDate(panel) || window.confirm(tc('unsaved_changes_confirm'))) onCancel();
  });
  return (
    <div ref={panelRef} className={cx('flex-1 min-w-[240px] flex flex-col gap-3.5', className)} onKeyDown={onKeyDown}>
      {children}
      <EditorActions onSave={onSave} onCancel={onCancel} saving={saving} onDelete={onDelete} deleteLabel={deleteLabel} />
    </div>
  );
}

/**
 * The one action row every record editor ends with (#759, #797): the delete as
 * quiet red text on the left, Save (the editor's one coloured fill) and Cancel on
 * the right. The hero editors use it at `md`; inline panels at `sm`.
 */
export function EditorActions({ onSave, onCancel, saving, saveLabel, saveDisabled = false, onDelete, deleteLabel, leading, size = 'md' }: {
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  /** Defaults to "Save changes"; an add panel names what it adds ("Add name"). */
  saveLabel?: string;
  saveDisabled?: boolean;
  /** Opens the record's delete confirm. Omit when there is no delete, or the user may not. */
  onDelete?: () => void;
  /** "Delete person…", "Delete event": names the record. */
  deleteLabel?: string;
  /** Quiet content on the left when there is no delete (a notes editor's save hint). */
  leading?: React.ReactNode;
  size?: 'sm' | 'md';
}) {
  const tc = useTranslations('common');
  return (
    <div className="flex items-center gap-2 flex-wrap pt-1">
      {onDelete && deleteLabel && (
        <Button variant="danger-text" size={size} onClick={onDelete} disabled={saving} className={size === 'sm' ? '-ml-3' : '-ml-3.5'}>
          {deleteLabel}
        </Button>
      )}
      {leading}
      {/* Cancel, then the copper main action last, as on the locked boards. */}
      <div className="ml-auto flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size={size} onClick={onCancel} disabled={saving}>
          {tc('cancel')}
        </Button>
        <Button variant="primary" size={size} onClick={onSave} disabled={saving || saveDisabled}>
          {saving ? tc('saving') : saveLabel ?? tc('save_changes')}
        </Button>
      </div>
    </div>
  );
}

/** One row of hero-editor fields; each child is a field that wraps below 200px. */
export function HeroEditorRow({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-3 flex-wrap [&>*]:flex-[1_1_200px]">{children}</div>;
}
