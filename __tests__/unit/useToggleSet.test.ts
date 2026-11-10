/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToggleSet } from '@/app/hooks/useToggleSet';

describe('useToggleSet', () => {
    it('starts with every key closed', () => {
        const { result } = renderHook(() => useToggleSet());
        expect(result.current.isOpen('a')).toBe(false);
        expect(result.current.isOpen('anything')).toBe(false);
    });

    it('toggles a key open and closed', () => {
        const { result } = renderHook(() => useToggleSet());

        act(() => result.current.toggle('a'));
        expect(result.current.isOpen('a')).toBe(true);

        act(() => result.current.toggle('a'));
        expect(result.current.isOpen('a')).toBe(false);
    });

    it('tracks keys independently', () => {
        const { result } = renderHook(() => useToggleSet());

        act(() => result.current.toggle('a'));
        act(() => result.current.toggle('b'));
        expect(result.current.isOpen('a')).toBe(true);
        expect(result.current.isOpen('b')).toBe(true);

        act(() => result.current.toggle('a'));
        expect(result.current.isOpen('a')).toBe(false);
        // Closing 'a' must not affect 'b'.
        expect(result.current.isOpen('b')).toBe(true);
    });

    it('keeps a stable toggle identity across renders', () => {
        const { result, rerender } = renderHook(() => useToggleSet());
        const first = result.current.toggle;
        rerender();
        expect(result.current.toggle).toBe(first);
    });
});
