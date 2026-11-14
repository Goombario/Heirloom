'use client';

import { useSyncExternalStore } from 'react';
import { isDesktopApp } from '@/lib/desktop';

const noSubscribe = () => () => {};

/**
 * True inside the Tauri desktop app. False on the server and in the first
 * hydration pass, so prerendered markup always matches, then true on the client
 * once React reads the store (#61).
 */
export function useIsDesktopApp(): boolean {
  return useSyncExternalStore(noSubscribe, isDesktopApp, () => false);
}
