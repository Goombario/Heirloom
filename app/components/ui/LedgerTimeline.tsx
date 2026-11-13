'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import GuardedLink from '@/app/components/GuardedLink';
import { ArrowUpRight, ChevronUp } from '@/lib/icons';
import { cx } from './cx';

export interface LedgerItem {
  key: string;
  /** The row's element id, for links to it ("#birth", "#event-44"). */
  anchor?: string;
  /** The date column's first line: the year in amber mono ("1893", "~1889"); "?" when unknown. */
  year?: ReactNode;
  /** The date column's second line: day and month, muted. */
  day?: ReactNode;
  /** The year as a number, for the fold's "1920 – 1940" range. */
  sortYear?: number | null;
  /** Birth and death: a filled dot on the rule. */
  vital?: boolean;
  /** A row standing in for a fact that isn't recorded (dashed dot, muted "?"). */
  ghost?: boolean;
  title: ReactNode;
  /** A relative's event shown read-only: the title links to where it is edited, with ↗. */
  href?: string;
  /** "age 15", muted beside the title. */
  age?: ReactNode;
  /** Citation pins, beside the title. */
  citations?: ReactNode;
  /** The "Check this date" mark, on the title line. */
  mark?: ReactNode;
  /** The panel the mark opens, under the title block. */
  callout?: ReactNode;
  /** A data check would have you fix this row's date: the warning tint. */
  flagged?: boolean;
  /** The place line (a link to the place, with a pin). */
  place?: ReactNode;
  /** Further lines: a death's cause, an event's description. */
  lines?: ReactNode;
  /** Up to three 52px thumbnails, on the right. */
  thumbs?: ReactNode;
  /** Under the row: the "2 notes ⌄" toggle and what it opens. */
  below?: ReactNode;
  /** Hover controls (Edit, Delete), top-right of the row. */
  actions?: ReactNode;
  /** Replaces the row's body: the inline editor. The date column stays. */
  override?: ReactNode;
}

/**
 * The v1.1 desktop timeline (locked person board): a date column (the year in
 * amber mono over the day and month), a hairline rule with small dots (filled for
 * birth and death), then the event with its thumbnails on the right. Long lists
 * fold after the first `head` rows into "… N more events 1920 – 1940", keeping
 * the last `pinned` rows (the death, and any undated rows after it) in view.
 */
export function LedgerTimeline({ items, head = 5, pinned = 0, className }: {
  items: LedgerItem[];
  /** Rows shown before the fold. */
  head?: number;
  /** Rows kept in view below the fold: the death that closes the life, and what follows it. */
  pinned?: number;
  className?: string;
}) {
  const t = useTranslations('detailKit');
  const [expanded, setExpanded] = useState(false);
  const foldable = items.length > head + pinned + 1;
  // An open editor below the fold keeps the list open.
  const editingHidden = items.slice(head, items.length - pinned).some((it) => it.override);
  const folded = foldable && !expanded && !editingHidden;

  const hidden = folded ? items.slice(head, items.length - pinned) : [];
  const years = hidden.map((h) => h.sortYear).filter((y): y is number => y != null);
  const range = years.length ? (years[0] === years[years.length - 1] ? String(years[0]) : `${years[0]} – ${years[years.length - 1]}`) : '';

  const rows = folded ? items.slice(0, head) : items;
  return (
    <div className={cx('ledger', className)}>
      <ol className="ledger__list">
        {rows.map((it) => <Row key={it.key} it={it} />)}
        {folded && (
          <li>
            <button type="button" className="ledger__fold focus-ring" onClick={() => setExpanded(true)} aria-label={t('show_more_events', { count: hidden.length })}>
              <span />
              <span className="ledger__rule ledger__rule--dashed" aria-hidden="true" />
              <span className="ledger__fold-body">
                <span className="ledger__fold-dots" aria-hidden="true">…</span>
                <span className="ledger__fold-label">{t('more_events', { count: hidden.length })}</span>
                {range && <span className="ledger__fold-range">{range}</span>}
              </span>
            </button>
          </li>
        )}
        {folded && items.slice(items.length - pinned).map((it) => <Row key={it.key} it={it} />)}
      </ol>
      {foldable && expanded && (
        <button type="button" className="ledger__fewer focus-ring" onClick={() => setExpanded(false)}>
          {t('show_fewer')}<ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function Row({ it }: { it: LedgerItem }) {
  const title = it.href ? (
    <GuardedLink href={it.href} className="ledger__title-link focus-ring rounded-sm">
      {it.title}
      <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-text-muted" aria-hidden="true" />
    </GuardedLink>
  ) : it.title;
  return (
    <li id={it.anchor} className={cx('ledger__ev', it.flagged && 'is-flagged', it.override != null && 'is-editing')}>
      <span className="ledger__when">
        {it.year != null && it.year !== '' && <span className={cx('ledger__year', it.ghost && 'is-ghost')}>{it.year}</span>}
        {it.day && <span className="ledger__day">{it.day}</span>}
      </span>
      <span className="ledger__rule" aria-hidden="true">
        <span className={cx('ledger__dot', it.vital && 'is-vital', it.ghost && 'is-ghost')} />
      </span>
      <div className="min-w-0">
        {it.override ?? (
          <>
            <div className="ledger__body row-host">
              <div className="ledger__lines">
                <div className="ledger__head">
                  <span className="ledger__title">{title}</span>
                  {it.age && <span className="ledger__age">{it.age}</span>}
                  {it.citations}
                  {it.mark}
                </div>
                {/* The panel the mark opens is the next Tab stop after it (#843). */}
                {it.callout && <div className="ledger__callout">{it.callout}</div>}
                {it.place && <div className="ledger__place">{it.place}</div>}
                {it.lines && <div className="ledger__note">{it.lines}</div>}
              </div>
              {it.thumbs ? <div className="ledger__thumbs">{it.thumbs}</div> : <span />}
              {it.actions && !it.href && <div className="ledger__actions">{it.actions}</div>}
            </div>
            {it.below && <div className="ledger__below">{it.below}</div>}
          </>
        )}
      </div>
    </li>
  );
}
