'use client';
import React from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Trash2 } from '@/lib/icons';
import { cx } from './cx';

/**
 * One quiet row action (icon + label) in a `RowActions` cluster. Warms to link ink
 * on hover, or to error red with `danger`.
 */
export function RowAction({ icon, label, ariaLabel, title, onClick, danger = false, disabled, children }: {
  icon: React.ReactNode;
  /** Visible text (hidden in a `compact` cluster, where `ariaLabel` still names it). */
  label: string;
  ariaLabel: string;
  /** Tooltip, when it should say more than the label. */
  title?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Trailing decoration after the label (the intrinsic-event ↗). */
  children?: React.ReactNode;
}) {
  return (
    <button type="button" className={cx('ev-act', danger && 'danger')} onClick={onClick} aria-label={ariaLabel} title={title ?? label} disabled={disabled}>
      {icon}
      <span className="ev-act-label">{label}</span>
      {children}
    </button>
  );
}

/**
 * The collections editing pattern's row actions (#760, design-system.md §Editing
 * patterns): Edit and Delete on one row of an events, children, names or notes
 * list. They show on row hover or focus (the row carries `row-host`, or is a
 * timeline `.tl-med-ev`), and stay visible on touch. `children` adds actions
 * before Edit (a note's Make preferred).
 */
export function RowActions({ editLabel, deleteLabel, onEdit, onDelete, deleteText, compact = false, disabled, children }: {
  /** Accessible name for Edit, naming the row ("Edit occupation"). */
  editLabel?: string;
  /** Accessible name for Delete, naming the row. */
  deleteLabel?: string;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Visible Delete text when the row's delete only unlinks ("Remove"). */
  deleteText?: string;
  /** Icon-only, for a narrow rail; every action keeps its accessible name. */
  compact?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const tc = useTranslations('common');
  return (
    <div className={cx('ev-row-actions', compact && 'compact')}>
      {children}
      {onEdit && (
        <RowAction icon={<Pencil size={13} aria-hidden="true" />} label={tc('edit')} ariaLabel={editLabel ?? tc('edit')} onClick={onEdit} disabled={disabled} />
      )}
      {onDelete && (
        <RowAction danger icon={<Trash2 size={13} aria-hidden="true" />} label={deleteText ?? tc('delete')} ariaLabel={deleteLabel ?? deleteText ?? tc('delete')} onClick={onDelete} disabled={disabled} />
      )}
    </div>
  );
}
