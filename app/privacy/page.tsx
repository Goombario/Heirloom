'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Card, MobileListHeader, PageShell } from '@/app/components/ui';
import GuardedLink from '@/app/components/GuardedLink';
import { useDesktopMode } from '@/app/hooks/useDesktopMode';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { DATA_MODE } from '@/lib/data';
import { isDesktopApp } from '@/lib/desktop';
import { aboutInfo, runningAs, type RunningAs } from '@/lib/about';
import { ChevronLeft } from '@/lib/icons';

const RUNNING_KEY: Record<RunningAs, 'running_hosted' | 'running_self_hosted' | 'running_browser' | 'running_desktop'> = {
  hosted: 'running_hosted',
  self_hosted: 'running_self_hosted',
  browser: 'running_browser',
  desktop: 'running_desktop',
};

/** Which of the three "Your family tree" cases is this build (#170). */
const TREE_CASE: Record<RunningAs, 'browser' | 'desktop' | 'server'> = {
  hosted: 'server',
  self_hosted: 'server',
  browser: 'browser',
  desktop: 'desktop',
};

const noSubscribe = () => () => {};
const PHONE_FLAT = 'max-md:border-x-0 max-md:rounded-none max-md:shadow-none';
const SECTIONS = ['google_signin', 'drive', 'maps', 'google_pages', 'never', 'removing'] as const;

function Section({ title, tag, children }: { title: string; tag?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-border px-5 py-4 first:border-t-0 max-md:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 serif text-md font-semibold text-text">{title}</h2>
        {tag}
      </div>
      <div className="mt-1.5 grid gap-2 text-sm leading-relaxed text-text-secondary [&_p]:m-0">{children}</div>
    </section>
  );
}

/**
 * Privacy (#170): how Heirloom handles data, so the Google consent screen can
 * leave Testing. A public page in every build: SignInGate lets signed-out
 * visitors read it. Generic on purpose, with no operator name, contact or site
 * address; the operator's contact goes in the consent screen form. Laid out like
 * About (one reading column, one panel); mockup option A.
 */
export default function PrivacyPage() {
  const t = useTranslations('privacy');
  const tAbout = useTranslations('about');
  const legacyDesktop = useDesktopMode();
  const tauri = useSyncExternalStore(noSubscribe, isDesktopApp, () => false);
  useDocumentTitle(t('title'));

  const info = aboutInfo();
  const kind = runningAs(DATA_MODE, tauri || legacyDesktop);
  const here = TREE_CASE[kind];
  const b = (chunks: ReactNode) => <b className="font-semibold text-text">{chunks}</b>;
  const subtitle = info.version ? t('subtitle_version', { version: info.version }) : t('subtitle');

  return (
    <PageShell
      title={t('title')}
      subtitle={subtitle}
      titleClassName="max-md:hidden"
      topBar={<MobileListHeader title={t('title')} />}
      contentClassName="max-md:p-0!"
    >
      <div className="max-w-[640px] flex flex-col gap-4 max-md:gap-0 max-md:pt-[18px]">
        <GuardedLink href="/about" className="max-md:hidden -mt-1 inline-flex w-fit items-center gap-1 text-sm text-link hover:underline focus-ring rounded">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />{tAbout('title')}
        </GuardedLink>
        <p className="md:hidden m-0 px-4 pb-3 text-sm text-text-muted">{subtitle}</p>
        <Card pad={false} className={PHONE_FLAT}>
          <div className="m-4 mb-1 rounded-lg bg-surface-2 px-4 py-3 max-md:mx-4">
            <h2 className="m-0 text-meta font-semibold uppercase tracking-wide text-text-muted">{t('in_short')}</h2>
            <ul className="m-0 mt-1.5 grid list-disc gap-1 pl-4 text-sm text-text">
              <li>{t('short_tree')}</li>
              <li>{t('short_no_tracking')}</li>
              <li>{t('short_drive')}</li>
            </ul>
          </div>
          <Section
            title={t('tree_title')}
            tag={<span className="rounded-full bg-segment-on px-2 py-0.5 text-meta text-on-segment">{t('you_are_using', { build: tAbout(RUNNING_KEY[kind]) })}</span>}
          >
            {(['browser', 'desktop', 'server'] as const).map((c) => (
              <p key={c} className={c === here ? undefined : 'text-text-muted'}>{t.rich(`tree_${c}`, { b })}</p>
            ))}
          </Section>
          {SECTIONS.map((s) => (
            <Section key={s} title={t(`${s}_title`)}>
              <p>{t.rich(`${s}_body`, { b })}</p>
            </Section>
          ))}
        </Card>
      </div>
    </PageShell>
  );
}
