'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Clock } from '@/lib/icons';
import {
  dismissBackgroundJobs, isJobActive, stopBackgroundJob, summarizeJobs, useBackgroundJobs,
  type BackgroundJobView,
} from './backgroundMedia';

/** How long "284 added" stays before it clears itself. */
const DONE_MS = 5000;
const SIGN_IN_HREF = '/api/auth/signin';

/** "10:42" in the reader's locale. */
export function useClockTime(): (ms: number) => string {
  const locale = useLocale();
  return (ms) => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

/** A small progress ring, as on the tab icon. */
function Ring({ done, total }: { done: number; total: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const part = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r={r} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
      <circle cx="12" cy="12" r={r} fill="none" stroke="var(--color-nav-progress, #FDBA74)" strokeWidth="3" strokeLinecap="round"
        strokeDasharray={`${(part * c).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 12 12)" />
      <path d="M12 15.5v-7M9 11l3-3 3 3" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The top-bar chip for photo work in the background (#207, idea 2): a ring and
 * "149 of 284" while it runs, a clock while the hosted upload limit holds it, an
 * orange dot when it stopped (until dismissed), and "284 added", which clears
 * itself. Clicking it lists the jobs, each with Stop.
 */
export default function BackgroundJobsChip() {
  const t = useTranslations('jobs');
  const jobs = useBackgroundJobs();
  const summary = summarizeJobs(jobs);
  const clock = useClockTime();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (summary.state !== 'done' || open) return;
    const timer = window.setTimeout(dismissBackgroundJobs, DONE_MS);
    return () => window.clearTimeout(timer);
  }, [summary.state, open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer, true); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (summary.state === 'idle') return null;

  let icon: React.ReactNode;
  let text: string;
  let aria: string;
  switch (summary.state) {
    case 'running':
      icon = <Ring done={summary.done} total={summary.total} />;
      text = t('chip_running', { done: summary.done, total: summary.total });
      aria = t('chip_aria_running', { done: summary.done, total: summary.total });
      break;
    case 'waiting':
      icon = <Clock className="h-4 w-4 shrink-0 text-white/80" aria-hidden="true" />;
      text = t('chip_waiting', { time: clock(summary.until) });
      aria = t('chip_aria_waiting', { time: clock(summary.until) });
      break;
    case 'stopped':
      icon = <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-nav-warning" />;
      text = t('chip_stopped', { done: summary.done, total: summary.total });
      aria = t('chip_aria_stopped', { done: summary.done, total: summary.total });
      break;
    case 'done':
      icon = <Check className="h-3.5 w-3.5 shrink-0 text-nav-success" strokeWidth={3} aria-hidden="true" />;
      text = t('chip_done', { count: summary.added });
      aria = t('chip_aria_done', { count: summary.added });
      break;
  }

  const active = jobs.some(isJobActive);
  return (
    <div ref={wrapRef} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={open ? panelId : undefined}
        aria-label={aria} title={aria}
        className="h-9 pl-1.5 pr-3 flex items-center gap-2 rounded-full border border-white/35 bg-white/[0.14] text-sm text-white hover:bg-white/20 focus-ring">
        {icon}
        <span className="tabular-nums whitespace-nowrap">{text}</span>
      </button>
      {/* Announced once per state, not on every photo. */}
      <span className="sr-only" role="status" aria-live="polite">{summary.state === 'running' ? '' : aria}</span>
      {open && (
        // eslint-disable-next-line no-restricted-syntax -- intentional dropdown surface (positioned, shadow), not a content Card
        <div id={panelId} role="dialog" aria-label={t('title')} className="absolute right-0 top-[calc(100%+8px)] z-50 w-[380px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card text-text shadow-lg">
          <div className="flex items-start gap-3 px-4 pt-3.5 pb-2.5">
            <div className="flex-1 min-w-0">
              <p className="m-0 text-md font-semibold">{active ? t('title') : summary.state === 'stopped' ? t('title_stopped') : t('title_done')}</p>
              {active && <p className="m-0 mt-0.5 text-sm text-text-muted">{t('note')}</p>}
            </div>
            {!active && (
              <button type="button" onClick={() => { dismissBackgroundJobs(); setOpen(false); }}
                className="text-sm text-link hover:underline focus-ring rounded-sm">{t('dismiss')}</button>
            )}
          </div>
          <ul className="m-0 list-none p-0">
            {jobs.map((job) => <JobRow key={job.id} job={job} />)}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One job: its label and count, a bar, what it is doing or why it stopped, and Stop. */
function JobRow({ job }: { job: BackgroundJobView }) {
  const t = useTranslations('jobs');
  const clock = useClockTime();
  const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
  const rest = Math.max(0, job.total - job.done);
  const tail = job.kind === 'add' ? t('rest_add', { count: rest }) : t('rest_import');
  let detail: React.ReactNode;
  switch (job.status) {
    case 'queued': detail = t('queued'); break;
    case 'running': detail = t('running'); break;
    case 'waiting': detail = t('waiting', { time: clock(job.waitUntil ?? 0) }); break;
    case 'done': detail = t('done'); break;
    case 'stopped':
      detail = job.signIn
        ? <>{t('sign_in_expired')} <a href={SIGN_IN_HREF} target="_blank" rel="noopener" className="text-link font-medium hover:underline focus-ring rounded-sm">{t('sign_in')}</a>. {tail}</>
        : <>{job.reason ? `${job.reason} ` : ''}{t('stopped', { done: job.done, total: job.total })} {tail}</>;
      break;
  }
  return (
    <li className="flex items-center gap-3 border-t border-border py-3 pl-4 pr-3">
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex justify-between gap-2 text-sm">
          <span className="font-medium truncate">{job.label}</span>
          <span className="shrink-0 tabular-nums text-text-muted">{t('count', { done: job.done, total: job.total })}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-border" aria-hidden="true">
          <div className={`h-1 ${job.status === 'waiting' ? 'bg-text-muted' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`text-meta ${job.status === 'stopped' ? 'text-text-secondary' : 'text-text-muted'}`}>{detail}</span>
      </div>
      {isJobActive(job) && (
        <button type="button" onClick={() => stopBackgroundJob(job.id)}
          className="h-8 shrink-0 rounded-md border border-border bg-card px-2.5 text-sm text-text hover:bg-hover-surface focus-ring">
          {t('stop')}
        </button>
      )}
    </li>
  );
}
