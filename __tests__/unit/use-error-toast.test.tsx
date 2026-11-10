/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AccessError, UnauthorizedError, NotFoundError } from '@/lib/data/errors';

const showErrorToast = vi.fn();
vi.mock('@/app/components/ui/Toast', () => ({ showErrorToast: (m: string) => showErrorToast(m) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => `common.${key}` }));

import { useErrorToast } from '@/app/components/useErrorToast';

describe('useErrorToast', () => {
  beforeEach(() => { showErrorToast.mockClear(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('toasts the translated key for a permission failure', () => {
    const { result } = renderHook(() => useErrorToast());
    act(() => { result.current.reportError(new AccessError()); });
    expect(showErrorToast).toHaveBeenCalledWith('common.error_permission');
  });

  it('toasts the generic key for an unrecognised failure', () => {
    const { result } = renderHook(() => useErrorToast());
    act(() => { result.current.reportError(new Error('boom')); });
    expect(showErrorToast).toHaveBeenCalledWith('common.error_generic');
  });

  it('redirects to sign-in on UnauthorizedError instead of toasting', () => {
    const loc = { href: '' };
    vi.stubGlobal('window', { location: loc } as unknown as Window & typeof globalThis);
    const { result } = renderHook(() => useErrorToast());
    act(() => { result.current.reportError(new UnauthorizedError()); });
    expect(loc.href).toBe('/api/auth/signin');
    expect(showErrorToast).not.toHaveBeenCalled();
  });

  it('exposes the same redirect behavior for read callers', () => {
    const loc = { href: '' };
    vi.stubGlobal('window', { location: loc } as unknown as Window & typeof globalThis);
    const { result } = renderHook(() => useErrorToast());
    expect(result.current.redirectIfUnauthorized(new UnauthorizedError())).toBe(true);
    expect(loc.href).toBe('/api/auth/signin');
    expect(showErrorToast).not.toHaveBeenCalled();
  });

  it('still toasts a NotFoundError — callers that reload check isRecordGone first', () => {
    const { result } = renderHook(() => useErrorToast());
    act(() => { result.current.reportError(new NotFoundError()); });
    expect(showErrorToast).toHaveBeenCalledWith('common.error_gone');
  });
});
