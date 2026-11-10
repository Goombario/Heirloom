/** @vitest-environment happy-dom */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const h = vi.hoisted(() => ({
    activeTreeId: 7,
    listForFact: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    listSources: vi.fn(),
    listRecent: vi.fn(),
}));

vi.mock('@/lib/data', () => ({
    getDataClient: () => Promise.resolve({
        citations: {
            listForFact: h.listForFact,
            update: h.update,
            create: h.create,
            remove: vi.fn(),
        },
        sources: { list: h.listSources, listRecentlyCited: h.listRecent },
    }),
}));
vi.mock('@/app/contexts/TreeContext', () => ({
    useTree: () => ({ activeTreeId: h.activeTreeId }),
}));
vi.mock('@/app/components/useErrorToast', () => ({
    useErrorToast: () => ({ redirectIfUnauthorized: () => false }),
}));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/app/hooks/useFocusTrap', () => ({ useFocusTrap: () => ({ current: null }) }));
vi.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

import AttachSourceSidebar from '@/app/components/AttachSourceSidebar';

const citation = {
    Id: 5,
    SourceId: 10,
    sourceTitle: 'Fictional civil register',
    sourceType: 'Vital',
    sourceRepo: 'Fictional archives',
    Page: 'p. 42',
    Quay: '3',
    DataText: 'Born at the family home',
    Url: 'https://records.example.org/entry/42',
};

function renderEditor(existingCitations?: typeof citation[]) {
    return render(
        <AttachSourceSidebar
            factTable="People"
            factId={7}
            factLabel="Birth"
            existingCitations={existingCitations}
            initialCitationId={5}
            onClose={() => {}}
        />,
    );
}

