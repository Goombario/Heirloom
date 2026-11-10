'use client';

import { useSyncExternalStore } from 'react';
import { DATA_MODE } from '@/lib/data';

let cachedValue: boolean | null = null;
let listeners: Array<() => void> = [];

function subscribe(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function getSnapshot(): boolean {
  return cachedValue ?? false;
}

function getServerSnapshot(): boolean {
  return false;
}

function getResolvedSnapshot(): boolean {
  return cachedValue !== null;
}

function getResolvedServerSnapshot(): boolean {
  return false;
}

// Kick off the detection once (module-level)
if (typeof window !== 'undefined' && cachedValue === null) {
  // Check if the Electron preload exposed the flag
  if ((window as unknown as Record<string, unknown>).desktopApp) {
    cachedValue = true;
  } else if (DATA_MODE === 'local') {
    // Static local-first build: no server to ask, and never an Electron desktop.
    cachedValue = false;
  } else {
    // Ask the server
    fetch('/api/desktop')
      .then((res) => res.json())
      .then((data) => {
        cachedValue = data.isDesktop === true;
        notifyListeners();
      })
      .catch(() => {
        cachedValue = false;
        notifyListeners();
      });
  }
}

export function useDesktopMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Returns true once the desktop mode detection has completed. */
export function useDesktopModeResolved(): boolean {
  return useSyncExternalStore(subscribe, getResolvedSnapshot, getResolvedServerSnapshot);
}
