'use client';

// The in-app key for the geocode-state marks (#266). The three shapes were
// colorblind-safe from day one but nowhere explained, so a user met ● ◇ ○ with no
// way to decode them. Reads its rows from PinMark's canonical state list, so a
// fourth state can never ship with the legend still teaching three.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Card } from '@/app/components/ui/Card';
import { Info } from '@/lib/icons';
import { PinMark, PIN_STATES, PIN_STATE_LABEL_KEY } from './PinMark';

export function PinLegend({ className = '' }: { className?: string }) {
  const t = useTranslations('places');
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Esc and click-outside close it — the same dismissal contract as the pin
  // popover in LocationField, so the two behave alike.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
    }
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (boxRef.current && !boxRef.current.contains(target)) setOpen(false);
    }
    const onResize = () => setOpen(false);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={() => {
          const r = triggerRef.current?.getBoundingClientRect();
          if (r) setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
          setOpen((v) => !v);
        }}
        title={t('pin_legend_title')}
        // Starts with the visible word, so voice control can say it (WCAG 2.5.3, #21).
        aria-label={`${t('pin_legend')}, ${t('pin_legend_title')}`}
        className="control-h inline-flex items-center gap-1.5 px-2 sm:px-2.5 rounded-lg border border-[color:var(--color-control-border)] text-xs text-text-secondary cursor-pointer hover:bg-surface-2 transition-colors focus-ring"
      >
        <Info size={14} aria-hidden="true" />
        {/* Icon-only below `sm`. The header row is already search + a four-way view
            toggle; the label's ~26px pushed the row past a 375px viewport and gave
            the whole page a horizontal scrollbar. `aria-label` above keeps the
            button named when the text is hidden. */}
        <span className="hidden sm:inline">{t('pin_legend')}</span>
      </button>
      {open && pos && createPortal(
        /* Right-anchored: the trigger sits at the end of the header row, so a
           left-anchored panel would hang off the viewport on a narrow screen.
           Portalled to <body>, as the tree bar's menus are: the Places bar is a dark
           island, and a panel inside it would inherit the island's translucent card.
           The positioning wrapper holds the ref because `Card` forwards none. */
        <div ref={boxRef} className="fixed z-50 w-[min(19rem,calc(100vw-2rem))]" style={{ top: pos.top, right: pos.right }}>
          <Card pad={false} className="p-3 shadow-[var(--shadow-float)]!">
            <div className="eyebrow mb-2">
              {t('pin_legend_title')}
            </div>
            <dl className="flex flex-col gap-2">
              {PIN_STATES.map((state) => (
                <div key={state} className="flex items-start gap-2.5">
                  {/* Fixed-width cell so the three marks line up despite differing
                      glyph widths — a ragged key is harder to read than no key. */}
                  <dt className="w-4 flex justify-center pt-0.5 shrink-0">
                    <PinMark state={state} />
                  </dt>
                  <dd className="min-w-0 text-xs text-text-secondary">
                    {t(PIN_STATE_LABEL_KEY[state])}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>,
        document.body,
      )}
    </div>
  );
}
