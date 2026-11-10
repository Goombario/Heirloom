'use client';
import { useCallback, useEffect, type KeyboardEvent, type RefObject } from 'react';

const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

/**
 * The keyboard contract `role="menu"` advertises (#690, INT-3), shared by every
 * popover menu so the header menus and the note-actions menu behave alike.
 *
 * - Opening moves focus into the menu: the checked item of a radio menu, else the
 *   first item. Without this the role lies to a screen-reader user, who is told
 *   to press ↓ and gets nothing.
 * - ↑/↓ walk the items and wrap; Home/End jump to the ends.
 * - Escape closes and hands focus back to the trigger. Propagation is stopped so
 *   an enclosing editor's document-level Escape doesn't also fire.
 * - Tab gets the same exit as Escape. Items are `tabIndex={-1}` per the menu
 *   pattern, so where a native Tab goes from one is engine-dependent; closing and
 *   returning to the trigger gives one exit and one destination.
 *
 * Items must carry `tabIndex={-1}` and a menuitem role. Outside-click dismissal
 * stays with the caller, because a pointer dismissal must NOT pull focus back.
 */
export function useMenuKeyboard({
  open,
  menuRef,
  onClose,
}: {
  open: boolean;
  menuRef: RefObject<HTMLElement | null>;
  /** Close the menu; `returnFocus` asks the caller to focus the trigger. */
  onClose: (returnFocus: boolean) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const target =
      menu?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]') ??
      menu?.querySelector<HTMLElement>(ITEM_SELECTOR);
    target?.focus();
  }, [open, menuRef]);

  return useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      onClose(true);
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? (at + 1) % items.length
      : (at <= 0 ? items.length : at) - 1;
    items[next]?.focus();
  }, [onClose]);
}