describe('AttachSourceSidebar citation editor', () => {
    beforeEach(() => {
        h.activeTreeId = 7;
        h.listForFact.mockReset();
        h.update.mockReset();
        h.create.mockReset();
        h.listSources.mockReset();
        h.listForFact.mockResolvedValue([citation]);
        h.update.mockResolvedValue(citation);
        h.listSources.mockResolvedValue({ sources: [] });
        h.listRecent.mockReset();
        h.listRecent.mockResolvedValue([]);
    });

    it('titles the drawer Edit citation and labels every evidence field (#800, EV-8)', async () => {
        render(<AttachSourceSidebar factTable="People" factId={7} factLabel="Birth" existingCitations={[citation]} initialCitationId={5} onClose={() => {}} />);

        expect(await screen.findByRole('dialog', { name: 'edit_citation' })).toBeInTheDocument();
        expect(screen.getByLabelText('citation_detail')).toHaveValue('p. 42');
        expect(screen.getByRole('radiogroup', { name: 'field_certainty' })).toBeInTheDocument();
        expect(screen.getByLabelText('field_transcription')).toHaveValue('Born at the family home');
    });

    it('titles the drawer Attach source and labels the new citation fields (#800)', async () => {
        const user = userEvent.setup();
        h.listSources.mockResolvedValue({ sources: [{ Id: 10, Title: 'Fictional register', Type: 'Vital', Author: null, RepositoryName: null }] });
        render(<AttachSourceSidebar factTable="People" factId={7} factLabel="Birth" initialView="add" onClose={() => {}} />);

        expect(screen.getByRole('dialog', { name: 'attach_title' })).toBeInTheDocument();
        await user.click(await screen.findByRole('button', { name: /Fictional register/ }));
        expect(screen.getByLabelText('citation_detail')).toHaveAttribute('placeholder', 'ph_page_optional');
        expect(screen.getByRole('radiogroup', { name: 'field_certainty' })).toBeInTheDocument();
        expect(screen.getByLabelText('field_transcription')).toBeInTheDocument();
    });

    it('hydrates a deep-linked citation and preserves its values on save', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(
            <AttachSourceSidebar
                factTable="People"
                factId={7}
                factLabel="Birth"
                existingCitations={[citation]}
                initialCitationId={5}
                onClose={onClose}
            />,
        );

        const page = await screen.findByDisplayValue('p. 42');
        expect(screen.getByRole('radio', { name: 'certainty_3' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByDisplayValue('Born at the family home')).toBeInTheDocument();
        expect(screen.getByDisplayValue('https://records.example.org/entry/42')).toBeInTheDocument();

        await user.clear(page);
        await user.type(page, 'p. 43');
        await user.click(screen.getByRole('button', { name: 'save' }));

        await waitFor(() => expect(h.update).toHaveBeenCalledWith(
            5,
            { Page: 'p. 43', Quay: '3', DataText: 'Born at the family home', Url: 'https://records.example.org/entry/42' },
            7,
        ));
        await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    });

    it('clears a citation\'s record link', async () => {
        const user = userEvent.setup();
        renderEditor([citation]);

        await user.clear(await screen.findByLabelText('field_record_link'));
        await user.click(screen.getByRole('button', { name: 'save' }));

        await waitFor(() => expect(h.update).toHaveBeenCalledWith(
            5,
            { Page: 'p. 42', Quay: '3', DataText: 'Born at the family home', Url: null },
            7,
        ));
    });

    it('closes after attaching a source from an empty tag', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        h.listSources.mockResolvedValue({ sources: [{ Id: 10, Title: 'Fictional register', Type: 'Vital', Author: null, RepositoryName: null }] });
        h.create.mockResolvedValue({ Id: 11 });
        render(
            <AttachSourceSidebar
                factTable="People"
                factId={7}
                factLabel="Birth"
                initialView="add"
                onClose={onClose}
            />,
        );

        await user.click(await screen.findByRole('button', { name: /Fictional register/ }));
        await user.type(screen.getByLabelText('field_record_link'), 'https://records.example.org/entry/7');
        await user.click(screen.getByRole('button', { name: 'attach_title' }));

        await waitFor(() => expect(h.create).toHaveBeenCalledWith(
            { FactTable: 'People', FactId: 7, SourceId: 10, Page: null, Quay: null, DataText: null, Url: 'https://records.example.org/entry/7' },
            7,
        ));
        await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    });

    it('lists recently cited sources first, then the rest, until a search (#799)', async () => {
        const user = userEvent.setup();
        const census = { Id: 12, Title: '1901 Census, household 12', Type: 'Census', Author: null, RepositoryName: null };
        const register = { Id: 10, Title: 'Fictional register', Type: 'Vital', Author: null, RepositoryName: null };
        h.listSources.mockResolvedValue({ sources: [census, register] });
        h.listRecent.mockResolvedValue([census]);
        h.create.mockResolvedValue({ Id: 11 });
        render(<AttachSourceSidebar factTable="PersonBirth" factId={7} factLabel="Birth" initialView="add" onClose={() => {}} />);

        const recent = await screen.findByRole('group', { name: 'recently_cited' });
        expect(recent).toHaveTextContent('1901 Census, household 12');
        const all = screen.getByRole('group', { name: 'all_sources' });
        expect(all).toHaveTextContent('Fictional register');
        expect(all).not.toHaveTextContent('1901 Census');

        await user.click(screen.getByRole('button', { name: /1901 Census/ }));
        await user.click(screen.getByRole('button', { name: 'attach_title' }));
        await waitFor(() => expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ FactTable: 'PersonBirth', SourceId: 12 }), 7));
    });

    it('still lists every source when the recent lookup fails', async () => {
        h.listSources.mockResolvedValue({ sources: [{ Id: 10, Title: 'Fictional register', Type: 'Vital', Author: null, RepositoryName: null }] });
        h.listRecent.mockRejectedValue(new Error('offline'));
        render(<AttachSourceSidebar factTable="PersonBirth" factId={7} factLabel="Birth" initialView="add" onClose={() => {}} />);
        expect(await screen.findByRole('button', { name: /Fictional register/ })).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'recently_cited' })).not.toBeInTheDocument();
    });

    it('hydrates after async refresh without overwriting an edit on a later refresh', async () => {
        const user = userEvent.setup();
        let resolveRows!: (rows: typeof citation[]) => void;
        h.listForFact.mockImplementationOnce(() => new Promise(resolve => { resolveRows = resolve; }));
        const view = renderEditor();

        expect(screen.queryByDisplayValue('p. 42')).not.toBeInTheDocument();
        await waitFor(() => expect(h.listForFact).toHaveBeenCalled());
        resolveRows([citation]);
        const page = await screen.findByDisplayValue('p. 42');

        await user.clear(page);
        await user.type(page, 'p. 99');

        h.activeTreeId = 8;
        view.rerender(
            <AttachSourceSidebar
                factTable="People"
                factId={7}
                factLabel="Birth"
                initialCitationId={5}
                onClose={() => {}}
            />,
        );

        await waitFor(() => expect(h.listForFact).toHaveBeenCalledWith('People', 7, 8));
        expect(screen.getByDisplayValue('p. 99')).toBeInTheDocument();
    });
});
