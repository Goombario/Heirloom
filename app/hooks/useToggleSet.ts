import { useCallback, useState } from 'react';

/**
 * Tracks a set of "open" string keys with a toggle — used for the independently
 * collapsible per-event maps on the person & family timelines, where each row
 * opens/closes on its own without affecting the others.
 */
export function useToggleSet() {
    const [open, setOpen] = useState<Set<string>>(new Set());
    const toggle = useCallback((key: string) => {
        setOpen(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);
    const isOpen = useCallback((key: string) => open.has(key), [open]);
    return { isOpen, toggle };
}
