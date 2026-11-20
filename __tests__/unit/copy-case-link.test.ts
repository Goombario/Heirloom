/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/app/components/ui', () => ({ showSuccessToast: toasts.success, showErrorToast: toasts.error }));

import { copyCaseLink } from '@/app/cases/view/copyCaseLink';

const messages = { copied: 'Link copied', failed: 'Couldn’t copy the link' };

afterEach(() => { vi.unstubAllGlobals(); toasts.success.mockReset(); toasts.error.mockReset(); });

function stubClipboard(clipboard: unknown) {
    vi.stubGlobal('navigator', { ...navigator, clipboard });
}

describe('copyCaseLink (#191)', () => {
    it('copies the address and says so', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        stubClipboard({ writeText });
        await expect(copyCaseLink(messages)).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith(window.location.href);
        expect(toasts.success).toHaveBeenCalledWith('Link copied');
    });

    it('shows an error toast instead of rejecting when the clipboard is refused', async () => {
        stubClipboard({ writeText: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) });
        await expect(copyCaseLink(messages)).resolves.toBe(false);
        expect(toasts.error).toHaveBeenCalledWith('Couldn’t copy the link');
        expect(toasts.success).not.toHaveBeenCalled();
    });

    it('shows the error toast when there is no clipboard at all', async () => {
        stubClipboard(undefined);
        await expect(copyCaseLink(messages)).resolves.toBe(false);
        expect(toasts.error).toHaveBeenCalledTimes(1);
    });
});
