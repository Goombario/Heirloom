'use client';

import { useSyncExternalStore } from 'react';
import { RateLimitError, UnauthorizedError } from '@/lib/data/errors';

/**
 * One queue for photo work that carries on while the reader moves around the app
 * (#62, #207): Add media batches and the photo step after an import. Jobs run one
 * after another. The top-bar chip (`BackgroundJobsChip`) and the tab title
 * (`BackgroundJobsTab`) read it, and so does the import panel while it is on screen.
 *
 * - Stop: each job checks `stopped` before its next photo, and a wait ends at once.
 * - Upload limit (hosted): a step that hits it waits for the server's Retry-After
 *   and tries again, shown as waiting, not as an error.
 * - Expired sign-in: the job stops with a Sign in link; nothing redirects on its own.
 * - Leaving: a reload or closing the tab asks first while any job is queued or running.
 *
 * Phones keep their stay-on-page flows: phone browsers pause background tabs.
 */

type BackgroundJobKind = 'add' | 'import';
type BackgroundJobStatus = 'queued' | 'running' | 'waiting' | 'stopped' | 'done';

/** One job as the chip, the jobs list and the import panel see it. */
export interface BackgroundJobView {
  id: number;
  kind: BackgroundJobKind;
  label: string;
  /** Finds a job again from a page that was left and reopened ("import:12"). */
  scope: string | null;
  done: number;
  total: number;
  status: BackgroundJobStatus;
  /** While waiting: when the step will be tried again (ms since epoch). */
  waitUntil: number | null;
  /** Why a stopped job stopped, already worded; null when Stop was pressed. */
  reason: string | null;
  /** The job stopped because the sign-in expired. */
  signIn: boolean;
}

/** What a job's `run` gets. */
interface BackgroundJobControl {
  /** Count one photo or item done. */
  added: (count?: number) => void;
  /** True once Stop was pressed: finish the photo in hand and return. */
  stopped: () => boolean;
  /** Stop from inside, when the job can't go on (its page moved to another tree). */
  stop: () => void;
  /** Run one step. A rate limit waits for Retry-After and tries again; Stop during the wait throws `JobStopped`. */
  step: <T>(fn: () => Promise<T>) => Promise<T>;
}

export interface BackgroundJob {
  kind: BackgroundJobKind;
  label: string;
  scope?: string;
  total: number;
  run: (control: BackgroundJobControl) => Promise<void>;
  /** Words an error that stopped the job. */
  describe: (error: unknown) => string;
}

/** Thrown by `step` when Stop ends a wait. */
class JobStopped extends Error {
  constructor() { super('Stopped'); this.name = 'JobStopped'; }
}

/** When the server names no time, try again after a minute. */
const DEFAULT_WAIT_S = 60;

interface Entry {
  view: BackgroundJobView;
  stopRequested: boolean;
  wake: (() => void) | null;
}

let entries: Entry[] = [];
let snapshot: BackgroundJobView[] = [];
const listeners = new Set<() => void>();
let queue: Promise<void> = Promise.resolve();
let nextId = 1;

function publish(): void {
  snapshot = entries.map((e) => e.view);
  syncUnloadGuard();
  for (const listener of listeners) listener();
}

function patch(entry: Entry, next: Partial<BackgroundJobView>): void {
  entry.view = { ...entry.view, ...next };
  publish();
}

const ACTIVE: ReadonlySet<BackgroundJobStatus> = new Set(['queued', 'running', 'waiting']);
export const isJobActive = (job: BackgroundJobView) => ACTIVE.has(job.status);

let guarding = false;
function onBeforeUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
  // Older browsers want returnValue set; the words are the browser's own.
  event.returnValue = '';
}
function syncUnloadGuard(): void {
  if (typeof window === 'undefined') return;
  const want = entries.some((e) => isJobActive(e.view));
  if (want === guarding) return;
  guarding = want;
  if (want) window.addEventListener('beforeunload', onBeforeUnload);
  else window.removeEventListener('beforeunload', onBeforeUnload);
}

function sleep(entry: Entry, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { entry.wake = null; resolve(); }, ms);
    entry.wake = () => { clearTimeout(timer); entry.wake = null; resolve(); };
  });
}

