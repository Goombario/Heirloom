/** @vitest-environment happy-dom */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { dataCache } from '@/lib/data/cache';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const h = vi.hoisted(() => ({
    listForFact: vi.fn(),
    listSources: vi.fn(),
    listRecent: vi.fn(),
    createSource: vi.fn(),
    createCitation: vi.fn(),
    onClose: vi.fn(),
}));

vi.mock('@/lib/data', () => ({
    getDataClient: () => Promise.resolve({
        citations: { listForFact: h.listForFact, update: vi.fn(), create: h.createCitation, remove: vi.fn() },
        sources: { list: h.listSources, listRecentlyCited: h.listRecent, create: h.createSource },
        repositories: { list: () => Promise.resolve([]) },
    }),
}));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 7 }), useActiveTreeIdIfAny: () => null }));
vi.mock('@/app/components/useErrorToast', () => ({ useErrorToast: () => ({ redirectIfUnauthorized: () => false }) }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/app/hooks/useFocusTrap', () => ({ useFocusTrap: () => ({ current: null }) }));
vi.mock('@/lib/desktop', () => ({
    isDesktopApp: () => true,
    isWebUrl: (url: string) => /^https?:\/\//i.test(url),
    openInSystemBrowser: () => Promise.resolve(),
}));
vi.mock('next-intl', () => ({
    useTranslations: (ns?: string) => (key: string, values?: Record<string, unknown>) => {
        const full = ns ? `${ns}.${key}` : key;
        return values ? `${full}:${Object.values(values).join(',')}` : full;
    },
}));

import AttachSourceSidebar from '@/app/components/AttachSourceSidebar';
import { personResearchSubject } from '@/lib/research/subject';

const research = personResearchSubject(
    {
        FirstName: 'Edith', LastName: 'Hollis', Sex: 'F', BirthDate: '1868', BirthPlace: 'Maidstone, Kent, England',
        DeathDate: null, DeathPlace: null, IsDeceased: 1,
    },
    [],
    'PersonBirth',
    1,
    2026,
)!;

function renderSidebar(props: Partial<React.ComponentProps<typeof AttachSourceSidebar>> = {}) {
    return render(
        <AttachSourceSidebar factTable="PersonBirth" factId={1} factLabel="Birth" onClose={h.onClose} research={research} {...props} />,
    );
}

describe('AttachSourceSidebar Search records tab', () => {
    beforeEach(() => {
        h.listForFact.mockResolvedValue([]);
        h.listSources.mockResolvedValue({ sources: [] });
        h.listRecent.mockResolvedValue([]);
        h.createSource.mockReset();
        h.createCitation.mockReset();
        h.onClose.mockReset();
        dataCache.clear();
    });

    it('adds the tab beside Attached and Add source, and keeps edits across tabs', async () => {
        const user = userEvent.setup();
        renderSidebar();
        await user.click(screen.getAllByRole('button', { name: 'research.tab' })[0]);
        expect(screen.getByRole('link', { name: 'research.open_site:FreeBMD' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'research.leave_out:research.details.given' }));
        await user.click(screen.getByRole('button', { name: /^library\.tab_attached/ }));
        await user.click(screen.getAllByRole('button', { name: 'research.tab' })[0]);
        expect(screen.getByRole('button', { name: 'research.restore_detail:research.details.given' })).toBeInTheDocument();
    });

    it('has no tab without a research subject', () => {
        renderSidebar({ research: null });
        expect(screen.queryByRole('button', { name: 'research.tab' })).not.toBeInTheDocument();
    });

    it('gives a viewer only the search, without citing', async () => {
        const user = userEvent.setup();
        renderSidebar({ canCite: false, initialView: 'search' });
        expect(screen.getByRole('dialog', { name: 'research.tab' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'library.tab_add_source' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('link', { name: 'research.open_site:FamilySearch' }));
        expect(screen.queryByRole('button', { name: 'research.found_it' })).not.toBeInTheDocument();
    });

    async function findIt(user: ReturnType<typeof userEvent.setup>, site: string) {
        await user.click(screen.getAllByRole('button', { name: 'research.tab' })[0]);
        await user.click(screen.getByRole('link', { name: `research.open_site:${site}` }));
        await user.click(screen.getByRole('button', { name: 'research.found_it' }));
    }

    it('cites a find through Create new, with only what the site settles and Automatic first (#1029)', async () => {
        const user = userEvent.setup();
        h.createSource.mockResolvedValue({ Id: 30 });
        h.createCitation.mockResolvedValue({ Id: 31 });
        renderSidebar();
        await findIt(user, 'FreeBMD');

        expect(screen.getByText('· research.cite_from:FreeBMD')).toBeInTheDocument();
        expect(document.getElementById('attach-create-title')).toHaveValue('England and Wales Civil Registration Birth Index');
        expect(document.getElementById('attach-create-author')).toHaveValue('');
        await waitFor(() => expect(screen.getByText('library.repo_picker_automatic:FreeBMD')).toBeInTheDocument());

        await user.type(screen.getByLabelText('library.field_record_link'), 'https://www.freebmd.org.uk/cgi/information.pl?r=1');
        await user.click(screen.getByRole('button', { name: 'library.create_attach' }));

        await waitFor(() => expect(h.createCitation).toHaveBeenCalled());
        expect(h.createSource).toHaveBeenCalledWith(expect.objectContaining({
            Title: 'England and Wales Civil Registration Birth Index', Type: 'Vital', RepositoryName: 'FreeBMD',
        }), 7);
        expect(h.createCitation).toHaveBeenCalledWith(expect.objectContaining({
            FactTable: 'PersonBirth', FactId: 1, SourceId: 30, Url: 'https://www.freebmd.org.uk/cgi/information.pl?r=1',
        }), 7);
        // Back on the search, with the site marked Cited.
        expect(await screen.findByText('· research.state_cited')).toBeInTheDocument();
        expect(h.onClose).not.toHaveBeenCalled();
    });

    it('starts a site that settles nothing with a blank title and the usual type', async () => {
        const user = userEvent.setup();
        renderSidebar();
        await findIt(user, 'FamilySearch');
        expect(document.getElementById('attach-create-title')).toHaveValue('');
        await waitFor(() => expect(screen.getByText('library.repo_picker_automatic:FamilySearch')).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'research.back_to_search' }));
        expect(screen.getByRole('link', { name: 'research.open_site:FamilySearch' })).toBeVisible();
    });
});

