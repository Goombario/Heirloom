'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cx } from './cx';
import { ActionLink } from './ActionLink';

export interface LeadTextProps {
  /** The text: the person's biography, the family's "About this family", the tree panel's preferred note. */
  children: React.ReactNode;
  /** Shows an Edit link after the expander when set (editors only). */
  onEdit?: () => void;
  /** The Edit link's label ("Edit biography", "Edit note"). */
  editLabel?: string;
  className?: string;
}

/**
 * Serif lead text clamped to three lines (#55). "Read all ⌄" shows only when the
 * text overflows, expands in place, and turns into "Show less". The same label is
 * used everywhere it appears (C3).
 */
export function LeadText({ children, onEdit, editLabel, className }: LeadTextProps) {
  const t = useTranslations('detailKit');
  const tc = useTranslations('common');
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setOverflows(el.scrollHeight - el.clientHeight > 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, children]);

  return (
    <div className={cx('lead-text', className)}>
      <div
        ref={ref}
        className="lead-text__body serif"
        data-open={open || undefined}
      >
        {children}
      </div>
      {(overflows || open || onEdit) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
          {(overflows || open) && (
            <ActionLink kind="expand" expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? t('show_less') : t('read_all')}
            </ActionLink>
          )}
          {onEdit && <ActionLink onClick={onEdit}>{editLabel ?? tc('edit')}</ActionLink>}
        </div>
      )}
    </div>
  );
}
