/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const h = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: h.openUrl }));

import { ExternalLink } from '@/app/components/ExternalLink';
import { isWebUrl } from '@/lib/desktop';

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

/** Clicks the link and says whether the browser's own navigation would have run.
 *  A window listener runs after React's handler and always cancels the default,
 *  so happy-dom never actually follows the link. */
function click(name: string) {
    let prevented = false;
    const guard = (e: Event) => { prevented = e.defaultPrevented; e.preventDefault(); };
    window.addEventListener('click', guard);
    fireEvent.click(screen.getByRole('link', { name }));
    window.removeEventListener('click', guard);
    return !prevented;
}

describe('ExternalLink (#1020)', () => {
    afterEach(() => {
        delete (window as TauriWindow).__TAURI_INTERNALS__;
        h.openUrl.mockReset();
    });

    it('is a plain new-tab link on the web', () => {
        render(<ExternalLink href="https://example.org/record">Record</ExternalLink>);
        const link = screen.getByRole('link', { name: 'Record' });
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(click('Record')).toBe(true);
        expect(h.openUrl).not.toHaveBeenCalled();
    });

    it('opens the system browser in the desktop app', async () => {
        (window as TauriWindow).__TAURI_INTERNALS__ = {};
        h.openUrl.mockResolvedValue(undefined);
        render(<ExternalLink href=" https://example.org/record ">Record</ExternalLink>);
        expect(click('Record')).toBe(false);
        await waitFor(() => expect(h.openUrl).toHaveBeenCalledWith('https://example.org/record'));
    });

    it('does nothing in the desktop app for a link that is not http(s)', () => {
        (window as TauriWindow).__TAURI_INTERNALS__ = {};
        render(<ExternalLink href="www.example.org">Record</ExternalLink>);
        expect(click('Record')).toBe(false);
        expect(h.openUrl).not.toHaveBeenCalled();
    });

    it('leaves the click alone when a caller handled it', () => {
        (window as TauriWindow).__TAURI_INTERNALS__ = {};
        const onClick = vi.fn((e: React.MouseEvent) => e.preventDefault());
        render(<ExternalLink href="https://example.org" onClick={onClick}>Record</ExternalLink>);
        click('Record');
        expect(onClick).toHaveBeenCalled();
        expect(h.openUrl).not.toHaveBeenCalled();
    });

    it('treats only http(s) as a web link', () => {
        expect(isWebUrl('https://a.example')).toBe(true);
        expect(isWebUrl('HTTP://a.example')).toBe(true);
        expect(isWebUrl('mailto:a@example.org')).toBe(false);
        expect(isWebUrl('javascript:alert(1)')).toBe(false);
        expect(isWebUrl('file:///etc/passwd')).toBe(false);
    });
});
