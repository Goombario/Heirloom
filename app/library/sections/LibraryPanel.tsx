'use client';

import type { ReactNode } from 'react';
import { cx } from '@/app/components/ui/cx';

/** The open page under the Library tabs (#1152): the floating panel, then the tab's content. */
export const LIBRARY_BODY_GRID = 'grid grid-cols-[220px_minmax(0,1fr)] items-start gap-7';

/**
 * The Library's floating filter panel (#1152, locked mockup v6 for #444). It floats on the
 * parchment page as a white panel with 16px corners, a border and a soft shadow, and
 * stays in view while the list scrolls (#1175). Sources, Photos and Faces all
 * put their filters in it. Desktop and tablet only; phones have their own Library.
 */
export default function LibraryPanel({
  label,
  children,
  className,
  testId,
}: {
  /** Names the panel for screen readers ("Filter sources"). */
  label: string;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <aside
      aria-label={label}
      data-testid={testId}
      className={cx(
        'library-panel sticky top-[calc(var(--nav-h)+16px)] self-start max-h-[calc(100dvh-var(--nav-h)-32px)] overflow-y-auto scroll-area',
        'rounded-panel border border-border bg-card shadow-[var(--shadow-float)] px-3 py-4 text-sm',
        className,
      )}
    >
      {children}
    </aside>
  );
}

/** A labelled group of rows in the panel ("Show", "Type", "Repository"). */
export function LibraryPanelGroup({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={typeof title === 'string' ? title : undefined} className={cx('mt-4 flex flex-col gap-0.5 first:mt-0', className)}>
      <div className="eyebrow mb-1.5 ml-2">{title}</div>
      {children}
    </div>
  );
}

/**
 * One filter row: label left, count right. The selected row takes the parchment
 * fill (#1175). `warn` puts the count in amber (Uncited, Untagged).
 */
export function LibraryPanelRow({
  label,
  count,
  active,
  onClick,
  warn = false,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  warn?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'flex w-full min-h-8 items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm text-text cursor-pointer transition-colors focus-ring',
        active ? 'bg-surface font-semibold' : 'hover:bg-hover-surface',
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      {count != null && (
        <span className={cx('shrink-0 text-xs tabular-nums', warn && count > 0 ? 'text-evidence font-medium' : 'text-text-muted')}>{count}</span>
      )}
    </button>
  );
}

/** A quiet link-style action at the foot of the panel ("Add repository"). */
export function LibraryPanelLink({ children, onClick, icon }: { children: ReactNode; onClick: () => void; icon?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-h-8 items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm text-link cursor-pointer hover:bg-hover-surface hover:underline focus-ring"
    >
      {icon}
      {children}
    </button>
  );
}
