'use client';
import React, { useEffect } from 'react';
import { cx } from './cx';
import { usePageNotice } from './PageNotice';

export type PageShellVariant = 'list' | 'detail' | 'workspace';

/**
 * The content column for each variant. Exported so full-width chrome that
 * sits outside the column (the sticky `FormTopBar`) can align its contents
 * with it.
 * - `list` and `detail`: the locked boards' 1240 column with 28px gutters
 *   (list and utility pages; record pages and the forms that create them).
 * - `workspace`: the same column, shared with the top nav, so a toolbar title lines up with
 *   the wordmark (`TopRail`).
 */
export const PAGE_COLUMN: Record<PageShellVariant, string> = {
  list: 'mx-auto w-full max-w-[1240px] px-4 sm:px-6 md:px-[28px]',
  detail: 'mx-auto w-full max-w-[1240px] px-4 md:px-[28px]',
  workspace: 'mx-auto w-full max-w-[1240px] px-4 md:px-[28px]',
};

const COLUMN_PADDING: Record<PageShellVariant, string> = {
  list: 'py-6',
  detail: 'py-[24px]',
  workspace: '',
};

export interface PageShellProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  /** Defaults to `list`. Switching Library to `workspace` later is this one prop. */
  variant?: PageShellVariant;
  /**
   * The page title, rendered as the page's `h1` in the page-title recipe
   * (`.title`, serif 28). Leave it out when the page renders its own title:
   * record heroes (`detail`), the Tree toolbar (`workspace`) and form bars.
   */
  title?: React.ReactNode;
  titleId?: string;
  /** Extra classes for the title block, e.g. `max-md:hidden` under a phone list header. */
  titleClassName?: string;
  /** Muted line under the title (counts, descriptions). */
  subtitle?: React.ReactNode;
  /** The CTA slot, top-right of the title block. */
  actions?: React.ReactNode;
  /**
   * Full-width chrome above the content column, such as the sticky
   * `FormTopBar`. Align its contents with `PAGE_COLUMN[variant]`.
   */
  topBar?: React.ReactNode;
  /** Full-width chrome after the content column: a form's `MobileFormFooter`. */
  footer?: React.ReactNode;
  /** Sets aria-busy on the shell for the loading-paint views. */
  busy?: boolean;
  /** Extra classes for the `list`/`detail` content column (e.g. a page-specific grid). */
  contentClassName?: string;
}

/**
 * Publishes the classic scrollbar's width as `--sbw` on the root, so the
 * full-bleed band (`CoverBand`) stops at the scrollbar instead of running under it.
 */
function useScrollbarWidth() {
  useEffect(() => {
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--sbw', `${Math.max(0, window.innerWidth - root.clientWidth)}px`);
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(document.body);
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, []);
}

/**
 * The page shell (#689). Renders the page's single `<main>` on the parchment
 * surface, a centred content column per variant, and, for `list` pages, the
 * title block (title and subtitle on the left, CTA top-right). There is no
 * white header band: titles sit on the parchment.
 *
 * `workspace` is full width with no column padding. The page lays out its own
 * toolbar and canvas; `PAGE_COLUMN.workspace` aligns a toolbar with the header.
 */
export function PageShell({
  variant = 'list',
  title,
  titleId,
  titleClassName,
  subtitle,
  actions,
  topBar,
  footer,
  busy,
  className = '',
  contentClassName = '',
  children,
  ...rest
}: PageShellProps) {
  const notice = usePageNotice();
  useScrollbarWidth();
  const titleBlock =
    title != null ? (
      <div className={cx('flex flex-wrap items-start justify-between gap-4 mb-5', titleClassName)}>
        <div className="min-w-0">
          <h1 id={titleId} className="title">{title}</h1>
          {subtitle && <div className="page-subtitle">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0 max-w-full">{actions}</div>}
      </div>
    ) : null;

  return (
    <main
      // The skip link's target (#798, KB-1); -1 lets following the link focus it.
      id="main-content"
      tabIndex={-1}
      className={cx('min-h-app bg-[color:var(--surface)]', className)}
      aria-busy={busy || undefined}
      data-page-shell={variant}
      {...rest}
    >
      {topBar}
      {notice}
      {variant === 'workspace' ? (
        <>
          {titleBlock && <div className={PAGE_COLUMN.workspace}>{titleBlock}</div>}
          {children}
        </>
      ) : (
        <div className={cx(PAGE_COLUMN[variant], COLUMN_PADDING[variant], contentClassName)}>
          {titleBlock}
          {children}
        </div>
      )}
      {footer}
    </main>
  );
}
