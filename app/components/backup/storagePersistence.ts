'use client';

/**
 * Whether the browser keeps Heirloom's data for good (#18). The in-browser build
 * asks once on first run (`requestPersistence`, from LocalFirstRunNotice); the
 * Home notice and the Backups page read the answer here.
 *
 * - `kept`: `navigator.storage.persisted()` is true.
 * - `not_kept`: it is false, so the browser may clear the data under disk pressure.
 * - `unsupported`: the browser has no StorageManager, so it can't say.
 */
export type PersistState = 'kept' | 'not_kept' | 'unsupported';

/** Fired on window once the first-run request has an answer, so a notice waiting on it can look. */
export const PERSIST_ANSWERED_EVENT = 'heirloom:persist-answered';

/** Set once the Home notice was dismissed with Got it; it never shows again. */
export const STORAGE_NOTICE_DISMISSED_KEY = 'heirloom_storage_notice_dismissed';

function canAskPersistence(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.persist === 'function';
}

export async function readPersistState(): Promise<PersistState> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.persisted !== 'function') return 'unsupported';
  try {
    return (await navigator.storage.persisted()) ? 'kept' : 'not_kept';
  } catch {
    return 'unsupported';
  }
}

/**
 * Asks the browser to keep the data for good. Only on first run or when someone
 * presses Ask again: browsers decide from engagement, so asking on every load
 * changes nothing. Resolves to the state after the answer.
 */
export async function requestPersistence(): Promise<PersistState> {
  if (!canAskPersistence()) return 'unsupported';
  try {
    await navigator.storage.persist();
  } catch {
    // A refusal can reject in some browsers; the state below says what holds.
  }
  const state = await readPersistState();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PERSIST_ANSWERED_EVENT, { detail: state }));
  return state;
}
