/** @vitest-environment happy-dom */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import type { CaseComment, CaseLead } from '@/lib/db/schema';
import type { CaseDetailState } from '@/app/cases/view/useCaseDetail';

vi.mock('@/app/hooks/useTimestamp', () => ({ useTimestamp: () => ({ timestamp: (v: string) => v }) }));
vi.mock('@/app/components/MediaImg', () => ({ default: () => <img alt="" /> }));

import { WorkspaceJournal } from '@/app/cases/view/desktop/WorkspaceJournal';

const lead = (Id: number, Question: string) => ({ Id, Question, people: [] }) as unknown as CaseLead;
const leads = [lead(11, 'Find her baptism'), lead(12, 'Find the census')];
const entry = (Id: number, over: Partial<CaseComment>): CaseComment => ({
    Id, CaseId: 1, UserId: 1, UserName: 'Sam', Body: `entry ${Id}`, CreatedAt: `2026-11-1${Id % 10}T10:00:00Z`, Kind: null, leadIds: [], ...over,
});
const comments = [
    entry(1, { Body: 'Parish books start in 1880', leadIds: [11] }),
    entry(2, { Body: 'Census index is patchy', leadIds: [12] }),
    entry(3, { Kind: 'status', Body: 'on_hold' }),
    entry(4, { Kind: 'finding', Body: 'St Mary register', leadIds: [11] }),
    entry(5, { Body: 'A whole-case note' }),
];

function journal(over: Partial<CaseDetailState> = {}) {
    const cd = {
        caseData: { Id: 1, Status: 'in_progress', comments },
        canEdit: true, activeTreeId: 1,
        commentBody: 'Checked St Florian too', setCommentBody: vi.fn(),
        postComment: vi.fn(async () => true), postingComment: false,
        journalFile: null, setJournalFile: vi.fn(), pendingCommentCite: null, setPendingCommentCite: vi.fn(),
        setShowComposerCite: vi.fn(), openCommentCitation: vi.fn(),
        canStrikeNote: (c: CaseComment) => c.Kind == null, setNoteStruck: vi.fn(async () => true),
        ...over,
    } as unknown as CaseDetailState;
    render(<NextIntlClientProvider locale="en" messages={en} timeZone="UTC"><WorkspaceJournal cd={cd} leads={leads} openLeadId={11} /></NextIntlClientProvider>);
    return cd;
}
const list = () => screen.getByRole('list');

describe('WorkspaceJournal (#58)', () => {
    it('shows This lead by default: its entries and the case status changes', () => {
        journal();
        expect(list()).toHaveTextContent('Parish books start in 1880');
        expect(list()).toHaveTextContent('Record found: St Mary register');
        expect(list()).toHaveTextContent('Put on hold');
        expect(list()).not.toHaveTextContent('Census index is patchy');
        expect(list()).not.toHaveTextContent('A whole-case note');
    });

    it('filters by entry type', () => {
        journal();
        fireEvent.click(screen.getByRole('button', { name: 'Findings' }));
        expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
        expect(list()).toHaveTextContent('St Mary register');
        fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
        expect(list()).toHaveTextContent('Parish books start in 1880');
        expect(list()).not.toHaveTextContent('St Mary register');
    });

    it('files a note under the open lead by default', async () => {
        const cd = journal();
        expect(screen.getByRole('button', { name: /Filed under/ })).toHaveTextContent('Find her baptism');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add note' })); });
        expect(cd.postComment).toHaveBeenCalledWith([11]);
        expect(screen.queryByText(/Added under/)).not.toBeInTheDocument();
    });

    it('files under the whole case, says where it went, and Show reveals it', async () => {
        const cd = journal();
        fireEvent.click(screen.getByRole('button', { name: /Filed under/ }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'The whole case' }));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add note' })); });
        expect(cd.postComment).toHaveBeenCalledWith([]);
        expect(screen.getByRole('status')).toHaveTextContent('Added under The whole case');
        fireEvent.click(screen.getByRole('button', { name: 'Show' }));
        expect(list()).toHaveTextContent('A whole-case note');
        expect(list()).toHaveTextContent('Census index is patchy');
    });

    it('strikes a note out from its menu, asking why', async () => {
        const cd = journal();
        fireEvent.click(screen.getByRole('button', { name: /More actions for The note from 2026-11-11/ }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Strike out' }));
        fireEvent.change(screen.getByLabelText('Why is it no longer accurate?'), { target: { value: 'Wrong parish' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Strike out' })); });
        expect(cd.setNoteStruck).toHaveBeenCalledWith(comments[0], true, 'Wrong parish');
    });

    it('has no menu on logged entries, and no composer for a viewer', () => {
        journal({ canEdit: false, canStrikeNote: () => false } as Partial<CaseDetailState>);
        expect(screen.queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Add a note' })).not.toBeInTheDocument();
    });
});
