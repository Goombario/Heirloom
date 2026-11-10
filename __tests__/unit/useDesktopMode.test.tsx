/** @vitest-environment happy-dom */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/app/hooks/useDesktopMode');
vi.mock('@/lib/data', () => ({ DATA_MODE: 'local' }));

describe('useDesktopMode in local/static mode', () => {
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

  it('resolves local static mode synchronously without fetching', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { useDesktopMode, useDesktopModeResolved } = await loadHook();

    const { result } = renderHook(() => ({
      desktop: useDesktopMode(),
      resolved: useDesktopModeResolved(),
    }));

    expect(result.current).toEqual({ desktop: false, resolved: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses the Electron preload flag synchronously without fetching', async () => {
    Object.defineProperty(window, 'desktopApp', { value: {}, configurable: true });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { useDesktopMode, useDesktopModeResolved } = await loadHook();

    const { result } = renderHook(() => ({
      desktop: useDesktopMode(),
      resolved: useDesktopModeResolved(),
    }));

    expect(result.current).toEqual({ desktop: true, resolved: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
