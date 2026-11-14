/** @vitest-environment happy-dom */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCountUp } from '@/app/hooks/useCountUp';

let frames: FrameRequestCallback[] = [];
let now = 0;
const step = (ms: number) => act(() => { now += ms; const run = frames; frames = []; run.forEach((f) => f(now)); });

function mockMotion(reduced: boolean) {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduced && q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
}

describe('useCountUp (#20)', () => {
    beforeEach(() => {
        frames = [];
        now = 0;
        window.sessionStorage.clear();
        vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { frames.push(f); return frames.length; });
        vi.stubGlobal('cancelAnimationFrame', () => {});
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        mockMotion(false);
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it('counts up from zero to the value, then once only per tab', () => {
        const { result, unmount } = renderHook(() => useCountUp(1200, 'k'));
        expect(result.current).toBe(0);
        step(300);
        expect(result.current).toBeGreaterThan(0);
        expect(result.current).toBeLessThan(1200);
        step(400);
        expect(result.current).toBe(1200);
        unmount();
        const again = renderHook(() => useCountUp(1200, 'k'));
        expect(again.result.current).toBe(1200);
        expect(frames).toHaveLength(0);
    });

    it('shows the final number at once with reduced motion', () => {
        mockMotion(true);
        const { result } = renderHook(() => useCountUp(48, 'r'));
        expect(result.current).toBe(48);
        expect(frames).toHaveLength(0);
    });

    it('waits for ready before counting', () => {
        const { result, rerender } = renderHook(({ ready }) => useCountUp(10, 'w', ready), { initialProps: { ready: false } });
        expect(result.current).toBe(10);
        expect(window.sessionStorage.getItem('w')).toBeNull();
        rerender({ ready: true });
        expect(result.current).toBe(0);
    });
});
