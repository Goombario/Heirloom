'use client';

import { useState } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import 'react-day-picker/style.css';
import { Calendar, ChevronDown } from '@/lib/icons';

interface AuditDateRangeLabels {
  date: string;
  anyDate: string;
  today: string;
  hint: string;
}

export interface AuditDateRangeProps {
  from?: string;
  to?: string;
  onChange: (range: { from?: string; to?: string }) => void;
  /** ISO (yyyy-mm-dd) dates that have entries — rendered with a dot. */
  entryDates?: Set<string>;
  labels: AuditDateRangeLabels;
}

/** Local-date ISO string (no timezone shift). */
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fromISO(s?: string): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}
function fmt(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Date-range filter: a chip button that opens a themed react-day-picker popover. */
export function AuditDateRange({ from, to, onChange, entryDates, labels }: AuditDateRangeProps) {
  const [open, setOpen] = useState(false);
  const selected: DateRange | undefined = from ? { from: fromISO(from), to: fromISO(to) } : undefined;

  const buttonLabel = (() => {
    const f = fromISO(from);
    if (!f) return labels.anyDate;
    const tt = fromISO(to);
    if (!tt || toISO(tt) === toISO(f)) return fmt(f);
    return `${fmt(f)} – ${fmt(tt)}`;
  })();

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="gap-[6px] border border-[color:var(--border)] rounded-[8px] px-[11px] py-[6px] text-meta"
        style={{ display: 'inline-flex', alignItems: 'center', background: 'var(--card)', color: 'var(--text)', cursor: 'pointer' }}
      >
        <Calendar size={14} aria-hidden style={{ color: 'var(--text-muted)' }} />
        <span style={{ color: 'var(--text-muted)' }}>{labels.date}</span>
        <span className="font-semibold">{buttonLabel}</span>
        <ChevronDown size={14} aria-hidden style={{ color: 'var(--text-muted)' }} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} className="z-40" style={{ position: 'fixed', inset: 0 }} aria-hidden />
          <div
            className="audit-daterange z-[41] border border-[color:var(--border)] rounded-[12px] p-3"
            style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, background: 'var(--card)', boxShadow: 'var(--shadow-lg)' }}
          >
            <DayPicker
              mode="range"
              selected={selected}
              onSelect={(range) =>
                onChange({ from: range?.from ? toISO(range.from) : undefined, to: range?.to ? toISO(range.to) : undefined })
              }
              modifiers={{ hasEntries: (date) => !!entryDates?.has(toISO(date)) }}
              modifiersClassNames={{ hasEntries: 'rdp-has-entries' }}
            />
            <div className="mt-1 text-[10.5px]" style={{ color: 'var(--text-muted)', textAlign: 'center' }}>{labels.hint}</div>
            <div className="mt-2 border-t border-t-[color:var(--border-light)] pt-2" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button
                type="button"
                onClick={() => { onChange({ from: undefined, to: undefined }); setOpen(false); }}
                className="text-meta"
                style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {labels.anyDate}
              </button>
              <button
                type="button"
                onClick={() => { const t = toISO(new Date()); onChange({ from: t, to: t }); setOpen(false); }}
                className="text-meta font-medium"
                style={{ color: 'var(--color-link)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {labels.today}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
