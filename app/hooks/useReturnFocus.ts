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

/**
 * `useReturnFocus` for a panel with more than one trigger (#157: a section's
 * heading Add and the timeline's phantom row both open the add-event editor).
 * Attach `ref(name)` to each trigger and call `opened(name)` when one opens the
 * panel; when `open` goes true → false, that trigger gets focus back.
 */
export function useReturnFocusTo<K extends string>(open: boolean) {
  const els = useRef(new Map<K, HTMLElement | null>());
  const last = useRef<K | null>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open && last.current) els.current.get(last.current)?.focus();
    wasOpen.current = open;
  }, [open]);
  const refs = useRef(new Map<K, (el: HTMLElement | null) => void>());
  const ref = (name: K) => {
    let r = refs.current.get(name);
    if (!r) { r = (el) => { els.current.set(name, el); }; refs.current.set(name, r); }
    return r;
  };
  const opened = (name: K) => { last.current = name; };
  return { ref, opened };
}
