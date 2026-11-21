/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addInBackground, dismissBackgroundJobs, getBackgroundJobs, resetBackgroundMedia, stopBackgroundJob, summarizeJobs,
  type BackgroundJobView,
} from '@/app/components/media/backgroundMedia';
import { RateLimitError, UnauthorizedError } from '@/lib/data/errors';

// The background photo queue (#207): one queue for Add media and the import photo step.

const jobs = async (): Promise<BackgroundJobView[]> => getBackgroundJobs();

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => { resetBackgroundMedia(); });

describe('background photo queue (#207)', () => {
  it('runs jobs one after another and sums them for the chip', async () => {
    const gate = deferred();
    const first = addInBackground({ kind: 'add', label: 'A', total: 2, describe: () => '', run: async ({ added }) => { added(); await gate.promise; added(); } });
    const second = addInBackground({ kind: 'import', label: 'B', total: 3, describe: () => '', run: async ({ added }) => { added(3); } });
    await Promise.resolve();
    expect(summarizeJobs(await jobs())).toMatchObject({ state: 'running', done: 1, total: 5 });
    gate.resolve();
    await Promise.all([first, second]);
    expect(summarizeJobs(await jobs())).toEqual({ state: 'done', added: 5 });
  });

  it('waits for Retry-After on the upload limit, then carries on', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const run = addInBackground({
        kind: 'import', label: 'I', total: 1, describe: () => '',
        run: async ({ added, step }) => { await step(async () => { calls++; if (calls === 1) throw new RateLimitError('busy', 30); }); added(); },
      });
      await vi.advanceTimersByTimeAsync(0);
      const waiting = (await jobs())[0];
      expect(waiting.status).toBe('waiting');
      expect(waiting.waitUntil).toBe(Date.now() + 30_000);
      await vi.advanceTimersByTimeAsync(30_000);
      await run;
      expect((await jobs())[0].status).toBe('done');
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Stop ends a wait at once, and the job says it stopped with no reason', async () => {
    const run = addInBackground({
      kind: 'add', label: 'A', total: 2, describe: () => 'never',
      run: async ({ step }) => { await step(async () => { throw new RateLimitError('busy', 900); }); },
    });
    await new Promise((r) => setTimeout(r, 0));
    const job = (await jobs())[0];
    expect(job.status).toBe('waiting');
    stopBackgroundJob(job.id);
    await run;
    expect((await jobs())[0]).toMatchObject({ status: 'stopped', reason: null, signIn: false });
  });

  it('stops on an expired sign-in and marks it for a Sign in link', async () => {
    await addInBackground({
      kind: 'add', label: 'A', total: 2, describe: () => 'Your sign-in has expired.',
      run: async ({ added }) => { added(); throw new UnauthorizedError(); },
    });
    expect((await jobs())[0]).toMatchObject({ status: 'stopped', done: 1, signIn: true });
    expect(summarizeJobs(await jobs())).toEqual({ state: 'stopped', done: 1, total: 2 });
    dismissBackgroundJobs();
    expect(await jobs()).toEqual([]);
  });

  it('stops a queued job before it starts', async () => {
    const gate = deferred();
    const first = addInBackground({ kind: 'add', label: 'A', total: 1, describe: () => '', run: async ({ added }) => { await gate.promise; added(); } });
    const ran = vi.fn();
    const second = addInBackground({ kind: 'add', label: 'B', total: 1, describe: () => '', run: async () => { ran(); } });
    stopBackgroundJob((await jobs())[1].id);
    gate.resolve();
    await Promise.all([first, second]);
    expect(ran).not.toHaveBeenCalled();
    expect((await jobs()).map((j) => j.status)).toEqual(['done', 'stopped']);
  });

  it('asks before the tab is closed while a job runs, and not after', async () => {
    const gate = deferred();
    const run = addInBackground({ kind: 'import', label: 'I', total: 1, describe: () => '', run: async ({ added }) => { await gate.promise; added(); } });
    const during = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);
    gate.resolve();
    await run;
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
