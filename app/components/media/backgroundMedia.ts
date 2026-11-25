'use client';

import { useSyncExternalStore } from 'react';
import { FileTooLargeError, RateLimitError, StorageLimitError, UnauthorizedError } from '@/lib/data/errors';

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

/** Why a job stopped (#236), so the row can say it in plain words. */
type StopCause = 'you' | 'network' | 'server' | 'too_large' | 'storage' | 'sign_in';

/** One photo that didn't make it; `tooLarge` ones can never be added, so Retry skips them. */
interface NotAdded { name: string; tooLarge?: boolean }

/** Where a job's photos were going: a person, family, source, event's person or case. */
export interface JobTarget { name: string; href: string }

/** The cause an error stands for. A fetch that never reached the server is a dropped connection. */
function stopCauseOf(error: unknown): StopCause {
  if (error instanceof UnauthorizedError) return 'sign_in';
  if (error instanceof StorageLimitError) return 'storage';
  if (error instanceof FileTooLargeError) return 'too_large';
  if (error instanceof TypeError || (error instanceof Error && /network|failed to fetch|load failed/i.test(error.message))) return 'network';
  return 'server';
}

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
  /** Why it stopped (#236); null until it has. */
  cause: StopCause | null;
  /** Where the photos were going, linked from the row. */
  target: JobTarget | null;
  /** The photos that weren't added, in the order they were picked. */
  notAdded: NotAdded[];
  /** The job can be queued again from what this tab still holds (the files, the ZIP). */
  canRetry: boolean;
  /** An import job's ZIP, named so it can be chosen again. */
  zipName: string | null;
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
  /** Where the photos were going (#236). */
  target?: JobTarget;
  /** An import's ZIP name. */
  zipName?: string;
  /** What is still to do, read when the job stops. */
  notAdded?: () => NotAdded[];
  /** Queue what is left again (it skips what made it). Absent when nothing can be redone from here. */
  retry?: () => void;
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
  retry: (() => void) | null;
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
      cause: null, target: job.target ?? null, notAdded: [], canRetry: false, zipName: job.zipName ?? null,
    },
    stopRequested: false,
    wake: null,
    retry: job.retry ?? null,
  };
  // What a stopped job still holds: the photos left, and whether Retry can redo them.
  const leftOver = (cause: StopCause): Partial<BackgroundJobView> => {
    const notAdded = job.notAdded?.() ?? [];
    const redoable = notAdded.filter((n) => !n.tooLarge).length > 0 || (notAdded.length === 0 && entry.view.done < entry.view.total);
    return { cause, notAdded, canRetry: entry.retry != null && redoable && cause !== 'storage' };
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
    if (entry.stopRequested) { patch(entry, { status: 'stopped', ...leftOver('you') }); return; }
    patch(entry, { status: 'running' });
    try {
      await job.run(control);
      const complete = !entry.stopRequested && entry.view.done >= entry.view.total;
      patch(entry, complete ? { status: 'done', waitUntil: null } : { status: 'stopped', waitUntil: null, ...leftOver('you') });
    } catch (error) {
      const stopped = error instanceof JobStopped;
      patch(entry, {
        status: 'stopped',
        waitUntil: null,
        reason: stopped ? null : job.describe(error),
        signIn: error instanceof UnauthorizedError,
        ...leftOver(stopped ? 'you' : stopCauseOf(error)),
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
  if (entry.view.status === 'queued') patch(entry, { status: 'stopped', cause: 'you', canRetry: entry.retry != null });
}

/**
 * Retry a stopped job (#236): it leaves the list and what it had left is queued
 * again as a new job, which skips the photos that already made it.
 */
export function retryBackgroundJob(id: number): void {
  const entry = entries.find((e) => e.view.id === id);
  if (!entry || entry.view.status !== 'stopped' || !entry.retry) return;
  entries = entries.filter((e) => e !== entry);
  publish();
  entry.retry();
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
