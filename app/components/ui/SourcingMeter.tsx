'use client';
import { useId, useState } from 'react';
import { Info } from '@/lib/icons';
import { cx } from './cx';

interface SourcingMeterProps {
  sourced: number;
  total: number;
  /** Visible text beside the meter, e.g. t('facts_sourced') → "2/4 facts sourced".
   *  It names what the bar measures, so it doubles as the accessible text. */
  label: string;
  /** Optional explanation of what counts, shown by an ⓘ toggletip after the label. */
  info?: { label: string; text: string };
  className?: string;
}

/** Above this many facts the segments get too thin to count, so it becomes a bar. */
const MAX_SEGMENTS = 8;

/**
 * How many of a record's facts carry at least one citation, as a 96px meter in
 * evidence amber followed by its label ("2/4 facts sourced"; audit §13 addendum,
 * 2026-09-23). One segment per fact up to 8, then a continuous bar. Renders
 * nothing for a record with no facts; callers show their own placeholder.
 */
export function SourcingMeter({ sourced, total, label, info, className = '' }: SourcingMeterProps) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  if (total <= 0) return null;
  const filled = Math.min(Math.max(sourced, 0), total);
  return (
    <span className={cx('sourcing-meter', className)} data-complete={filled >= total}>
      {total <= MAX_SEGMENTS ? (
        <span className="sm-track" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => <i key={i} data-on={i < filled ? '' : undefined} />)}
        </span>
      ) : (
        <span className="sm-bar" aria-hidden="true">
          <i style={{ width: `${(filled / total) * 100}%` }} />
        </span>
      )}
      <span>{label}</span>
      {info && (
        // Toggletip: click (or Enter/Space) shows the explanation in a live region;
        // Escape or leaving the button hides it.
        <span className="sm-info">
          <button
            type="button"
            className="sm-info-btn focus-ring"
            aria-label={info.label}
            aria-expanded={open}
            aria-controls={tipId}
            onClick={() => setOpen((o) => !o)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          >
            <Info width={15} height={15} aria-hidden="true" />
          </button>
          <span id={tipId} role="status" className="sm-info-tip" hidden={!open}>
            {open ? info.text : ''}
          </span>
        </span>
      )}
    </span>
  );
}
