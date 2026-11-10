'use client';

import React from 'react';
import { cx } from './cx';

export interface DialogActionsProps {
  children: React.ReactNode;
  /** 'end' (default) → right-aligned buttons; 'between' → split (e.g. count + actions). */
  justify?: 'end' | 'between';
  className?: string;
}

/**
 * The modal footer action bar — the `border-t bg-card-alt` button row repeated across
 * the `Modal` consumers (#175 Wave 4). Pass the buttons as children.
 */
export function DialogActions({ children, justify = 'end', className = '' }: DialogActionsProps) {
  return (
    <div
      className={cx(
        'flex items-center gap-3 p-4 border-t border-border bg-card-alt',
        justify === 'between' ? 'justify-between' : 'justify-end',
        className,
      )}
    >
      {children}
    </div>
  );
}
