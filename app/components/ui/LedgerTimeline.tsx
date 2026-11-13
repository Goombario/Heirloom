'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import GuardedLink from '@/app/components/GuardedLink';
import { ArrowUpRight, ChevronUp } from '@/lib/icons';
import { cx } from './cx';
import { Button } from './Button';

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
  /**
   * An event edited on another page (a relative's marriage, a child's birth): the
   * row opens in place into a read-only panel (navy rule) with its date, place and
   * people, then "Edit on X's page ↗" and Close. Same as the place page's records.
   */
  readOnly?: LedgerReadOnly;
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
  /** Hover controls (Edit, Delete), top-right of the row. Not shown with `onOpen`. */
  actions?: ReactNode;
  /**
   * The row opens its editor (locked person board): the whole row is the click
   * target and the title is the keyboard control, named `openLabel` ("Edit
   * Occupation"). Delete then lives in the editor, so `actions` is dropped.
   */
  onOpen?: () => void;
  openLabel?: string;
  /** Replaces the row's body: the inline editor. The date column stays. */
  override?: ReactNode;
}

interface LedgerReadOnly {
  /** The formatted date, for the panel's Date column. */
  date?: ReactNode;
  /** The place, for the panel's Place column. */
  place?: ReactNode;
  /** The people the event names (faces and names). */
  people?: ReactNode;
  /** Where the event is edited; left out for readers who can't edit. */
  editHref?: string;
  editLabel?: string;
}

/**
 * The read-only panel an event edited elsewhere opens into (fix 01): its date and
 * place, its people, then "Edit on X's page ↗" and Close. The place page's records
 * use it too, so every timeline opens a foreign record the same way.
 */
function LedgerReadOnlyPanel({ ro, onClose }: { ro: LedgerReadOnly; onClose: () => void }) {
  const t = useTranslations('detailKit');
  return (
    <div className="ledger-ro">
      {(ro.date || ro.place) && (
        <dl className="ledger-ro__kv">
          {ro.date && <div><dt>{t('ro_date')}</dt><dd className="date-mono">{ro.date}</dd></div>}
          {ro.place && <div><dt>{t('ro_place')}</dt><dd>{ro.place}</dd></div>}
        </dl>
      )}
      {ro.people && <div className="ledger-ro__people">{ro.people}</div>}
      <div className="ledger-ro__foot">
        {ro.editHref ? (
          <GuardedLink href={ro.editHref} className="ledger-ro__edit focus-ring rounded-sm">
            {ro.editLabel}
            <ArrowUpRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          </GuardedLink>
        ) : <span />}
        <Button variant="outline" size="sm" onClick={onClose}>{t('ro_close')}</Button>
      </div>
    </div>
  );
}

/**
 * The v1.1 desktop timeline (locked person and family boards): a date column (the
 * year in amber mono over the day and month), a hairline rule with small dots (filled
 * for birth and death), then the event with its thumbnails on the right. Long lists
 * fold after the first `head` rows: each run of hidden rows becomes one
 * "… N more events 1920 – 1940" line, and the rows named in `keep` (the death that
 * closes a life, the end of a partnership) stay in view between them.
 */
