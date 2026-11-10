/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/app/hooks/useTimestamp', () => ({
  useTimestamp: () => ({ timestamp: (v: string) => String(v), activityTime: (v: string) => String(v) }),
}));
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

import CaseJournal from '@/app/cases/view/CaseJournal';
import type { CaseDetailState } from '@/app/cases/view/useCaseDetail';

function mockCd(overrides: Partial<CaseDetailState> = {}): CaseDetailState {
    const caseData = {
        Id: 0, UserId: 0, Title: '', Description: null, Status: 'in_progress',
        Tags: [], CreatedAt: '2026-07-03', UpdatedAt: '2026-07-03',
        people: [], media: [], citations: [], comments: [],
    };
    return {
        caseData, caseReady: false, canEdit: true, isDraft: true, activeOwnerId: 1,
        commentBody: '', setCommentBody: vi.fn(), postComment: vi.fn(), postingComment: false,
        journalFile: null, setJournalFile: vi.fn(), journalFilePreview: null, setJournalFilePreview: vi.fn(),
        pendingCommentCite: null, setPendingCommentCite: vi.fn(), setShowComposerCite: vi.fn(),
        setMobileTab: vi.fn(), t: (k: string) => k, tCommon: (k: string) => k,
        ...overrides,
    } as unknown as CaseDetailState;
}

describe('CaseJournal composer gating', () => {
    it('disables the Add entry button while the case has no id (caseReady false)', () => {
        const { getByText } = render(<CaseJournal cd={mockCd()} />);
        const addBtn = getByText('add_entry').closest('button')!;
        expect(addBtn).toBeDisabled();
    });

    it('keeps the Add entry button disabled when a body is present but the case is not ready', () => {
        // Differentiating case: commentBody is non-empty, so the button is only
        // disabled if `!caseReady` is wired into the disabled condition. Fails if
        // that clause is dropped from CaseJournal.tsx.
        const cd = mockCd({ caseReady: false, commentBody: 'a finding' } as Partial<CaseDetailState>);
        const { getByText } = render(<CaseJournal cd={cd} />);
        const addBtn = getByText('add_entry').closest('button')!;
        expect(addBtn).toBeDisabled();
    });

    it('enables the composer once caseReady and a body is present', () => {
        const cd = mockCd({ caseReady: true, commentBody: 'a finding' } as Partial<CaseDetailState>);
        const { getByText } = render(<CaseJournal cd={cd} />);
        const addBtn = getByText('add_entry').closest('button')!;
        expect(addBtn).not.toBeDisabled();
    });
});
