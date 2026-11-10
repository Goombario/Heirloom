/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { ValidationError } from '@/lib/validation';

const client = vi.hoisted(() => ({
    repositories: {
        create: vi.fn(),
        get: vi.fn(),
        sources: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
    },
}));
vi.mock('@/lib/data', () => ({ getDataClient: async () => client }));
vi.mock('@/app/components/useErrorToast', () => ({ useErrorToast: () => ({ redirectIfUnauthorized: () => false }) }));

import RepositoryModal from '@/app/library/RepositoryModal';

const show = (repositoryId: number | null) => render(
    <NextIntlClientProvider locale="en" messages={en}>
        <RepositoryModal repositoryId={repositoryId} treeId={1} canEdit canDelete onClose={vi.fn()} onChanged={vi.fn()} onOpenSource={vi.fn()} />
    </NextIntlClientProvider>,
);

beforeEach(() => {
    vi.clearAllMocks();
    client.repositories.get.mockResolvedValue({ Id: 7, Name: 'County archive', Address: null });
    client.repositories.sources.mockResolvedValue([]);
});

// #1232: smoke-test findings on the repository dialog.
describe('RepositoryModal', () => {
    it('is named by its title and labels its fields', () => {
        show(null);
        expect(screen.getByRole('dialog', { name: en.library.repo_create_title })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: en.library.repo_field_name })).toBeInTheDocument();
    });

    it('says when the name is already taken', async () => {
        client.repositories.create.mockRejectedValue(new ValidationError('A repository with this name already exists'));
        show(null);
        fireEvent.change(screen.getByRole('textbox', { name: en.library.repo_field_name }), { target: { value: 'County archive' } });
        fireEvent.click(screen.getByRole('button', { name: en.common.create }));
        expect(await screen.findByRole('alert')).toHaveTextContent(en.library.repo_name_taken);
    });

    it('asks before deleting, in the app dialog', async () => {
        client.repositories.remove.mockResolvedValue(undefined);
        show(7);
        await screen.findByDisplayValue('County archive');
        fireEvent.click(screen.getByRole('button', { name: en.common.delete }));
        expect(client.repositories.remove).not.toHaveBeenCalled();
        const confirm = await screen.findByRole('dialog', { name: en.library.repo_delete_title });
        fireEvent.click(within(confirm).getByRole('button', { name: en.common.delete }));
        await waitFor(() => expect(client.repositories.remove).toHaveBeenCalledWith(7, 1));
    });
});