export function LedgerTimeline({ items, head = 5, keep = [], className }: {
  items: LedgerItem[];
  /** Rows shown before the fold. */
  head?: number;
  /** Keys of rows kept in view below the fold. */
  keep?: string[];
  className?: string;
}) {
  const t = useTranslations('detailKit');
  const [expanded, setExpanded] = useState(false);
  const kept = new Set(keep);
  const hides = (it: LedgerItem, i: number) => i >= head && !kept.has(it.key);
  const hiddenCount = items.filter(hides).length;
  // Folding a single row saves nothing; an open editor below the fold keeps it open.
  const foldable = hiddenCount > 1;
  const folded = foldable && !expanded && !items.some((it, i) => hides(it, i) && it.override);

  // The rows in view, with each run of hidden rows as one fold line.
  const parts: Array<{ row: LedgerItem } | { run: LedgerItem[] }> = [];
  items.forEach((it, i) => {
    if (!folded || !hides(it, i)) { parts.push({ row: it }); return; }
    const last = parts[parts.length - 1];
    if (last && 'run' in last) last.run.push(it);
    else parts.push({ run: [it] });
  });

  return (
    <div className={cx('ledger', className)}>
      <ol className="ledger__list">
        {parts.map((part) => 'row' in part
          ? <Row key={part.row.key} it={part.row} />
          : <Fold key={`fold-${part.run[0].key}`} run={part.run} onOpen={() => setExpanded(true)} label={t('more_events', { count: part.run.length })} aria={t('show_more_events', { count: part.run.length })} />)}
      </ol>
      {foldable && expanded && (
        <button type="button" className="ledger__fewer focus-ring" onClick={() => setExpanded(false)}>
          {t('show_fewer')}<ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function Fold({ run, onOpen, label, aria }: { run: LedgerItem[]; onOpen: () => void; label: string; aria: string }) {
  const years = run.map((h) => h.sortYear).filter((y): y is number => y != null);
  const range = years.length ? (years[0] === years[years.length - 1] ? String(years[0]) : `${years[0]} – ${years[years.length - 1]}`) : '';
  return (
    <li>
      <button type="button" className="ledger__fold focus-ring" onClick={onOpen} aria-label={aria}>
        <span />
        <span className="ledger__rule ledger__rule--dashed" aria-hidden="true" />
        <span className="ledger__fold-body">
          <span className="ledger__fold-dots" aria-hidden="true">…</span>
          <span className="ledger__fold-label">{label}</span>
          {range && <span className="ledger__fold-range">{range}</span>}
        </span>
      </button>
    </li>
  );
}

function Row({ it }: { it: LedgerItem }) {
  const [roOpen, setRoOpen] = useState(false);
  if (it.readOnly) return <ReadOnlyRow it={it} open={roOpen} setOpen={setRoOpen} />;
  const title = it.href ? (
    <GuardedLink href={it.href} className="ledger__title-link focus-ring rounded-sm">
      {it.title}
      <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-text-muted" aria-hidden="true" />
    </GuardedLink>
  ) : it.onOpen ? (
    <button type="button" className="ledger__title-btn focus-ring rounded-sm" aria-label={it.openLabel} onClick={it.onOpen}>{it.title}</button>
  ) : it.title;
  // A click anywhere on the row opens it, except on its own links and buttons
  // (the place, a citation pin, a thumbnail), which keep their own action.
  const openFromRow = it.onOpen && !it.href ? (e: React.MouseEvent) => {
    if ((e.target as Element).closest('a, button, input, select, textarea, [role="button"], [role="dialog"]')) return;
    it.onOpen?.();
  } : undefined;
  return (
    <li id={it.anchor} data-testid={`timeline-${it.key}`} className={cx('ledger__ev', it.flagged && 'is-flagged', it.override != null && 'is-editing')}>
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
            <div className={cx('ledger__body row-host', openFromRow && 'is-click')} onClick={openFromRow}>
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
              {it.actions && !it.href && !it.onOpen && <div className="ledger__actions">{it.actions}</div>}
            </div>
            {it.below && <div className="ledger__below">{it.below}</div>}
          </>
        )}
      </div>
    </li>
  );
}

/** A row for an event edited on another page: it opens in place, read-only. */
function ReadOnlyRow({ it, open, setOpen }: { it: LedgerItem; open: boolean; setOpen: (v: boolean) => void }) {
  const toggleFromRow = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('a, button, input, select, textarea, [role="button"], [role="dialog"], .ledger-ro')) return;
    setOpen(!open);
  };
  return (
    <li id={it.anchor} data-testid={`timeline-${it.key}`} className={cx('ledger__ev', open && 'is-ro-open')}>
      <span className="ledger__when">
        {it.year != null && it.year !== '' && <span className={cx('ledger__year', it.ghost && 'is-ghost')}>{it.year}</span>}
        {it.day && <span className="ledger__day">{it.day}</span>}
      </span>
      <span className="ledger__rule" aria-hidden="true">
        <span className={cx('ledger__dot', it.vital && 'is-vital', it.ghost && 'is-ghost')} />
      </span>
      <div className="min-w-0">
        <div className={cx('ledger__body row-host is-click', open && 'is-ro')} onClick={toggleFromRow}>
          <div className="ledger__lines">
            <div className="ledger__head">
              <span className="ledger__title">
                <button type="button" className="ledger__title-btn focus-ring rounded-sm" aria-expanded={open} onClick={() => setOpen(!open)}>{it.title}</button>
              </span>
              {it.age && <span className="ledger__age">{it.age}</span>}
              {it.citations}
            </div>
            {it.place && <div className="ledger__place">{it.place}</div>}
            {open && it.readOnly && <LedgerReadOnlyPanel ro={it.readOnly} onClose={() => setOpen(false)} />}
          </div>
          {it.thumbs ? <div className="ledger__thumbs">{it.thumbs}</div> : <span />}
        </div>
      </div>
    </li>
  );
}
