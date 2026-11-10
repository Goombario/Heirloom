/** @vitest-environment happy-dom */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/app/hooks/useDesktopMode');
vi.mock('@/lib/data', () => ({ DATA_MODE: 'http' }));

describe('useDesktopMode in hosted mode', () => {
  let originalDesktopApp: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalDesktopApp = Object.getOwnPropertyDescriptor(window, 'desktopApp');
    delete (window as unknown as Record<string, unknown>).desktopApp;
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    if (originalDesktopApp) {
      Object.defineProperty(window, 'desktopApp', originalDesktopApp);
    } else {
      delete (window as unknown as Record<string, unknown>).desktopApp;
    }
  });

  async function loadHook() {
    vi.resetModules();
    return import('@/app/hooks/useDesktopMode');
  }

  it('resolves hosted detection after a successful response', async () => {
    let resolveResponse!: (response: Response) => void;
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(responsePromise));
    const { useDesktopMode, useDesktopModeResolved } = await loadHook();

    const { result } = renderHook(() => ({
      desktop: useDesktopMode(),
      resolved: useDesktopModeResolved(),
    }));

    expect(result.current).toEqual({ desktop: false, resolved: false });
    resolveResponse(new Response(JSON.stringify({ isDesktop: true }), {
      headers: { 'Content-Type': 'application/json' },
    }));
    await waitFor(() => expect(result.current).toEqual({ desktop: true, resolved: true }));
  });

  it('resolves hosted detection as false after a rejected response', async () => {
    let rejectResponse!: (error: Error) => void;
    const responsePromise = new Promise<Response>((_, reject) => {
      rejectResponse = reject;
    });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(responsePromise));
    const { useDesktopMode, useDesktopModeResolved } = await loadHook();

    const { result } = renderHook(() => ({
      desktop: useDesktopMode(),
      resolved: useDesktopModeResolved(),
    }));

    expect(result.current).toEqual({ desktop: false, resolved: false });
    rejectResponse(new Error('offline'));
    await waitFor(() => expect(result.current).toEqual({ desktop: false, resolved: true }));
  });
});
