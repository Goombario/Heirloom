/** @vitest-environment happy-dom */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import type { CaseComment, CaseFinding, CaseLead, CaseWorkspace } from '@/lib/db/schema';
import type { CaseDetailState } from '@/app/cases/view/useCaseDetail';

const h = vi.hoisted(() => ({
    workspace: null as unknown as CaseWorkspace,
    decideClaim: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('@/app/hooks/useTimestamp', () => ({ useTimestamp: () => ({ timestamp: () => '12 Nov' }) }));
vi.mock('@/app/components/MediaImg', () => ({ default: () => null }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => null }));
vi.mock('@/lib/data', () => ({
    DATA_MODE: 'http',
    getDataClient: async () => ({
        cases: {
            getWorkspace: async () => h.workspace,
            decideClaim: async (...args: unknown[]) => { h.decideClaim(...args); return { id: null, workspace: h.workspace }; },
        },
    }),
}));

import { PhoneWorkspace } from '@/app/cases/view/phone/PhoneWorkspace';

const person = { Id: 7, FirstName: 'Hilda', LastName: 'Ek', Sex: 'F', PrimaryMediaId: null };
const lead = (Id: number, Question: string, over: Partial<CaseLead> = {}): CaseLead => ({
    Id, CaseId: 3, Question, FromYear: null, ToYear: null, Position: Id, CreatedAt: '2026-11-01', SettledAt: null, DroppedAt: null, people: [person], ...over,
} as unknown as CaseLead);
const claim = (Id: number, FindingId: number, Says: string, Decision = 'undecided') => ({
    Id, FindingId, Position: Id, What: 'PARENTS', PersonId: 7, PersonName: null, personLabel: 'Hilda Ek', Says, Date: null, Place: null,
    Evidence: 'direct', Decision, DecidedAt: null, AppliedAt: null,
});
const finding = (Id: number, title: string, claims: unknown[]): CaseFinding => ({
    Id, CaseId: 3, Kind: 'record', UserId: 1, CreatedAt: '2026-11-10', MediaId: null, SourceNature: 'original', Information: 'primary',
    Searched: null, Site: null, Note: null, RequestId: null,
    citation: { Id, SourceId: 100 + Id, sourceTitle: title, sourceRepo: null, Page: null, Url: null, DataText: null },
    leadIds: [11], claims,
} as unknown as CaseFinding);
const note = (Id: number, over: Partial<CaseComment> = {}): CaseComment => ({
    Id, CaseId: 3, UserId: 1, UserName: 'Sam', Body: `note ${Id}`, CreatedAt: '2026-11-12T10:00:00Z', Kind: null, leadIds: [11], ...over,
} as CaseComment);

function state(over: Record<string, unknown> = {}, caseOver: Record<string, unknown> = {}) {
    return {
        activePermission: 'edit', activeTreeId: 1, canEdit: true, canDelete: true, saving: false, saveError: null, deleting: false,
        commentBody: '', setCommentBody: vi.fn(), postComment: vi.fn(async () => true), postingComment: false,
        journalFile: null, setJournalFile: vi.fn(), journalFilePreview: null, setJournalFilePreview: vi.fn(),
        pendingCommentCite: null, setPendingCommentCite: vi.fn(), setShowComposerCite: vi.fn(), openCommentCitation: vi.fn(),
        canStrikeNote: (c: CaseComment) => c.Kind == null, setNoteStruck: vi.fn(async () => true),
        fetchCase: vi.fn(), patchCase: vi.fn(async () => true), handleDelete: vi.fn(), setSaveError: vi.fn(),
        caseData: {
            Id: 3, Title: "Who were Hilda Ek's birth parents?", Status: 'in_progress', Outcome: null, CreatedAt: '2026-01-05', UpdatedAt: '2026-11-12',
            ClosedAt: null, FromYear: 1890, ToYear: 1910, Place: 'Mora', people: [person], media: [], citations: [], Tags: [],
            comments: [note(1), note(2, { Kind: 'finding', Body: 'Moving-out list' })],
            ...caseOver,
        },
        ...over,
    } as unknown as CaseDetailState;
}

function renderPage(cd = state()) {
    render(<NextIntlClientProvider locale="en" messages={en} timeZone="UTC"><PhoneWorkspace cd={cd} /></NextIntlClientProvider>);
    return cd;
}

describe('Phone research case (#135)', () => {
    beforeEach(() => {
        window.history.replaceState(null, '', '/cases/view?id=3');
        h.decideClaim.mockReset();
        h.workspace = {
            leads: [lead(11, "Who were Hilda's birth parents?"), lead(12, 'Where was Hilda baptised?')],
            findings: [
                finding(21, 'Letter from the Lindqvists', [claim(31, 21, 'Elin Ek')]),
                finding(22, 'Moving-out list', [claim(32, 22, 'Elin Ström', 'rejected')]),
            ],
            requests: [],
            facts: [],
        } as unknown as CaseWorkspace;
    });

    it('opens on the first lead: the switcher, Lead and Journal tabs, and Find a record', async () => {
        renderPage();
        const switcher = await screen.findByRole('button', { name: /Lead 1 of 2/ });
        expect(switcher).toHaveTextContent("Who were Hilda's birth parents?");
        expect(screen.getByRole('tab', { name: 'Lead' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: /Journal/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Find a record' })).toBeInTheDocument();
        // The top-left is the menu; the case ⋯ is top-right.
        expect(screen.getAllByRole('button', { name: 'Case menu' }).length).toBeGreaterThan(0);
    });

    it('decides a claim in place, the chosen state filled', async () => {
        renderPage();
        const [group] = await screen.findAllByRole('group', { name: /Parents/ });
        const rejected = screen.getAllByRole('button', { name: 'Rejected' });
        expect(rejected[0]).toHaveAttribute('aria-pressed', 'true');
        await act(async () => { fireEvent.click(within(group).getByRole('button', { name: 'Accept' })); });
        await waitFor(() => expect(h.decideClaim).toHaveBeenCalledWith(3, 31, 'accepted', 1));
    });

    it('shows Two findings disagree with Which holds?', async () => {
        renderPage();
        expect(await screen.findByText('Two findings disagree')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Which holds\?/ })).toBeInTheDocument();
    });

    it("gives only notes a ⋯ in the journal, and Add a note as the pill", async () => {
        renderPage();
        fireEvent.click(await screen.findByRole('tab', { name: /Journal/ }));
        expect(screen.getByRole('button', { name: 'Add a note' })).toBeInTheDocument();
        const entries = screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-entry-kind'));
        const noteEntry = entries.find((li) => li.getAttribute('data-entry-kind') === 'note')!;
        const findingEntry = entries.find((li) => li.getAttribute('data-entry-kind') === 'finding')!;
        expect(within(noteEntry).getByRole('button', { name: /strike out/ })).toBeInTheDocument();
        expect(within(findingEntry).queryByRole('button')).not.toBeInTheDocument();
    });

    it('has no pill for a viewer', async () => {
        renderPage(state({ activePermission: 'view', canEdit: false }));
        await screen.findByRole('button', { name: /Lead 1 of 2/ });
        expect(screen.queryByRole('button', { name: 'Find a record' })).not.toBeInTheDocument();
    });

    it('opens a closed case on the answer, with no pill', async () => {
        renderPage(state({}, { Status: 'closed', Outcome: 'answered', ClosedAt: '2026-11-13',
            comments: [note(9, { Kind: 'conclusion', Body: 'Hilda was the daughter of Elin Ström.' })] }));
        expect(await screen.findByRole('tab', { name: 'Answer' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('Hilda was the daughter of Elin Ström.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Find a record' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Add a note' })).not.toBeInTheDocument();
    });
});
