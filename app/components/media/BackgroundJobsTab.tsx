'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { setDocumentTitlePrefix } from '@/app/hooks/useDocumentTitle';
import { summarizeJobs, useBackgroundJobs } from './backgroundMedia';

type TabMark = { kind: 'progress'; percent: number } | { kind: 'stopped' } | { kind: 'done' } | null;

/** The tab icon: the nav square with a ring, or with a dot when it stopped or finished. */
function tabIconSvg(mark: Exclude<TabMark, null>): string {
  const r = 5;
  const c = 2 * Math.PI * r;
  const ring = mark.kind === 'progress'
    ? `<circle cx="8" cy="8" r="${r}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="2"/>`
      + `<circle cx="8" cy="8" r="${r}" fill="none" stroke="#FDBA74" stroke-width="2" stroke-dasharray="${((mark.percent / 100) * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 8 8)"/>`
    : `<circle cx="8" cy="8" r="4" fill="${mark.kind === 'stopped' ? '#FDBA74' : '#6EE7B7'}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="#475569"/>${ring}</svg>`;
}

/**
 * Photo work in the browser tab (#207, idea 4), for a reader in another tab: the
 * title reads "(52%) People · Heirloom" with a ring on the icon while it runs.
 * "(Stopped)" or "(Done)" stays until the reader comes back to the tab.
 */
export default function BackgroundJobsTab() {
  const t = useTranslations('jobs');
  const jobs = useBackgroundJobs();
  const summary = summarizeJobs(jobs);
  // A stop or finish seen while the tab was hidden, kept until it is shown again.
  const [unseen, setUnseen] = useState<'stopped' | 'done' | null>(null);
  const lastState = useRef(summary.state);

  useEffect(() => {
    const was = lastState.current;
    lastState.current = summary.state;
    const ended = (was === 'running' || was === 'waiting') && (summary.state === 'stopped' || summary.state === 'done' || summary.state === 'idle');
    if (ended && document.visibilityState === 'hidden') setUnseen(summary.state === 'stopped' ? 'stopped' : 'done');
    if (summary.state === 'running' || summary.state === 'waiting') setUnseen(null);
  }, [summary.state]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setUnseen(null); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const mark: TabMark = summary.state === 'running' || summary.state === 'waiting'
    ? { kind: 'progress', percent: summary.total > 0 ? Math.floor((summary.done / summary.total) * 100) : 0 }
    : unseen ? { kind: unseen } : null;
  const markKey = mark ? (mark.kind === 'progress' ? `p${mark.percent}` : mark.kind) : '';

  useEffect(() => {
    if (!mark) return;
    const prefixed = (title: string) => mark.kind === 'progress'
      ? t('tab_progress', { percent: mark.percent, title })
      : mark.kind === 'stopped' ? t('tab_stopped', { title }) : t('tab_done', { title });

    // The app's title keeper puts the prefix on whatever title each page sets.
    setDocumentTitlePrefix(prefixed);

    // The icon links are Next's, in <head>, outside any component of ours.
    // eslint-disable-next-line no-restricted-syntax -- no ref reaches the document's own icon links
    const icons = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
    const originals = icons.map((link) => link.href);
    const href = `data:image/svg+xml,${encodeURIComponent(tabIconSvg(mark))}`;
    let added: HTMLLinkElement | null = null;
    if (icons.length > 0) for (const link of icons) link.href = href;
    else {
      added = document.createElement('link');
      added.rel = 'icon';
      added.href = href;
      document.head.appendChild(added);
    }

    return () => {
      setDocumentTitlePrefix(null);
      icons.forEach((link, i) => { link.href = originals[i]; });
      added?.remove();
    };
    // markKey stands for `mark`, which is a fresh object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markKey, t]);

  return null;
}
