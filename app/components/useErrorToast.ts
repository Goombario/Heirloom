'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { errorToastKey, redirectIfUnauthorized } from '@/lib/utils/data-error';
import { ServerError } from '@/lib/data/errors';
import { showErrorToast } from '@/app/components/ui';

/**
 * The client's single entry point for reporting a failed operation.
 *
 * Replaces the old 401-only guard idiom, which silently swallowed every other
 * failure — the gap that let the Review 6 name-variant 404 stay invisible
 * (tracker §15). `reportError` still redirects on 401; everything else becomes
 * a translated toast.
 *
 * Callers that need to reload on a stale 404 keep their `isRecordGone(e)` branch
 * AHEAD of this call, so the page's own not-found state takes over rather than
 * the user merely being told.
 */
export function useErrorToast(): {
  reportError: (e: unknown) => void;
  redirectIfUnauthorized: (e: unknown) => boolean;
} {
  const t = useTranslations('common');

  const redirect = useCallback((e: unknown) => redirectIfUnauthorized(e), []);

  const reportError = useCallback((e: unknown) => {
    if (redirect(e)) return;
    const message = t(errorToastKey(e));
    // A server failure carries an id that is also in the server log (#8).
    showErrorToast(e instanceof ServerError ? `${message} ${t('error_reference', { id: e.errorId })}` : message);
  }, [redirect, t]);

  return { reportError, redirectIfUnauthorized: redirect };
}
