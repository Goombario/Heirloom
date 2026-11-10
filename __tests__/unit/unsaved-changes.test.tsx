/** @vitest-environment happy-dom */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useEffect } from 'react';
import { UnsavedChangesProvider, useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';

vi.mock('next-intl', () => ({
    useTranslations: () => (key: string) => `common.${key}`,
}));

function Probe({ dirty, onReady }: { dirty: boolean; onReady: (guard: ReturnType<typeof useUnsavedChangesGuard>) => void }) {
    const guard = useUnsavedChangesGuard(dirty);
    useEffect(() => onReady(guard), [guard, onReady]);
    return null;
}

describe('UnsavedChangesProvider', () => {
    beforeEach(() => vi.stubGlobal('confirm', vi.fn().mockReturnValue(false)));
    afterEach(() => vi.unstubAllGlobals());

    it('guards multiple registrations and removes the hard-unload listener when clean', async () => {
        const first = vi.fn();
        const second = vi.fn();
        const view = render(
            <UnsavedChangesProvider>
                <Probe dirty onReady={first} />
                <Probe dirty={false} onReady={second} />
            </UnsavedChangesProvider>,
        );
        await waitFor(() => expect(first).toHaveBeenCalled());

        const blocked = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(blocked);
        expect(blocked.defaultPrevented).toBe(true);

        view.rerender(
            <UnsavedChangesProvider>
                <Probe dirty={false} onReady={first} />
                <Probe dirty={false} onReady={second} />
            </UnsavedChangesProvider>,
        );
        await waitFor(() => {
            const clean = new Event('beforeunload', { cancelable: true });
            window.dispatchEvent(clean);
            expect(clean.defaultPrevented).toBe(false);
        });

        const currentPoint = window.history.state.__heirloomHistoryPoint as number;
        window.dispatchEvent(new PopStateEvent('popstate', {
            state: { ...window.history.state, __heirloomHistoryPoint: currentPoint - 1 },
        }));
        expect(window.confirm).not.toHaveBeenCalled();
    });

    it('cancels Next navigation when the user declines the synchronous prompt', async () => {
        const ready = vi.fn();
        render(
            <UnsavedChangesProvider>
                <Probe dirty onReady={ready} />
            </UnsavedChangesProvider>,
        );
        await waitFor(() => expect(ready).toHaveBeenCalled());

        const event = { preventDefault: vi.fn(), defaultPrevented: false };
        ready.mock.calls.at(-1)?.[0].onNavigate(event);
        expect(window.confirm).toHaveBeenCalledWith('common.unsaved_changes_confirm');
        expect(event.preventDefault).toHaveBeenCalledOnce();
    });

    it('allows navigation after confirmation', async () => {
        vi.mocked(window.confirm).mockReturnValue(true);
        const ready = vi.fn();
        render(
            <UnsavedChangesProvider>
                <Probe dirty onReady={ready} />
            </UnsavedChangesProvider>,
        );
        await waitFor(() => expect(ready).toHaveBeenCalled());

        const event = { preventDefault: vi.fn(), defaultPrevented: false };
        ready.mock.calls.at(-1)?.[0].onNavigate(event);
        expect(event.preventDefault).not.toHaveBeenCalled();
    });
});
