'use client';

import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { EmptyState, PageShell } from '@/app/components/ui';
import { DATA_MODE } from '@/lib/data';
import { useDesktopMode, useDesktopModeResolved } from '@/app/hooks/useDesktopMode';
import MembersPageClient from './MembersPageClient';

/**
 * /members (#656, ADR 0029). Hosted only: the static and desktop builds have no
 * sign-in, so they say so instead. The page's data and every change come from
 * /api/members, which refuses anyone who isn't an active admin.
 */
export default function MembersPage() {
  const t = useTranslations('members');
  const isDesktop = useDesktopMode();
  const resolved = useDesktopModeResolved();
  if (DATA_MODE === 'local' || (resolved && isDesktop)) {
    return (
      <PageShell title={t('title')}>
        <EmptyState variant="empty" title={t('unavailable_title')} message={t('unavailable_body')} />
      </PageShell>
    );
  }
  if (!resolved) return null;
  return <Suspense fallback={null}><MembersPageClient /></Suspense>;
}
