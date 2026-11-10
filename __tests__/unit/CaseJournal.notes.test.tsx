/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/app/hooks/useTimestamp', () => ({
    useTimestamp: () => ({ timestamp: (v: string) => String(v), activityTime: (v: string) => String(v) }),
}));
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import type { CaseComment } from '@/lib/db/schema';

import CaseJournal from '@/app/cases/view/CaseJournal';
import type { CaseDetailState } from '@/app/cases/view/useCaseDetail';

const note = (Id: number, UserId: number, Body: string, Kind: CaseComment['Kind'] = null, extra: Partial<CaseComment> = {}): CaseComment =>
    ({ Id, CaseId: 7, UserId, Body, Kind, CreatedAt: `2026-10-0${Id}`, UserName: `User ${UserId}`, ...extra });

function mockCd(overrides: Partial<CaseDetailState> = {}): CaseDetailState {
    const comments = [note(1, 1, 'Owner entry'), note(2, 3, 'on_hold', 'status'), note(3, 3, 'Contributor entry')];
    return {
        caseData: { Id: 7, UserId: 1, Title: 'Case', Status: 'in_progress', Tags: [], people: [], media: [], citations: [], comments },
        caseReady: true, canEdit: true, isDraft: false, activeTreeId: 1,
        commentBody: '', setCommentBody: vi.fn(), postComment: vi.fn(), postingComment: false,
        journalFile: null, setJournalFile: vi.fn(), journalFilePreview: null, setJournalFilePreview: vi.fn(),
        pendingCommentCite: null, setPendingCommentCite: vi.fn(), setShowComposerCite: vi.fn(),
        t: (k: string, v?: Record<string, string>) => (v?.date ? `${k} ${v.date}` : k), tCommon: (k: string) => k,
        canStrikeNote: (c: CaseComment) => c.Kind == null,
        setNoteStruck: vi.fn().mockResolvedValue(true),
        ...overrides,
    } as unknown as CaseDetailState;
}

const show = (cd: CaseDetailState) => render(
    <NextIntlClientProvider locale="en" messages={en}>
        <CaseJournal cd={cd} />
    </NextIntlClientProvider>,
);

// #1251: entries are never edited or deleted; written ones are struck out where the rule allows.
describe('CaseJournal strike out', () => {
    it('offers Strike out on written entries only, and never Edit or Delete', () => {
        show(mockCd());
        expect(screen.getAllByRole('button', { name: /^journal_strike_label/ })).toHaveLength(2);
        expect(screen.queryByRole('button', { name: /edit|delete/i })).not.toBeInTheDocument();
    });

    it('offers it only on the entries a contributor wrote', () => {
        show(mockCd({ canStrikeNote: (c: CaseComment) => c.Kind == null && c.UserId === 3 } as Partial<CaseDetailState>));
        expect(screen.getAllByRole('button', { name: /^journal_strike_label/ })).toHaveLength(1);
    });

    it('strikes an entry out with an optional reason', async () => {
        const cd = mockCd();
        show(cd);
        fireEvent.click(screen.getByRole('button', { name: 'journal_strike_label 2026-10-01' }));
        expect(cd.setNoteStruck).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('journal_strike_reason'), { target: { value: 'A different Ada' } });
        fireEvent.click(screen.getByRole('button', { name: 'journal_strike' }));
        await waitFor(() => expect(cd.setNoteStruck).toHaveBeenCalledWith(expect.objectContaining({ Id: 1 }), true, 'A different Ada'));
        await waitFor(() => expect(screen.queryByLabelText('journal_strike_reason')).not.toBeInTheDocument());
    });

    it('shows a struck entry in place, crossed out, and undoes the strike', async () => {
        const struck = note(1, 1, 'Owner entry', null, { StruckAt: '2026-10-04', StruckBy: 2, StruckByName: 'Editor', StruckReason: 'A different Ada' });
        const cd = mockCd({ caseData: { Id: 7, UserId: 1, Title: 'Case', Status: 'in_progress', Tags: [], people: [], media: [], citations: [], comments: [struck] } } as unknown as Partial<CaseDetailState>);
        show(cd);
        expect(screen.getByText('Owner entry').closest('[data-struck]')).toHaveAttribute('data-struck', 'true');
        expect(screen.getByTestId('struck-line')).toHaveTextContent('journal_struck_by 2026-10-04 · A different Ada');
        fireEvent.click(screen.getByRole('button', { name: 'journal_unstrike_label 2026-10-01' }));
        await waitFor(() => expect(cd.setNoteStruck).toHaveBeenCalledWith(expect.objectContaining({ Id: 1 }), false));
    });
});
