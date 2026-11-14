'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Card, MobileListHeader, PageShell } from '@/app/components/ui';
import { ExternalLink } from '@/app/components/ExternalLink';
import { useDesktopMode } from '@/app/hooks/useDesktopMode';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { DATA_MODE } from '@/lib/data';
import { isDesktopApp } from '@/lib/desktop';
import { CREDITS_HREF, LICENSE_HREF, aboutInfo, runningAs, type RunningAs } from '@/lib/about';
import TextFileDialog from './TextFileDialog';
import WhatsNewDialog from '@/app/components/whats-new/WhatsNewDialog';
import { entriesUpTo } from '@/lib/whats-new';

const RUNNING_KEY: Record<RunningAs, string> = {
  hosted: 'running_hosted',
  self_hosted: 'running_self_hosted',
  browser: 'running_browser',
  desktop: 'running_desktop',
};

const DATA_KEY: Record<RunningAs, string> = {
  hosted: 'data_server',
  self_hosted: 'data_server',
  browser: 'data_browser',
  desktop: 'data_desktop',
};

const noSubscribe = () => () => {};
/** On a phone the cards run edge to edge, like the Options groups. */
const PHONE_FLAT = 'max-md:border-x-0 max-md:rounded-none max-md:shadow-none';
const LINK = 'text-left text-link underline-offset-2 hover:underline rounded focus-ring cursor-pointer';

/** A YYYY-MM-DD build date in the reader's language, read as a calendar day (UTC). */
function formatBuildDate(date: string, locale: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(d);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-3 px-4 py-3 border-t border-border first:border-t-0 text-sm">
      <dt className="text-text-muted">{label}</dt>
      <dd className="m-0 text-text min-w-0 break-words">{children}</dd>
    </div>
  );
}

/**
 * About Heirloom (#1256): version, build, which build kind this is, the source
 * link AGPL section 13 asks for, the licence, a generic privacy note and the
 * third-party credits. Reached from the foot of every menu. It names no tree,
 * member or owner, since shared-tree viewers see it too.
 */
export default function AboutPage() {
  const t = useTranslations('about');
  const locale = useLocale();
  const legacyDesktop = useDesktopMode();
  // Read after hydration: the static export pre-renders without a window.
  const tauri = useSyncExternalStore(noSubscribe, isDesktopApp, () => false);
  const [file, setFile] = useState<'licence' | 'credits' | 'whats_new' | null>(null);
  useDocumentTitle(t('title'));

  const info = aboutInfo();
  const kind = runningAs(DATA_MODE, tauri || legacyDesktop);
  const date = formatBuildDate(info.buildDate, locale);
  const build = [info.commit, date].filter(Boolean).join(' · ');

  return (
    <PageShell
      title={t('title')}
      subtitle={t('tagline')}
      titleClassName="max-md:hidden"
      topBar={<MobileListHeader title={t('title')} />}
      contentClassName="max-md:p-0!"
    >
      <div className="max-w-[640px] flex flex-col gap-4 max-md:gap-0 max-md:pt-[18px]">
        <p className="md:hidden m-0 px-4 pb-3 text-sm text-text-muted">{t('tagline')}</p>
        <Card pad={false} className={PHONE_FLAT}>
          <dl className="m-0">
            <Row label={t('version')}>{info.version || '—'}</Row>
            {build && <Row label={t('build')}><span className="font-mono text-meta">{build}</span></Row>}
            <Row label={t('running_as')}>{t(RUNNING_KEY[kind])}</Row>
            {info.sourceUrl && (
              <Row label={t('source')}>
                <ExternalLink href={info.sourceUrl} className={LINK}>{t('source_link')}</ExternalLink>
              </Row>
            )}
            <Row label={t('licence')}>
              <button type="button" className={LINK} onClick={() => setFile('licence')}>{t('licence_name')}</button>
            </Row>
            <Row label={t('data')}>{t(DATA_KEY[kind])}</Row>
            <Row label={t('whats_new')}>
              <button type="button" className={LINK} onClick={() => setFile('whats_new')}>{t('whats_new_link')}</button>
            </Row>
          </dl>
        </Card>
        <Card pad={false} className={`${PHONE_FLAT} max-md:mt-6`}>
          <dl className="m-0">
            <Row label={t('credits')}>
              <button type="button" className={LINK} onClick={() => setFile('credits')}>{t('credits_link')}</button>
            </Row>
          </dl>
        </Card>
      </div>

      <TextFileDialog open={file === 'licence'} onClose={() => setFile(null)} title={t('licence_name')} href={LICENSE_HREF} />
      <WhatsNewDialog open={file === 'whats_new'} onClose={() => setFile(null)} entries={entriesUpTo(info.version)} />
      <TextFileDialog open={file === 'credits'} onClose={() => setFile(null)} title={t('credits_link')} href={CREDITS_HREF} />
    </PageShell>
  );
}
