'use client';

import { useEffect } from 'react';
import { fitDesktopMinSize, isDesktopApp } from '@/lib/desktop';

/**
 * Desktop app only. Keeps the window's minimum size wide enough for the
 * desktop layout at the webview's current zoom (#85), and refits when that
 * zoom changes (a text-scale change, or a move to a monitor with another scale).
 */
export default function DesktopWindowFit() {
  useEffect(() => {
    if (!isDesktopApp()) return;
    let query: MediaQueryList | undefined;
    const fit = () => {
      query?.removeEventListener('change', fit);
      // The window still works at its configured minimum if this fails.
      fitDesktopMinSize().catch(() => {});
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      query.addEventListener('change', fit);
    };
    fit();
    return () => query?.removeEventListener('change', fit);
  }, []);
  return null;
}
