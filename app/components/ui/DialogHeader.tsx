'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { X } from '@/lib/icons';
import { cx } from './cx';
import { IconButton } from './IconButton';

export interface DialogHeaderProps {
  title: React.ReactNode;
  /** Sets the heading `id` for the modal's `aria-labelledby`. */
  titleId?: string;
  subtitle?: React.ReactNode;
  /** Optional leading node (icon disc / thumbnail). */
  icon?: React.ReactNode;
  /** When provided, renders a trailing close-✕ (via `IconButton`). */
  onClose?: () => void;
  /** Disable the close button (e.g. while a request is in flight). */
  closeDisabled?: boolean;
  className?: string;
  /** Extra classes for the trailing close button (e.g. a larger tap target). */
  closeClassName?: string;
}

/**
 * The modal title row — heading (+ optional subtitle / leading icon) and an optional
 * close-✕ — that every `Modal` consumer re-typed (#175 Wave 4). The close button is
 * a `ui/IconButton`; its label comes from `common.close`. The title is the
 * 22px dialog recipe (`.title-dialog`, #687).
 */
export function DialogHeader({
  title, titleId, subtitle, icon, onClose, closeDisabled, className = '', closeClassName = '',
}: DialogHeaderProps) {
  const tc = useTranslations('common');
  return (
    <div className={cx('flex items-start justify-between gap-3', className)}>
      <div className="flex items-start gap-3 min-w-0">
        {icon}
        <div className="min-w-0">
          <h2 id={titleId} className="title-dialog">
            {title}
          </h2>
          {subtitle && <p className="text-sm text-text-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {onClose && (
        <IconButton
          label={tc('close')}
          onClick={onClose}
          disabled={closeDisabled}
          className={closeClassName}
          icon={<X className="w-4 h-4" aria-hidden="true" />}
        />
      )}
    </div>
  );
}
