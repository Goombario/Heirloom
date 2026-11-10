/** @vitest-environment happy-dom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.hoisted(() => vi.fn());
const linkToOwner = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('next-intl', () => {
    const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);
    (t as unknown as { rich: (key: string) => string }).rich = (key: string) => key;
    return { useLocale: () => 'en', useTranslations: () => t };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('@/app/components/MediaImg', () => ({ default: () => null }));
vi.mock('@/app/components/useErrorToast', () => ({ useErrorToast: () => ({ reportError: vi.fn(), redirectIfUnauthorized: () => false }) }));
vi.mock('@/lib/data', () => {
    const client = {
        media: {
            list,
            listForOwner: vi.fn().mockResolvedValue([]),
            linkToOwner,
            findDuplicates: vi.fn().mockResolvedValue([]),
        },
    };
    return {
        getDataClient: vi.fn().mockResolvedValue(client),
        withWriteBatch: (run: (c: typeof client) => Promise<unknown>) => run(client),
    };
});

import AddMediaModal from '@/app/components/media/AddMediaModal';

describe('AddMediaModal on a phone (#1204)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        list.mockResolvedValue({ media: [{ Id: 1, Title: 'Wedding, 1882' }, { Id: 2, Title: 'Farm' }], count: 2 });
    });

    it('starts with the Upload from this phone row, then counts picks on the Add pill', async () => {
        const onAdded = vi.fn();
        render(<AddMediaModal target={{ kind: 'owner', ownerTable: 'Families', ownerId: 3 }} treeId={1} onClose={vi.fn()} onAdded={onAdded} />);
        expect(screen.getByRole('button', { name: /upload_phone/ })).toBeInTheDocument();

        fireEvent.click(await screen.findByRole('button', { name: 'Wedding, 1882' }));
        const add = screen.getByRole('button', { name: 'add_n:{"count":1}' });
        await waitFor(() => expect(add).toBeEnabled());
        fireEvent.click(add);
        await waitFor(() => expect(onAdded).toHaveBeenCalled());
        expect(linkToOwner).toHaveBeenCalledWith(1, 'Families', 3, 1, undefined);
    });

    it('says nothing matches with Clear search', async () => {
        render(<AddMediaModal target={{ kind: 'owner', ownerTable: 'Families', ownerId: 3 }} treeId={1} onClose={vi.fn()} onAdded={vi.fn()} />);
        await screen.findByRole('button', { name: 'Farm' });
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
        expect(screen.getByText(/no_match_title/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'clear_search' }));
        expect(screen.getByRole('button', { name: 'Farm' })).toBeInTheDocument();
    });

    it('opens the photo picker at once when the library is empty', async () => {
        list.mockResolvedValue({ media: [], count: 0 });
        const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
        render(<AddMediaModal target={{ kind: 'owner', ownerTable: 'Families', ownerId: 3 }} treeId={1} onClose={vi.fn()} onAdded={vi.fn()} />);
        await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
        expect(screen.getByText('phone_empty_title')).toBeInTheDocument();
        click.mockRestore();
    });
});
