import { useEffect, useRef } from 'react';

/**
 * Returns focus to an overlay's trigger when the overlay closes (#690, INT-2).
 *
 * For inline panels and edit modes whose trigger is unmounted while they are
 * open: the element that had focus (a Cancel button, the Escape-pressed field)
 * disappears with the panel, and focus would otherwise fall to <body>. Attach
 * the returned ref to the trigger; when `open` goes true → false the trigger,
 * re-rendered by then, gets focus back. Overlays that stay mounted over their
 * trigger (Modal, useFocusTrap) already restore focus themselves.
 */
export function useReturnFocus<T extends HTMLElement = HTMLButtonElement>(open: boolean) {
  const ref = useRef<T>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) ref.current?.focus();
    wasOpen.current = open;
  }, [open]);
  return ref;
}
