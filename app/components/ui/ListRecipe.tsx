'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Search } from '@/lib/icons';
import { Card } from './Card';
import { IconButton } from './IconButton';
import { Input } from './Input';
import { cx } from './cx';

/**
 * True when a key press belongs to something else: a field, or a dialog or popover
 * over the list (a FormDialog, a finder). The page shortcut must leave it alone.
 */
function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return el.closest('[role="dialog"]') != null || el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.getAttribute('role') === 'combobox';
}

/**
 * The v1.1 list toolbar (#55), on the parchment under the short band: a search box
 * that `/` focuses, then the filter chips and selects, then the page's one main
 * button on the right (copper, C5). It wraps on narrow windows.
 */
export function ListToolbar({ search, onSearchChange, searchLabel, filters, action, className }: {
  search: string;
  onSearchChange: (value: string) => void;
  /** The search box's name and placeholder ("Search people"). */
  searchLabel: string;
  /** `FilterChip`s with counts, then `Select`s. */
  filters?: React.ReactNode;
  /** The one main button ("Add person"). */
  action?: React.ReactNode;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || typingIn(e.target)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    // Capture phase, so this runs before the global search's own `/` (#59).
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    // From 720px the main button keeps its place at the right; the chips wrap
    // among themselves instead of pushing it onto a line of its own.
    <div className={cx('list-toolbar flex flex-wrap min-[720px]:flex-nowrap items-center gap-x-3 gap-y-2.5', className)}>
      <div className="list-toolbar__search relative w-full min-[720px]:w-[230px] shrink-0">
        <Input
          ref={inputRef}
          type="search"
          size="md"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchLabel}
          aria-label={searchLabel}
          aria-keyshortcuts="/"
          icon={<Search className="w-4 h-4" aria-hidden="true" />}
          className="pr-8"
        />
        {/* The `/` hint; it hides while the box has focus or text (CSS). */}
        {!search && <kbd aria-hidden="true" className="list-toolbar__kbd">/</kbd>}
      </div>
      {filters && <div className="flex flex-wrap items-center gap-1.5 min-w-0 min-[720px]:flex-1">{filters}</div>}
      {action && <div className="ml-auto flex items-center gap-2 shrink-0 self-start">{action}</div>}
    </div>
  );
}

/**
 * The page numbers a pager shows: the first and last page, the current page and
 * its neighbours, with `null` for a gap ("1 2 3 … 9", "1 … 4 5 6 … 9").
 */
function pageList(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const lo = Math.max(2, Math.min(page - 1, pages - 4));
  const hi = Math.min(pages - 1, Math.max(page + 1, 5));
  const out: (number | null)[] = [1];
  if (lo > 2) out.push(null);
  for (let n = lo; n <= hi; n++) out.push(n);
  if (hi < pages - 1) out.push(null);
  out.push(pages);
  return out;
}

/**
 * The white panel that holds a list page's `DataTable`, with the pager in its
 * footer: "1–25 of 412" and ‹ ›. The footer hides when everything fits on one page.
 * `header` is a bar across the panel's top, above the table (the audit log's
 * "2 selected · Revert 2 changes · Clear").
 */
export function TablePanel({ children, header, page, pageSize, total, onPage, className }: {
  children: React.ReactNode;
  header?: React.ReactNode;
  /** 1-based. */
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  className?: string;
}) {
  const t = useTranslations('detailKit');
  const tc = useTranslations('common');
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <Card pad={false} className={cx('table-panel overflow-hidden', className)}>
      {header && <div className="border-b border-border-light bg-card-alt px-3.5 py-2">{header}</div>}
      <div className="overflow-x-auto">{children}</div>
      {pages > 1 && (
        <div className="flex items-center gap-2 border-t border-border-light px-4 py-2">
          <span className="text-meta text-text-muted tabular-nums mr-auto" aria-live="polite">{t('range_of', { from, to, total })}</span>
          <nav aria-label={t('pagination')} className="pager flex items-center gap-1">
            <IconButton label={tc('previous')} onClick={() => onPage(page - 1)} disabled={page <= 1} icon={<ChevronLeft className="w-4 h-4" aria-hidden="true" />} />
            {pageList(page, pages).map((n, i) => n === null
              ? <span key={`gap-${i}`} className="pager__gap" aria-hidden="true">…</span>
              : (
                <button
                  key={n}
                  type="button"
                  className={cx('pager__num', n === page && 'is-current')}
                  aria-current={n === page ? 'page' : undefined}
                  aria-label={tc('page_of', { current: n, total: pages })}
                  onClick={() => onPage(n)}
                >
                  {n}
                </button>
              ))}
            <IconButton label={tc('next')} onClick={() => onPage(page + 1)} disabled={page >= pages} icon={<ChevronRight className="w-4 h-4" aria-hidden="true" />} />
          </nav>
        </div>
      )}
    </Card>
  );
}
