'use client';

import { useSyncExternalStore } from 'react';

/**
 * Photo batches that keep adding after their Add media dialog closes (#62).
 *
 * In the local build each photo is decoded, downscaled and saved on this
 * device, so a large batch takes a while. The dialog hands the batch here and
 * closes; `BackgroundMediaStatus` shows its progress. Batches run one after
 * another. Leaving the page mid-batch asks first: the batch is one durable
 * write (`withWriteBatch`), which holds the page while it runs.
 */

/** What the status pill shows. `total` and `done` count every running and queued batch. */
export interface BackgroundMediaState {
  running: boolean;
  done: number;
  total: number;
  /** Set when a batch stopped: what it added, and why it stopped. */
  failure: { done: number; total: number; message: string } | null;
  /** How many were added by the batches that just finished, until it is dismissed. */
  finished: number | null;
}

/** A batch's work. It calls `added` once for each photo or item it adds. */
export interface BackgroundMediaJob {
  total: number;
  run: (added: () => void) => Promise<void>;
  /** Turns an error into the message the pill shows. */
  describe: (error: unknown) => string;
}

const IDLE: BackgroundMediaState = { running: false, done: 0, total: 0, failure: null, finished: null };
let state: BackgroundMediaState = IDLE;
const listeners = new Set<() => void>();
let queue: Promise<void> = Promise.resolve();
let pending = 0;

function set(next: Partial<BackgroundMediaState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

/** Queue a batch. Resolves when it has finished or stopped. */
export function addInBackground(job: BackgroundMediaJob): Promise<void> {
  pending++;
  const fresh = !state.running;
  set({
    running: true,
    total: (fresh ? 0 : state.total) + job.total,
    done: fresh ? 0 : state.done,
    failure: fresh ? null : state.failure,
    finished: null,
  });
  const run = queue.then(async () => {
    let added = 0;
    try {
      await job.run(() => { added++; set({ done: state.done + 1 }); });
    } catch (error) {
      set({ failure: { done: added, total: job.total, message: job.describe(error) } });
      // What this batch didn't add no longer counts towards the total.
      set({ total: state.total - (job.total - added) });
    } finally {
      pending--;
      if (pending === 0) set({ running: false, finished: state.failure ? null : state.done });
    }
  });
  queue = run.catch(() => {});
  return run;
}

/** Clear a finished or stopped status. */
export function dismissBackgroundMedia(): void {
  if (!state.running) set(IDLE);
}

export function useBackgroundMedia(): BackgroundMediaState {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => state,
    () => IDLE,
  );
}

/** For tests: forget every batch. */
export function resetBackgroundMedia(): void {
  state = IDLE;
  queue = Promise.resolve();
  pending = 0;
  for (const listener of listeners) listener();
}
