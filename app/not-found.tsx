'use client';

import { useTranslations } from 'next-intl';
import { PageShell } from '@/app/components/ui';
import { MissingState } from '@/app/components/RecordNotFound';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';

/**
 * Branded 404. Renders inside the root layout (Navbar + providers), so it picks up the
 * theme and i18n instead of falling back to Next.js's bare default 404. It shares the
 * missing-record layout (#708) and always offers a route back to the dashboard, so a
 * dead link is never a dead end.
 */
export default function NotFound() {
  const t = useTranslations('notFound');
  useDocumentTitle(t('title'));

  return (
    <PageShell className="flex flex-col" contentClassName="flex-1 flex items-center justify-center">
      <MissingState
        testId="page-not-found"
        title={t('title')}
        hint={t('body')}
        backLabel={t('back_home')}
        backHref="/"
      />
    </PageShell>
  );
}
