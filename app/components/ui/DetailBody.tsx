'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { cx } from './cx';

interface SectionIndexEntry {
  /** The id of the section element the entry scrolls to. */
  id: string;
  label: string;
}

export interface DetailBodyProps {
  /** The sticky section index on the left (person page). Hidden below ~1180px. */
  index?: SectionIndexEntry[];
  /** The right rail (`DetailRail look="open"`). */
  rail?: React.ReactNode;
  /** The full-width hairline above the body that closes the top section (family, home). */
  divided?: boolean;
  className?: string;
  /** The main column. Its sections are separated by spacing only. */
  children: React.ReactNode;
}

/**
 * The v1.1 desktop detail body (#55): an optional sticky section index, one long
 * main column, and a right rail. From 768px the rail stays beside the main column
 * (it narrows instead of dropping to the bottom); the index appears from 1180px.
 * Phones don't use this: they keep their own panes.
 */
export function DetailBody({ index, rail, divided = false, className, children }: DetailBodyProps) {
  const hasIndex = index != null && index.length > 0;
  const main = useRef<HTMLDivElement>(null);
  return (
    <div className={cx('detail-body', hasIndex && 'detail-body--index', rail != null && 'detail-body--rail', divided && 'detail-body--divided', className)}>
      {hasIndex && <SectionIndex entries={index} mainRef={main} />}
      <div ref={main} className="detail-body__main">{children}</div>
      {rail != null && <aside className="detail-body__rail">{rail}</aside>}
    </div>
  );
}

/**
 * The sticky "On this page" list. The entry whose section is nearest the top of
 * the viewport is marked `aria-current`. The sections must sit inside the main column.
 */
function SectionIndex({ entries, mainRef }: { entries: SectionIndexEntry[]; mainRef: RefObject<HTMLDivElement | null> }) {
  const t = useTranslations('detailKit');
  const [current, setCurrent] = useState<string | null>(entries[0]?.id ?? null);

  useEffect(() => {
    const root = mainRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const ids = new Set(entries.map((e) => e.id));
    const els = Array.from(root.querySelectorAll<HTMLElement>('[id]')).filter((el) => ids.has(el.id));
    if (els.length === 0) return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver((records) => {
      for (const r of records) {
        if (r.isIntersecting) visible.set(r.target.id, r.boundingClientRect.top);
        else visible.delete(r.target.id);
      }
      const first = entries.find((e) => visible.has(e.id));
      if (first) setCurrent(first.id);
    }, { rootMargin: '-80px 0px -55% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [entries, mainRef]);

  return (
    <nav className="detail-body__index" aria-label={t('on_this_page')}>
      <ul className="m-0 p-0 list-none grid gap-0.5">
        {entries.map((e) => (
          <li key={e.id}>
            <a
              href={`#${e.id}`}
              aria-current={current === e.id ? 'location' : undefined}
              className="section-index__link block rounded-md px-2.5 py-1.5 text-sm no-underline focus-ring transition-colors"
            >
              {e.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
