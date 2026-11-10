'use client';

import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

type Opener = { el: HTMLElement; focusId: string | null; label: string | null };

const isVisible = (el: HTMLElement) => el.isConnected && el.getClientRects().length > 0;

/**
 * Put keyboard focus back on whatever opened an inline editor once it closes
 * (#798, KB-2): save, cancel and Escape alike. Call `remember()` in the opener's
 * handler, while the opener still holds focus.
 *
 * The opener often re-mounts: a timeline row becomes an editor and back. So when
 * the remembered element is gone or hidden, it is found again inside `scope` (the
 * section that holds the rows) by `data-focus-id`, then by its accessible name,
 * and the first visible match wins. When nothing matches (the record was
 * deleted), focus goes to `scope` itself, which should carry `tabIndex={-1}`.
 */
export function useEditorFocusReturn(open: boolean, scope: RefObject<HTMLElement | null>) {
    const opener = useRef<Opener | null>(null);
    const wasOpen = useRef(open);

    const remember = useCallback(() => {
        const el = document.activeElement;
        if (!(el instanceof HTMLElement) || el === document.body) {
            opener.current = null;
            return;
        }
        opener.current = { el, focusId: el.dataset.focusId ?? null, label: el.getAttribute('aria-label') };
    }, []);

    useEffect(() => {
        if (wasOpen.current && !open) {
            const o = opener.current;
            opener.current = null;
            let target: HTMLElement | null = null;
            if (o) {
                if (isVisible(o.el)) {
                    target = o.el;
                } else {
                    const selector = o.focusId
                        ? `[data-focus-id="${CSS.escape(o.focusId)}"]`
                        : o.label ? `[aria-label="${CSS.escape(o.label)}"]` : null;
                    target = selector
                        ? Array.from(scope.current?.querySelectorAll<HTMLElement>(selector) ?? []).find(isVisible) ?? null
                        : null;
                }
            }
            (target ?? scope.current)?.focus();
        }
        wasOpen.current = open;
    }, [open, scope]);

    return remember;
}

/** Focus the first enabled field inside `container` when it mounts (#798, KB-2). */
export function useFocusFirstField(container: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const field = container.current?.querySelector<HTMLElement>(
            'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), [role="combobox"]:not([disabled]):not([aria-disabled="true"]), select:not([disabled])',
        );
        field?.focus();
    }, [container]);
}

/**
 * An `onKeyDown` that makes Escape cancel an inline editor (#798, KB-3), unless
 * the Escape belongs to something open inside it: a combobox's list, a menu, or
 * a dialog portalled from the editor (React bubbles portal events here too).
 */
export function escapeToCancel(cancel: (panel: HTMLElement) => void) {
    return (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        const target = e.target as HTMLElement;
        if (target.closest?.('[aria-expanded="true"], [role="listbox"], [role="menu"], [role="dialog"]')) return;
        e.preventDefault();
        cancel(e.currentTarget as HTMLElement);
    };
}
