/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDelayedFlag } from '@/app/hooks/useDelayedFlag';

const setup = (flag: boolean) =>
    renderHook(({ flag }) => useDelayedFlag(flag, 400, 600), { initialProps: { flag } });

describe('useDelayedFlag', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('stays false when the flag clears before the delay', () => {
        const { result, rerender } = setup(true);
        expect(result.current).toBe(false);
        act(() => vi.advanceTimersByTime(399));
        rerender({ flag: false });
        act(() => vi.advanceTimersByTime(2000));
        expect(result.current).toBe(false);
    });

    it('holds true for the minimum time after the flag clears early', () => {
        const { result, rerender } = setup(true);
        act(() => vi.advanceTimersByTime(400));
        expect(result.current).toBe(true);
        act(() => vi.advanceTimersByTime(100));
        rerender({ flag: false });
        act(() => vi.advanceTimersByTime(499));
        expect(result.current).toBe(true);
        act(() => vi.advanceTimersByTime(1));
        expect(result.current).toBe(false);
    });

    it('clears right away once the minimum time has passed', () => {
        const { result, rerender } = setup(true);
        act(() => vi.advanceTimersByTime(1500));
        expect(result.current).toBe(true);
        rerender({ flag: false });
        act(() => vi.advanceTimersByTime(0));
        expect(result.current).toBe(false);
    });

    it('stays shown when the flag rises again during the hold', () => {
        const { result, rerender } = setup(true);
        act(() => vi.advanceTimersByTime(400));
        rerender({ flag: false });
        act(() => vi.advanceTimersByTime(200));
        rerender({ flag: true });
        act(() => vi.advanceTimersByTime(2000));
        expect(result.current).toBe(true);
    });
});
