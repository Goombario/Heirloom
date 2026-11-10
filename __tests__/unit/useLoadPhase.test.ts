/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLoadPhase } from '@/app/components/useLoadPhase';

describe('useLoadPhase', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays pending during the delay window, never reaching loading on a fast load', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useLoadPhase(loading, { delay: 200, minDuration: 400 }),
      { initialProps: { loading: true } },
    );
    expect(result.current).toBe('pending');
    act(() => { vi.advanceTimersByTime(100); });
    rerender({ loading: false });
    expect(result.current).toBe('ready');
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current).toBe('ready');
  });

  it('shows loading after the delay and holds it for minDuration', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useLoadPhase(loading, { delay: 200, minDuration: 400 }),
      { initialProps: { loading: true } },
    );
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe('loading');
    act(() => { vi.advanceTimersByTime(50); });
    rerender({ loading: false });
    expect(result.current).toBe('loading');
    act(() => { vi.advanceTimersByTime(350); });
    expect(result.current).toBe('ready');
  });

  it('resets to pending when loading rises again', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useLoadPhase(loading),
      { initialProps: { loading: false } },
    );
    expect(result.current).toBe('ready');
    rerender({ loading: true });
    expect(result.current).toBe('pending');
  });

  it('with delay 0 is skeleton-first: loading on the very first frame, no pending', () => {
    const { result } = renderHook(
      ({ loading }) => useLoadPhase(loading, { delay: 0, minDuration: 400 }),
      { initialProps: { loading: true } },
    );
    // Frame 0 (before any timers advance) is already 'loading', never 'pending'.
    expect(result.current).toBe('loading');
  });

  it('with delay 0 still holds the skeleton for minDuration', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useLoadPhase(loading, { delay: 0, minDuration: 400 }),
      { initialProps: { loading: true } },
    );
    expect(result.current).toBe('loading');
    // Data arrives 50ms in — must hold until minDuration to avoid a flash-off.
    act(() => { vi.advanceTimersByTime(50); });
    rerender({ loading: false });
    expect(result.current).toBe('loading');
    act(() => { vi.advanceTimersByTime(350); });
    expect(result.current).toBe('ready');
  });
});