/** Queue a job. Resolves when it has finished or stopped; never rejects. */
export function addInBackground(job: BackgroundJob): Promise<void> {
  const entry: Entry = {
    view: {
      id: nextId++, kind: job.kind, label: job.label, scope: job.scope ?? null,
      done: 0, total: job.total, status: 'queued', waitUntil: null, reason: null, signIn: false,
    },
    stopRequested: false,
    wake: null,
  };
  // A new job starts a new round: finished jobs from the last one leave the list,
  // stopped ones stay until dismissed.
  if (!entries.some((e) => isJobActive(e.view))) entries = entries.filter((e) => e.view.status === 'stopped');
  entries = [...entries, entry];
  publish();

  const control: BackgroundJobControl = {
    added: (count = 1) => patch(entry, { done: entry.view.done + count }),
    stopped: () => entry.stopRequested,
    stop: () => { entry.stopRequested = true; },
    step: async <T,>(fn: () => Promise<T>): Promise<T> => {
      for (;;) {
        if (entry.stopRequested) throw new JobStopped();
        try {
          return await fn();
        } catch (error) {
          if (!(error instanceof RateLimitError)) throw error;
          const waitMs = Math.max(1, error.retryAfterSeconds ?? DEFAULT_WAIT_S) * 1000;
          patch(entry, { status: 'waiting', waitUntil: Date.now() + waitMs });
          await sleep(entry, waitMs);
          if (entry.stopRequested) throw new JobStopped();
          patch(entry, { status: 'running', waitUntil: null });
        }
      }
    },
  };

  const run = queue.then(async () => {
    if (entry.stopRequested) { patch(entry, { status: 'stopped' }); return; }
    patch(entry, { status: 'running' });
    try {
      await job.run(control);
      const complete = !entry.stopRequested && entry.view.done >= entry.view.total;
      patch(entry, { status: complete ? 'done' : 'stopped', waitUntil: null });
    } catch (error) {
      patch(entry, {
        status: 'stopped',
        waitUntil: null,
        reason: error instanceof JobStopped ? null : job.describe(error),
        signIn: error instanceof UnauthorizedError,
      });
    }
  });
  queue = run.catch(() => {});
  return run;
}

/** Stop one job: a queued job never starts, a running one stops after the photo in hand. */
export function stopBackgroundJob(id: number): void {
  const entry = entries.find((e) => e.view.id === id);
  if (!entry || !isJobActive(entry.view)) return;
  entry.stopRequested = true;
  entry.wake?.();
  if (entry.view.status === 'queued') patch(entry, { status: 'stopped' });
}

/** Clear every finished or stopped job from the list. */
export function dismissBackgroundJobs(): void {
  const before = entries.length;
  entries = entries.filter((e) => isJobActive(e.view));
  if (entries.length !== before) publish();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const NONE: BackgroundJobView[] = [];

/** Every listed job, oldest first. */
export function getBackgroundJobs(): BackgroundJobView[] {
  return snapshot;
}

export function useBackgroundJobs(): BackgroundJobView[] {
  return useSyncExternalStore(subscribe, getBackgroundJobs, () => NONE);
}

/** The latest job for a scope, so a reopened page can show and stop it. */
export function useBackgroundJob(scope: string | null): BackgroundJobView | null {
  const jobs = useBackgroundJobs();
  if (!scope) return null;
  for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].scope === scope) return jobs[i];
  return null;
}

/** The chip's one line: what the listed jobs add up to. */
export type JobsSummary =
  | { state: 'idle' }
  | { state: 'running'; done: number; total: number }
  | { state: 'waiting'; done: number; total: number; until: number }
  | { state: 'stopped'; done: number; total: number }
  | { state: 'done'; added: number };

export function summarizeJobs(jobs: readonly BackgroundJobView[]): JobsSummary {
  if (jobs.length === 0) return { state: 'idle' };
  const sum = (list: readonly BackgroundJobView[], key: 'done' | 'total') => list.reduce((n, j) => n + j[key], 0);
  const active = jobs.filter(isJobActive);
  if (active.length > 0) {
    const waiting = active.find((j) => j.status === 'waiting');
    if (waiting && !active.some((j) => j.status === 'running')) {
      return { state: 'waiting', done: sum(jobs, 'done'), total: sum(jobs, 'total'), until: waiting.waitUntil ?? Date.now() };
    }
    return { state: 'running', done: sum(jobs, 'done'), total: sum(jobs, 'total') };
  }
  const stopped = jobs.filter((j) => j.status === 'stopped');
  if (stopped.length > 0) return { state: 'stopped', done: sum(stopped, 'done'), total: sum(stopped, 'total') };
  return { state: 'done', added: sum(jobs, 'done') };
}

/** For tests: forget every job. */
export function resetBackgroundMedia(): void {
  for (const e of entries) e.wake?.();
  entries = [];
  queue = Promise.resolve();
  nextId = 1;
  publish();
}
