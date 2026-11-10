'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { CopperPill } from '@/app/components/ui';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { AuthTitlePage } from '../AuthTitlePage';

/** NextAuth's error-page codes, each said in plain words (#1129). */
const ERROR_KEYS = {
  Configuration: 'error_configuration',
  AccessDenied: 'error_access_denied',
  Verification: 'error_verification',
} as const;

function ErrorContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const error = searchParams.get('error');
  const t = useTranslations('auth');

  return (
    <AuthTitlePage
      small
      title={t('error_title')}
      body={t(ERROR_KEYS[error as keyof typeof ERROR_KEYS] ?? 'error_unknown')}
      action={<CopperPill onClick={() => router.push('/auth/signin')}>{t('try_again')}</CopperPill>}
    />
  );
}

export default function AuthErrorPage() {
  const t = useTranslations('auth');
  useDocumentTitle(t('error_title'));
  return (
    <Suspense fallback={<div>{t('loading')}</div>}>
      <ErrorContent />
    </Suspense>
  );
}
