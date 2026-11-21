/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// #18: Home says once that the browser may clear the tree.
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/data', () => ({ DATA_MODE: 'local' }));
vi.mock('@/lib/desktop', () => ({ isDesktopApp: () => false }));
vi.mock('@/app/components/backup/BackupModal', () => ({ default: () => null }));

import StorageNotice from '@/app/components/backup/StorageNotice';
import { PERSIST_ANSWERED_EVENT, STORAGE_NOTICE_DISMISSED_KEY } from '@/app/components/backup/storagePersistence';

function stubPersisted(value: boolean) {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: vi.fn(async () => value), persist: vi.fn(async () => value) } });
}

describe('StorageNotice (#18)', () => {
    beforeEach(() => { localStorage.clear(); });
    afterEach(() => { Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined }); });

    it('shows on Home after an earlier refusal, and Got it hides it for good', async () => {
        localStorage.setItem('heirloom_local_first_run_seen', '1');
        stubPersisted(false);
        render(<StorageNotice placement="desktop" />);
        expect(await screen.findByText('title')).toBeTruthy();
        fireEvent.click(screen.getByText('got_it'));
        expect(screen.queryByText('title')).toBeNull();
        expect(localStorage.getItem(STORAGE_NOTICE_DISMISSED_KEY)).toBe('1');
    });

    it('How to keep it opens the advice', async () => {
        localStorage.setItem('heirloom_local_first_run_seen', '1');
        stubPersisted(false);
        render(<StorageNotice placement="desktop" />);
        fireEvent.click(await screen.findByText('how_to_keep'));
        expect(screen.getByText('how_body')).toBeTruthy();
    });

    it('stays hidden when the browser keeps the data, or after Got it', async () => {
        localStorage.setItem('heirloom_local_first_run_seen', '1');
        stubPersisted(true);
        const { unmount } = render(<StorageNotice placement="desktop" />);
        await act(async () => {});
        expect(screen.queryByText('title')).toBeNull();
        unmount();
        stubPersisted(false);
        localStorage.setItem(STORAGE_NOTICE_DISMISSED_KEY, '1');
        render(<StorageNotice placement="desktop" />);
        await act(async () => {});
        expect(screen.queryByText('title')).toBeNull();
    });

    it('on a first visit, waits for the first-run answer instead of reading too early', async () => {
        stubPersisted(false);
        render(<StorageNotice placement="desktop" />);
        await act(async () => {});
        expect(screen.queryByText('title')).toBeNull();
        act(() => { window.dispatchEvent(new CustomEvent(PERSIST_ANSWERED_EVENT, { detail: 'not_kept' })); });
        expect(screen.getByText('title')).toBeTruthy();
    });
});
