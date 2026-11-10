/** @vitest-environment happy-dom */

import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('@/app/hooks/useTimestamp', () => ({ useTimestamp: () => ({ timestamp: () => '12 Sep 2026' }) }));
vi.mock('@/app/components/PersonPickerSheet', () => ({ PersonPickerSheet: () => null }));
vi.mock('@/app/components/MediaImg', () => ({ default: () => null }));

import MobileCasePage from '@/app/cases/view/MobileCasePage';
import type { CaseDetailState } from '@/app/cases/view/useCaseDetail';

function state(over: Partial<Record<string, unknown>> = {}, caseOver: Record<string, unknown> = {}) {
    return {
        t: (k: string) => k, tCommon: (k: string) => k, activePermission: 'edit', activeTreeId: 1, caseReady: true,
        saveError: null, saving: false, deleting: false, postingComment: false, commentBody: '', pendingCommentCite: null,
        journalFile: null, journalFilePreview: null, tagInput: '', casePeople: [],
        patchCase: vi.fn().mockResolvedValue(true), handleDelete: vi.fn(), handlePeopleChange: vi.fn(), postComment: vi.fn(),
        setShowAttachSource: vi.fn(), setShowComposerCite: vi.fn(), setShowUploadModal: vi.fn(), openLibraryPicker: vi.fn(),
        setLightboxIndex: vi.fn(), setCommentBody: vi.fn(), setPendingCommentCite: vi.fn(), setJournalFile: vi.fn(),
        setJournalFilePreview: vi.fn(), setTagInput: vi.fn(), addTag: vi.fn(), removeTag: vi.fn(),
        canStrikeNote: () => false, setNoteStruck: vi.fn(),
        caseData: {
            Id: 3, Title: 'Where was Kristina born?', Description: 'Family story says Småland.', Status: 'in_progress', Tags: ['Sweden'],
            CreatedAt: '2026-09-12', UpdatedAt: '2026-10-17', people: [], media: [],
            citations: [{ Id: 1, CaseId: 3, SourceId: 50, Note: 'p. 4', sourceTitle: '1880 census', sourceType: 'Census', sourceUrl: null }],
            comments: [
                { Id: 1, CaseId: 3, UserId: 1, Body: 'Census says Sweden.', CreatedAt: '2026-09-12', UserName: 'Ingrid', citationSourceId: 50, citationLabel: '1880 census' },
                { Id: 2, CaseId: 3, UserId: 1, Body: 'Church book entry.', CreatedAt: '2026-10-01', UserName: 'Ingrid', citationSourceId: 60, citationLabel: 'Växjö births' },
            ],
            ...caseOver,
        },
        ...over,
    } as unknown as CaseDetailState;
}

describe('MobileCasePage (#1123)', () => {
    it('puts the question in the band and numbers each entry’s source to match Evidence', () => {
        render(<MobileCasePage cd={state()} />);
        expect(screen.getByRole('heading', { level: 1, name: 'Where was Kristina born?' })).toBeInTheDocument();
        const entries = screen.getAllByRole('listitem');
        // Newest first: the church book (an entry-only source, number 2), then the census (number 1).
        expect(entries[0]).toHaveTextContent('Church book entry.2');
        expect(entries[1]).toHaveTextContent('Census says Sweden.1');
        fireEvent.click(screen.getByRole('tab', { name: /tab_evidence/ }));
        const sources = screen.getByRole('link', { name: /Växjö births/ });
        expect(sources).toHaveAttribute('href', '/library/view?id=60');
        expect(sources).toHaveTextContent('2');
    });

    it('pins the conclusion of a closed case first', () => {
        render(<MobileCasePage cd={state({}, {
            Status: 'closed',
            comments: [
                { Id: 1, CaseId: 3, UserId: 1, Body: 'Census says Sweden.', CreatedAt: '2026-09-12', UserName: 'Ingrid' },
                { Id: 2, CaseId: 3, UserId: 1, Body: 'Born in Växjö.', CreatedAt: '2026-10-16', UserName: 'Ingrid', Kind: 'conclusion' },
            ],
        })} />);
        const first = screen.getAllByRole('listitem')[0];
        expect(within(first).getByText('journal_conclusion', { exact: false })).toBeInTheDocument();
        expect(first).toHaveTextContent('Born in Växjö.');
        // Closed: no Add entry pill.
        expect(screen.queryByRole('button', { name: 'add_entry' })).not.toBeInTheDocument();
    });

    it('gives viewers no pencil, no pill and no Add rows', () => {
        render(<MobileCasePage cd={state({ activePermission: 'view' })} />);
        expect(screen.queryByRole('button', { name: 'mobile_edit_case' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'add_entry' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: /tab_evidence/ }));
        expect(screen.queryByRole('button', { name: 'cite_source' })).not.toBeInTheDocument();
    });

    // #1251: entries are never edited or deleted; one the rule allows is struck out from its sheet.
    it('strikes a journal entry out from its sheet with a reason', async () => {
        const setNoteStruck = vi.fn().mockResolvedValue(true);
        render(<MobileCasePage cd={state({ canStrikeNote: (c: { Id: number }) => c.Id === 2, setNoteStruck })} />);
        expect(screen.queryByRole('button', { name: 'journal_note_edit_label' })).not.toBeInTheDocument();
        const buttons = screen.getAllByRole('button', { name: 'journal_strike_label' });
        expect(buttons).toHaveLength(1);
        fireEvent.click(buttons[0]);
        fireEvent.change(await screen.findByLabelText('journal_strike_reason'), { target: { value: 'Wrong parish' } });
        fireEvent.click(screen.getByRole('button', { name: 'journal_strike' }));
        await vi.waitFor(() => expect(setNoteStruck).toHaveBeenCalledWith(expect.objectContaining({ Id: 2 }), true, 'Wrong parish'));
    });

    it('shows a struck entry crossed out with who struck it, and undoes the strike', async () => {
        const setNoteStruck = vi.fn().mockResolvedValue(true);
        const comments = [
            { Id: 2, CaseId: 3, UserId: 1, Body: 'Church book entry.', CreatedAt: '2026-10-01', UserName: 'Ingrid',
                StruckAt: '2026-10-05', StruckBy: 1, StruckByName: 'Ingrid', StruckReason: 'Wrong parish' },
        ];
        render(<MobileCasePage cd={state({ canStrikeNote: () => true, setNoteStruck }, { comments })} />);
        expect(screen.getByText('Church book entry.').closest('li')).toHaveAttribute('data-struck', 'true');
        expect(screen.getByTestId('struck-line')).toHaveTextContent('journal_struck_by · Wrong parish');
        fireEvent.click(screen.getByRole('button', { name: 'journal_unstrike_label' }));
        fireEvent.click(await screen.findByRole('button', { name: 'journal_unstrike' }));
        await vi.waitFor(() => expect(setNoteStruck).toHaveBeenCalledWith(expect.objectContaining({ Id: 2 }), false));
    });
});
