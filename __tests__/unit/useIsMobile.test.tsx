/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { useIsMobile } from '@/app/hooks/useIsMobile';

function mockMatchMedia(matches: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

describe('useIsMobile', () => {
    beforeEach(() => { vi.restoreAllMocks(); });

    it('returns true when the viewport matches the mobile query', () => {
        mockMatchMedia(true);
        const { result } = renderHook(() => useIsMobile());
        expect(result.current).toBe(true);
    });

    it('returns false when the viewport does not match', () => {
        mockMatchMedia(false);
        const { result } = renderHook(() => useIsMobile());
        expect(result.current).toBe(false);
    });

    it('updates when the matchMedia change event fires', () => {
        let matches = false;
        let handler: (() => void) | null = null;
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            get matches() { return matches; },
            media: query,
            onchange: null,
            addEventListener: (_: string, cb: () => void) => { handler = cb; },
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        const { result } = renderHook(() => useIsMobile());
        expect(result.current).toBe(false);
        act(() => { matches = true; handler?.(); });
        expect(result.current).toBe(true);
    });

    it('hydrates a phone against the desktop prerender without a mismatch, then switches (#845)', async () => {
        function Layout() {
            return useIsMobile() ? <section>mobile</section> : <main>desktop</main>;
        }
        // The static prerender runs with no viewport: desktop.
        mockMatchMedia(false);
        const container = document.createElement('div');
        container.innerHTML = renderToString(<Layout />);
        document.body.appendChild(container);

        mockMatchMedia(true);
        const onRecoverableError = vi.fn();
        await act(async () => { hydrateRoot(container, <Layout />, { onRecoverableError }); });
        expect(onRecoverableError).not.toHaveBeenCalled();
        expect(container.innerHTML).toBe('<section>mobile</section>');
        container.remove();
    });
});
