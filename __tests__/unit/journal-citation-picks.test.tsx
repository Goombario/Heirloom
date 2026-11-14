/** @vitest-environment happy-dom */
// #34, option A: a journal entry copies a citation the case or its people already
// have. Picking one prefills the entry's citation; saving still queues its own.
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import type { Citation } from '@/lib/db/queries/citations';
import type { CaseCitation } from '@/lib/db/schema';

const h = vi.hoisted(() => ({ onPending: vi.fn(), onClose: vi.fn() }));

vi.mock('@/lib/data', () => ({
    getDataClient: () => Promise.resolve({
        citations: { listForFact: vi.fn().mockResolvedValue([]) },
        sources: { list: () => Promise.resolve({ sources: [] }), listRecentlyCited: () => Promise.resolve([]), search: () => Promise.resolve([]) },
        repositories: { list: () => Promise.resolve([]) },
    }),
}));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 7 }), useActiveTreeIdIfAny: () => null }));
vi.mock('@/app/components/useErrorToast', () => ({ useErrorToast: () => ({ redirectIfUnauthorized: () => false }) }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/app/hooks/useFocusTrap', () => ({ useFocusTrap: () => ({ current: null }) }));
vi.mock('next-intl', () => ({
    useTranslations: (ns?: string) => (key: string, values?: Record<string, unknown>) => {
        const full = ns ? `${ns}.${key}` : key;
        return values ? `${full}:${Object.values(values).join(',')}` : full;
    },
}));

import AttachSourceSidebar from '@/app/components/AttachSourceSidebar';
import { caseCitationPicks, peopleCitationPicks } from '@/app/cases/view/journalCitationPicks';

const caseCitation = (over: Partial<CaseCitation> = {}): CaseCitation => ({
    Id: 1, CaseId: 3, SourceId: 30, Note: null, Page: 'Folio 3', Quay: '2', DataText: 'Head, 42', Url: 'https://example.test/12',
    sourceTitle: '1901 Census', sourceType: 'Census', sourceUrl: null, sourceRepo: 'National Archives', ...over,
});
const citation = (over: Partial<Citation>): Citation => ({
    Id: 9, OwnerId: 1, FactTable: 'PersonBirth', FactId: 4, SourceId: 40, Page: 'p. 2', Note: null, Quay: null, DataText: null,
    DataDate: null, Even: null, Role: null, Url: null, CreatedAt: '', sourceTitle: 'Parish register', sourceType: 'Church', ...over,
});

describe('journal citation picks', () => {
    it("lists the case's sources with their detail", () => {
        expect(caseCitationPicks([caseCitation()])).toEqual([expect.objectContaining({
            key: 'case:1', sourceId: 30, page: 'Folio 3', quay: '2', dataText: 'Head, 42', url: 'https://example.test/12', context: null,
        })]);
    });

    it("names each person's citation by the person, once per identical copy, never a journal entry's", () => {
        const picks = peopleCitationPicks([{
            id: 4, name: 'Hazel Arbor', citations: {
                'PersonBirth:4': [citation({ Id: 9 })],
                'Events:8': [citation({ Id: 10, FactTable: 'Events', FactId: 8 })],
                'Events:9': [citation({ Id: 11, FactTable: 'Events', FactId: 9, Page: 'p. 5' })],
                'CaseComments:2': [citation({ Id: 12, FactTable: 'CaseComments', FactId: 2, Page: 'p. 7' })],
            },
        }]);
        expect(picks.map(p => [p.key, p.page, p.context])).toEqual([
            ['person:4:9', 'p. 2', 'Hazel Arbor'],
            ['person:4:11', 'p. 5', 'Hazel Arbor'],
        ]);
    });
});

describe('Cite sidebar quick picks (#34)', () => {
    beforeEach(() => { h.onPending.mockClear(); });

    it('prefills from a picked citation and queues a citation of its own', async () => {
        const user = userEvent.setup();
        render(
            <AttachSourceSidebar factTable="CaseComments" factId={null} factLabel="Case" onClose={h.onClose} onPending={h.onPending}
                citationPicks={[{ id: 'case', label: "This case's sources", picks: caseCitationPicks([caseCitation()]) }]} />,
        );
        expect(screen.getByRole('group', { name: "This case's sources" })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /1901 Census/ }));
        expect(screen.getByPlaceholderText('library.ph_page_optional')).toHaveValue('Folio 3');
        expect(screen.getByRole('textbox', { name: 'library.field_record_link' })).toHaveValue('https://example.test/12');

        // Still editable: the copy is the entry's own.
        await user.type(screen.getByPlaceholderText('library.ph_page_optional'), ', line 9');
        await user.click(screen.getByRole('button', { name: 'library.queue_source' }));
        await waitFor(() => expect(h.onPending).toHaveBeenCalledOnce());
        expect(h.onPending.mock.calls[0][0]).toMatchObject({
            sourceId: 30, sourceTitle: '1901 Census', page: 'Folio 3, line 9', quay: '2', dataText: 'Head, 42', url: 'https://example.test/12',
        });
    });

    it('hides the picks while searching', async () => {
        const user = userEvent.setup();
        render(
            <AttachSourceSidebar factTable="CaseComments" factId={null} factLabel="Case" onClose={h.onClose} onPending={h.onPending}
                citationPicks={[{ id: 'case', label: "This case's sources", picks: caseCitationPicks([caseCitation()]) }]} />,
        );
        await user.type(screen.getByPlaceholderText('library.search_sources_short'), 'parish');
        expect(screen.queryByRole('group', { name: "This case's sources" })).toBeNull();
    });
});
