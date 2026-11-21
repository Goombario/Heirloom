/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TreeNotEmptyError } from '@/lib/data/errors';

// Options › Trees › Delete (#36): an empty tree gets a simple confirm, a tree with
// data keeps type-the-name, and a tree that fills meanwhile falls back to it.

const h = vi.hoisted(() => ({
    getIsEmpty: vi.fn(),
    remove: vi.fn(),
    refresh: vi.fn(async () => {}),
}));

vi.mock('next-intl', () => ({
    useTranslations: () => (key: string, values?: Record<string, string>) => (values?.name ? `${key}:${values.name}` : key),
}));
vi.mock('@/lib/data', () => ({
    getDataClient: async () => ({ trees: { getIsEmpty: h.getIsEmpty, remove: h.remove } }),
}));
vi.mock('@/app/hooks/useMyTrees', () => ({
    useMyTrees: () => ({
        trees: [
            { Id: 1, Name: 'Main', CreatedAt: '2026-01-01T00:00:00Z', OwnerId: 1 },
            { Id: 2, Name: 'Stray', CreatedAt: '2026-01-02T00:00:00Z', OwnerId: 1 },
        ],
        refresh: h.refresh,
    }),
}));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 1, switchToDefaultTree: vi.fn() }) }));
vi.mock('@/app/hooks/useTreeDisplayName', () => ({ useTreeDisplayName: () => (n: string) => n }));
vi.mock('@/app/hooks/useTimestamp', () => ({ useTimestamp: () => ({ timestamp: () => '1 Jan 2026' }) }));

import TreesSection from '@/app/components/options/TreesSection';

async function openDelete() {
    render(<TreesSection />);
    fireEvent.click(screen.getAllByRole('button', { name: 'trees_delete' })[1]);
}

describe('TreesSection delete (#36)', () => {
    beforeEach(() => { h.getIsEmpty.mockReset(); h.remove.mockReset(); });

    it('an empty tree asks once, with no name to type, and deletes with onlyIfEmpty', async () => {
        h.getIsEmpty.mockResolvedValue(true);
        h.remove.mockResolvedValue({ cleanupWarningCount: 0 });
        await openDelete();
        expect(await screen.findByText('trees_delete_empty_title:Stray')).toBeTruthy();
        expect(screen.queryByLabelText('trees_delete_type_name')).toBeNull();
        const dialog = screen.getByRole('dialog');
        fireEvent.click([...dialog.querySelectorAll('button')].find((b) => b.textContent === 'trees_delete')!);
        await waitFor(() => expect(h.remove).toHaveBeenCalledWith(2, { onlyIfEmpty: true }));
    });

    it('a tree with data keeps the type-the-name confirm', async () => {
        h.getIsEmpty.mockResolvedValue(false);
        await openDelete();
        expect(await screen.findByLabelText('trees_delete_type_name')).toBeTruthy();
        expect(screen.queryByText('trees_delete_empty_title:Stray')).toBeNull();
    });

    it('a tree that filled after the dialog opened falls back to type-the-name', async () => {
        h.getIsEmpty.mockResolvedValue(true);
        h.remove.mockRejectedValue(new TreeNotEmptyError());
        await openDelete();
        await screen.findByText('trees_delete_empty_title:Stray');
        const dialog = screen.getByRole('dialog');
        fireEvent.click([...dialog.querySelectorAll('button')].find((b) => b.textContent === 'trees_delete')!);
        expect(await screen.findByLabelText('trees_delete_type_name')).toBeTruthy();
        expect(screen.getByText('trees_delete_no_longer_empty')).toBeTruthy();
    });
});
