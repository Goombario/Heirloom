/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/app/hooks/useTimestamp', () => ({
  useTimestamp: () => ({ timestamp: (v: string) => String(v), activityTime: (v: string) => String(v) }),
}));
import { fireEvent, render } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

import CaseJournal from '@/app/cases/view/CaseJournal';
import type { CaseDetailState } from '@/app/cases/view/useCaseDetail';

function mockCd(): CaseDetailState {
    const caseData = {
        Id: 5, UserId: 0, Title: 'Q', Description: null, Status: 'in_progress',
        Tags: [], CreatedAt: '2026-07-03', UpdatedAt: '2026-07-03',
        people: [], media: [], citations: [], comments: [],
    };
    return {
        caseData, caseReady: true, canEdit: true, isDraft: false, activeOwnerId: 1,
        commentBody: '', setCommentBody: vi.fn(), postComment: vi.fn(), postingComment: false,
        journalFile: null, setJournalFile: vi.fn(), journalFilePreview: null, setJournalFilePreview: vi.fn(),
        pendingCommentCite: null, setPendingCommentCite: vi.fn(), setShowComposerCite: vi.fn(),
        setMobileTab: vi.fn(), t: (k: string) => k, tCommon: (k: string) => k,
        canStrikeNote: () => false,
    } as unknown as CaseDetailState;
}

describe('CaseJournal bare variant', () => {
    it('omits the research_journal heading when bare', () => {
        const { queryByText } = render(<CaseJournal cd={mockCd()} bare />);
        expect(queryByText('research_journal')).toBeNull();
    });

    it('renders the heading when not bare', () => {
        const { getByText } = render(<CaseJournal cd={mockCd()} />);
        const heading = getByText('research_journal');
        expect(heading).toBeInTheDocument();
        expect(heading.tagName).toBe('H2');
        expect(heading.className).toContain('section');
    });

    it('places guided-start before the composer in the bare empty state', () => {
        const { container } = render(<CaseJournal cd={mockCd()} bare />);
        const guided = container.querySelector('.border-dashed');       // CaseGuidedStart wrapper
        const composer = container.querySelector('#case-composer');
        expect(guided).toBeTruthy();
        expect(composer).toBeTruthy();
        // guided appears earlier in document order than the composer
        expect(guided!.compareDocumentPosition(composer!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("opens a journal entry's citation in the preview from its chip (#918)", () => {
        const cd = mockCd();
        const comment = { Id: 12, CaseId: 5, UserId: 0, Body: 'Found the baptism', CreatedAt: '2026-07-04', Kind: null, citationId: 41, citationSourceId: 9, citationLabel: 'Parish register' };
        (cd.caseData as { comments: unknown[] }).comments = [comment];
        const openCommentCitation = vi.fn();
        const { getByRole } = render(<CaseJournal cd={{ ...cd, openCommentCitation } as unknown as CaseDetailState} />);
        const chip = getByRole('button', { name: 'Parish register' });
        fireEvent.click(chip);
        expect(openCommentCitation).toHaveBeenCalledWith(expect.objectContaining({ Id: 12 }), chip);
    });
});
