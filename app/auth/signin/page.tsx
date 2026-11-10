'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { AuthTitlePage } from '../AuthTitlePage';
import { LICENSE_HREF, aboutInfo } from '@/lib/about';

const LINK = 'text-link underline-offset-2 hover:underline rounded focus-ring';

/**
 * The sign-in page has no menu, so signed-out visitors reach the version, source
 * and licence here (#1256). Sign-in only exists on server builds, so plain links.
 */
function Colophon() {
  const t = useTranslations('about');
  const { version, sourceUrl } = aboutInfo();
  const parts = [
    <span key="v">{version ? t('signin_version', { version }) : t('menu_row')}</span>,
    sourceUrl && <a key="s" href={sourceUrl} target="_blank" rel="noopener noreferrer" className={LINK}>{t('source')}</a>,
    <a key="l" href={LICENSE_HREF} target="_blank" rel="noopener" className={LINK}>{t('licence_short')}</a>,
  ].filter(Boolean);
  return <>{parts.flatMap((p, i) => (i === 0 ? [p] : [' · ', p]))}</>;
}

/** NextAuth's sign-in error codes, each said in plain words (#1129). */
const ERROR_KEYS = {
  OAuthSignin: 'error_oauth_signin',
  OAuthCallback: 'error_oauth_callback',
  OAuthCreateAccount: 'error_oauth_create',
  EmailCreateAccount: 'error_oauth_create',
  Callback: 'error_callback',
  OAuthAccountNotLinked: 'error_account_not_linked',
} as const;

function GoogleMark() {
  return (
    // Google's colours on a white disc, so the mark reads on the ink button and the white one.
    <span className="grid place-items-center w-[26px] h-[26px] rounded-full bg-white shrink-0" aria-hidden="true">
      <svg className="w-5 h-5" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
    </span>
  );
}

function SignInContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const error = searchParams.get('error');
  const t = useTranslations('auth');
  const errorKey = error ? (ERROR_KEYS[error as keyof typeof ERROR_KEYS] ?? 'error_default') : null;

  return (
    <AuthTitlePage
      title={t('app_name')}
      body={t('sign_in_body')}
      error={errorKey && t.rich(errorKey, { b: (chunks) => <b>{chunks}</b> })}
      action={(
        // Google's dark button on a light page and its white one on a dark page: the
        // ink fill and card text swap with the theme.
        <button
          type="button"
          onClick={() => signIn('google', { callbackUrl })}
          className="flex items-center justify-center gap-2.5 w-full h-[52px] rounded-full bg-text text-card text-md font-semibold cursor-pointer focus-ring active:scale-[0.98] transition-transform motion-reduce:transition-none"
        >
          <GoogleMark />
          {t('sign_in_google')}
        </button>
      )}
      fine={t('sign_in_fine')}
      colophon={<Colophon />}
    />
  );
}

export default function SignInPage() {
  const t = useTranslations('auth');
  useDocumentTitle(t('sign_in_title'));
  return (
    <Suspense fallback={<div>{t('loading')}</div>}>
      <SignInContent />
    </Suspense>
  );
}
