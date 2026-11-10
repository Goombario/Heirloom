/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';

const mode = vi.hoisted(() => ({ data: 'http' as 'http' | 'local' }));
vi.mock('@/lib/data', () => ({ get DATA_MODE() { return mode.data; } }));
vi.mock('@/app/hooks/useMyTrees', () => ({
    useMyTrees: () => ({ trees: [{ Id: 1, Name: 'Brackens' }, { Id: 2, Name: 'Research' }], refresh: vi.fn() }),
}));
vi.mock('@/app/hooks/useDesktopMode', () => ({ useDesktopMode: () => false }));

import EraseAllSummary from '@/app/components/options/EraseAllSummary';

const fetchMock = vi.fn();

beforeEach(() => {
    mode.data = 'http';
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
            // One person on two trees counts once; a pending address counts too.
            shares: [{ SharedWithId: 5 }, { SharedWithId: 5 }, { SharedWithId: 6 }],
            pending: [{ Email: 'Aunt@example.test' }],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
});

const show = () => render(
    <NextIntlClientProvider locale="en" messages={en}>
        <EraseAllSummary open />
    </NextIntlClientProvider>,
);

// #1230: the dialog says every tree goes, who loses access, and the audit log.
describe('Erase all data summary (#1230)', () => {
    it('names the trees, counts the people who lose access and mentions the audit log', async () => {
        show();
        expect(screen.getByText('All 2 trees you own: Brackens and Research')).toBeInTheDocument();
        expect(await screen.findByText('Access for the 3 people you shared them with')).toBeInTheDocument();
        expect(screen.getByText(en.options.erase_item_audit)).toBeInTheDocument();
        expect(screen.getByText(`${en.options.erase_kept_shared} ${en.options.erase_one_tree_hint}`)).toBeInTheDocument();
    });

    it('leaves sharing out where there is none', () => {
        mode.data = 'local';
        show();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.queryByText(/shared them with/)).not.toBeInTheDocument();
        expect(screen.getByText(en.options.erase_one_tree_hint)).toBeInTheDocument();
    });
});
