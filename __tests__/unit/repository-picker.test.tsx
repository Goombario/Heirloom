/** @vitest-environment happy-dom */

import { useState } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { dataCache } from '@/lib/data/cache';

const h = vi.hoisted(() => ({
    listRepositories: vi.fn(),
}));

vi.mock('@/lib/data', () => ({
    getDataClient: () => Promise.resolve({ repositories: { list: h.listRepositories } }),
}));
vi.mock('next-intl', () => ({
    useTranslations: (namespace: string) => (key: string, params?: Record<string, unknown>) =>
        params ? `${namespace}.${key} ${JSON.stringify(params)}` : `${namespace}.${key}`,
}));

import { RepositoryPicker } from '@/app/components/RepositoryPicker';

const repo = (Id: number, Name: string, SourceCount: number) => ({ Id, OwnerId: 1, TreeId: 7, Name, Address: null, CreatedAt: '', SourceCount });

function Harness({ initial = '', automatic }: { initial?: string; automatic?: string }) {
    const [value, setValue] = useState(initial);
    return (
        <>
            <RepositoryPicker id="sf-repository" label="Repository" treeId={7} value={value} onChange={setValue} automatic={automatic} />
            <output data-testid="value">{value}</output>
        </>
    );
}

const value = () => screen.getByTestId('value').textContent;

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /library\.repo_picker_choose|common\.change/ }));
    await waitFor(() => expect(screen.getByRole('option', { name: /National Archives/ })).toBeInTheDocument());
}

describe('RepositoryPicker (#469)', () => {
    beforeEach(() => {
        dataCache.clear();
        h.listRepositories.mockReset();
        h.listRepositories.mockResolvedValue([repo(1, 'National Archives', 3), repo(2, 'Kent History Centre', 1)]);
    });

    it("lists the tree's repositories and picks an existing one", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await openPicker(user);
        expect(h.listRepositories).toHaveBeenCalledWith(7);

        await user.click(screen.getByRole('option', { name: /Kent History Centre/ }));
        expect(value()).toBe('Kent History Centre');
        expect(screen.getByRole('group', { name: 'Repository' })).toHaveTextContent('Kent History Centre');
        expect(screen.getByText('library.repo_picker_in_tree {"count":1}')).toBeInTheDocument();
        // Focus returns to the Change button.
        expect(screen.getByRole('button', { name: 'common.change' })).toHaveFocus();
    });

    it('keeps Create a new repository as the last option, filtered or not', async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await openPicker(user);
        let options = screen.getAllByRole('option');
        expect(options).toHaveLength(3);
        expect(options[2]).toHaveTextContent('library.repo_picker_create');

        await user.type(screen.getByRole('combobox'), 'kent');
        options = screen.getAllByRole('option');
        expect(options.map((o) => o.textContent)).toEqual([
            expect.stringContaining('Kent History Centre'),
            expect.stringContaining('library.repo_picker_create_named {"name":"kent"}'),
        ]);
    });

    it('creates from the search text when it names no repository', async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await openPicker(user);
        await user.type(screen.getByRole('combobox'), '  Parish chest  ');
        expect(screen.getByText('library.repo_picker_no_match')).toBeInTheDocument();
        await user.click(screen.getByRole('option', { name: /repo_picker_create_named/ }));
        expect(value()).toBe('Parish chest');
        expect(screen.getByText('library.repo_picker_new_named {"name":"Parish chest"}')).toBeInTheDocument();
    });

    it('asks for a name when the search text already names a repository, and links a case-insensitive match', async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await openPicker(user);
        await user.type(screen.getByRole('combobox'), 'national archives');
        await user.click(screen.getByRole('option', { name: /library\.repo_picker_create$|repo_picker_name_it/ }));

        const nameInput = screen.getByRole('textbox', { name: 'library.repo_picker_new_name_label' });
        expect(nameInput).toHaveFocus();
        await user.type(nameInput, 'NATIONAL ARCHIVES{Enter}');
        expect(value()).toBe('National Archives');
    });

    it('picks with the arrow keys and Enter, and Escape closes without a change', async () => {
        const user = userEvent.setup();
        render(<Harness initial="Kent History Centre" />);
        await openPicker(user);
        await user.keyboard('{ArrowDown}{Enter}');
        expect(value()).toBe('National Archives');

        await openPicker(user);
        await user.keyboard('{ArrowDown}{ArrowDown}{Escape}');
        expect(value()).toBe('National Archives');
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });

    it('takes the typed text on Enter with nothing highlighted, matching an existing name ignoring case', async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await openPicker(user);
        await user.type(screen.getByRole('combobox'), 'kent history centre{Enter}');
        expect(value()).toBe('Kent History Centre');

        await openPicker(user);
        await user.type(screen.getByRole('combobox'), 'Parish chest{Enter}');
        expect(value()).toBe('Parish chest');
    });

    it("keeps Escape from reaching the surrounding dialog's document listener", async () => {
        const user = userEvent.setup();
        const onDocumentKey = vi.fn();
        document.addEventListener('keydown', onDocumentKey);
        try {
            render(<Harness />);
            await openPicker(user);
            await user.keyboard('{Escape}');
            expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
            expect(onDocumentKey.mock.calls.some(([e]) => (e as KeyboardEvent).key === 'Escape')).toBe(false);
        } finally {
            document.removeEventListener('keydown', onDocumentKey);
        }
    });

    it('removes the repository', async () => {
        const user = userEvent.setup();
        render(<Harness initial="National Archives" />);
        await user.click(screen.getByRole('button', { name: 'common.remove_named {"name":"National Archives"}' }));
        expect(value()).toBe('');
        expect(screen.getByText('library.repo_picker_none')).toBeInTheDocument();
    });

    describe('Automatic, from a record site (#1029)', () => {
        it('starts on Automatic and links the tree\'s repository of that name, ignoring case', async () => {
            h.listRepositories.mockResolvedValue([repo(1, 'National Archives', 3), repo(3, 'familysearch', 4)]);
            render(<Harness initial="FamilySearch" automatic="FamilySearch" />);
            await waitFor(() => expect(screen.getByText('library.repo_picker_in_tree {"count":4}')).toBeInTheDocument());
            expect(screen.getByText('library.repo_picker_automatic {"name":"familysearch"}')).toBeInTheDocument();
        });

        it('lists Automatic first and Create last, without repeating the site\'s repository', async () => {
            const user = userEvent.setup();
            h.listRepositories.mockResolvedValue([repo(1, 'National Archives', 3), repo(3, 'FamilySearch', 4)]);
            render(<Harness initial="FamilySearch" automatic="FamilySearch" />);
            await openPicker(user);
            const options = screen.getAllByRole('option');
            expect(options.map(o => o.textContent)).toEqual([
                expect.stringContaining('library.repo_picker_automatic'),
                expect.stringContaining('National Archives'),
                expect.stringContaining('library.repo_picker_create'),
            ]);
            await user.click(options[1]);
            expect(value()).toBe('National Archives');
            await user.click(screen.getByRole('button', { name: 'common.change' }));
            await user.click(screen.getByRole('option', { name: /repo_picker_automatic/ }));
            expect(value()).toBe('FamilySearch');
        });

        it('creates the site\'s repository by name when the tree has none', async () => {
            render(<Harness initial="FreeBMD" automatic="FreeBMD" />);
            await waitFor(() => expect(h.listRepositories).toHaveBeenCalled());
            expect(screen.getByText('library.repo_picker_automatic {"name":"FreeBMD"}')).toBeInTheDocument();
            expect(screen.getByText('library.repo_picker_created_on_save')).toBeInTheDocument();
        });
    });
});
