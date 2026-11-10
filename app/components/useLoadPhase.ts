'use client';

import { useEffect, useRef, useState } from 'react';

export type LoadPhase = 'pending' | 'loading' | 'ready';

export interface LoadPhaseOptions {
  /** ms a load may run before the skeleton is shown (default 200). */
  delay?: number;
  /** ms the skeleton stays once shown, to prevent flash-off (default 400). */
  minDuration?: number;
}

/**
 * Converts a raw `loading` boolean into a flicker-free phase:
 *  - `pending`  — loading, but inside the `delay` window → render nothing
 *  - `loading`  — load exceeded `delay` → show skeleton, held ≥ `minDuration`
 *  - `ready`    — load finished and any min-duration floor elapsed
 *
 * `delay: 0` is "skeleton-first": the phase starts at `loading` on the first
 * frame (no `pending` window), so a statically-prerendered surface ships the
 * skeleton in its HTML. Use it for surfaces whose loads are reliably slow
 * (e.g. a hard-reloaded landing page); keep the default delay for nav-driven
 * surfaces where a fast load should skip the skeleton entirely.
 */
export function useLoadPhase(
  loading: boolean,
  { delay = 200, minDuration = 400 }: LoadPhaseOptions = {},
): LoadPhase {
  const [phase, setPhase] = useState<LoadPhase>(
    loading ? (delay === 0 ? 'loading' : 'pending') : 'ready',
  );
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    if (loading) {
      // Intentional: this hook is a timer-driven state machine; the phase must
      // re-derive synchronously when `loading` toggles. The timers below also
      // setState, which is the whole point of the hook.
      if (delay === 0) {
        // Skeleton-first: show it immediately, no pending window.
        shownAt.current = Date.now();
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPhase('loading');
        return;
      }
      setPhase('pending');
      shownAt.current = null;
      const delayTimer = setTimeout(() => {
        shownAt.current = Date.now();
        setPhase('loading');
      }, delay);
      return () => clearTimeout(delayTimer);
    }

    if (shownAt.current === null) {
      setPhase('ready');
      return;
    }
    const elapsed = Date.now() - shownAt.current;
    const remaining = minDuration - elapsed;
    if (remaining <= 0) {
      setPhase('ready');
      shownAt.current = null;
      return;
    }
    const holdTimer = setTimeout(() => {
      setPhase('ready');
      shownAt.current = null;
    }, remaining);
    return () => clearTimeout(holdTimer);
  }, [loading, delay, minDuration]);

  return phase;
}
