'use client';

import { useEffect, useRef } from 'react';

/** Matches the focusable selector used by `app/components/Modal.tsx`. */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus-trap for modal-like containers. Mirrors the proven pattern in
 * `app/components/Modal.tsx` (focus first focusable on open, restore previously
 * focused element on close, Tab / Shift+Tab cycle within the container) so that
 * keyboard focus cannot escape a `role="dialog" aria-modal="true"` surface that
 * is NOT a `Modal` (e.g. the mobile full-screen push panels in `SourceModal`).
 *
 * Attach the returned ref to the dialog container. The container should carry
 * `tabIndex={-1}` so focus has a fallback target when it holds no focusable
 * children (e.g. a bare loading state). Pass `active = false` to disable the
 * trap without unmounting the consumer.
 *
 * @returns a ref to attach to the trap container element.
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(active: boolean = true) {
  const ref = useRef<T>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    // Remember focus, then move into the dialog (first focusable, else the container).
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? container).focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const el = ref.current;
      if (!el) return;
      const items = el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [active]);

  return ref;
}
