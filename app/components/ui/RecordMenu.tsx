'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Ellipsis } from '@/lib/icons';
import { cx } from './cx';
import { useMenuKeyboard } from './useMenuKeyboard';

export interface RecordMenuItem {
  label: string;
  onSelect: () => void;
  icon?: React.ReactNode;
  /** Red text, for Delete. Contributors never get these (the caller leaves them out). */
  danger?: boolean;
  /** Shown dimmed and inert, with `disabledReason` under the label. */
  disabled?: boolean;
  /** Why the item can't be used now ("Only when no records use it. 112 do."). */
  disabledReason?: string;
  /** A rule above this item. */
  separated?: boolean;
}

export interface RecordMenuProps {
  /** The record's name, for "More actions for Anna Lindqvist". */
  recordName: string;
  /** Viewers pass no items, and the menu renders nothing. */
  items: RecordMenuItem[];
  /** `island` on a cover band (55% white edge), `surface` on a white panel or the parchment. */
  tone?: 'island' | 'surface';
  /** `hover` hides the trigger until its row is hovered or focused (journal entries, #58). */
  reveal?: 'always' | 'hover';
  className?: string;
}

/**
 * The one ⋯ menu for a record (#55): Person (Edit person, Descendants, Delete person),
 * Family (Edit family, Delete family), Place, a Research case and its leads. A
 * `role="menu"` popover with `useMenuKeyboard`; a pointer dismissal leaves focus
 * where the pointer went. Disabled items stay in the list with their reason.
 */
export function RecordMenu({ recordName, items, tone = 'surface', reveal = 'always', className }: RecordMenuProps) {
  const t = useTranslations('detailKit');
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const close = (returnFocus: boolean) => { setOpen(false); if (returnFocus) trigger.current?.focus(); };
  const onKeyDown = useMenuKeyboard({ open, menuRef: menu, onClose: close });
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // The popup is portalled to <body> so a menu opened from a cover band doesn't
  // inherit the dark island's tokens: it's a white page menu in both themes.

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (wrap.current?.contains(target) || menu.current?.contains(target)) return;
      setOpen(false);
    };
    const onMove = () => setOpen(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  if (items.length === 0) return null;
  const label = t('more_actions_for', { name: recordName });

  return (
    <div ref={wrap} className={cx('relative inline-block', reveal === 'hover' && !open && 'record-menu--hover', className)}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) { setOpen(false); return; }
          const r = trigger.current?.getBoundingClientRect();
          if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
          setOpen(true);
        }}
        className={cx(
          'grid place-items-center w-9 h-9 rounded-btn border cursor-pointer focus-ring transition-colors',
          tone === 'island'
            ? 'border-[color:var(--color-control-border)] text-[color:var(--color-text)] hover:bg-[color:var(--color-surface-2)]'
            : cx('border-border text-text-secondary bg-card hover:bg-hover-surface', open && 'bg-surface-2 text-text'),
        )}
      >
        <Ellipsis className="w-4 h-4" aria-hidden="true" />
      </button>
      {open && pos && createPortal(
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="record-menu__popup fixed z-50 w-64 rounded-lg border border-border bg-card p-1.5 shadow-[var(--shadow-lg)] text-left text-text"
          style={{ top: pos.top, right: pos.right }}
        >
          {items.map((item) => (
            <div key={item.label}>
              {item.separated && <div className="h-px bg-border my-1.5 mx-1" role="separator" />}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled || undefined}
                onClick={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  item.onSelect();
                }}
                className={cx(
                  'flex w-full min-h-9 items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm focus-ring-inset',
                  item.disabled
                    ? 'text-text-muted cursor-default'
                    : cx('cursor-pointer hover:bg-hover-surface', item.danger ? 'text-error' : 'text-text'),
                )}
              >
                {item.icon && <span className="mt-0.5 shrink-0">{item.icon}</span>}
                <span className="grid">
                  <span>{item.label}</span>
                  {item.disabled && item.disabledReason && <span className="text-meta text-text-muted">{item.disabledReason}</span>}
                </span>
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
