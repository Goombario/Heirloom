/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/app/hooks/useTimestamp', () => ({
  useTimestamp: () => ({ timestamp: (v: string) => String(v), activityTime: (v: string) => String(v) }),
}));
import { fireEvent, render, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

import CaseHeaderCard from '@/app/cases/view/CaseHeaderCard';
import type { CaseDetailState } from '@/app/cases/view/useCaseDetail';

function draftCd(): CaseDetailState {
    const caseData = {
        Id: 0, UserId: 0, Title: '', Description: null, Status: 'in_progress',
        Tags: [], CreatedAt: '2026-07-03', UpdatedAt: '2026-07-03',
        people: [], media: [], citations: [], comments: [],
    };
    return {
        caseData, isDraft: true, composing: true, finishComposing: vi.fn(), canDelete: false, activePermission: 'owner',
        saving: false, saveState: 'idle', titleValue: '', setTitleValue: vi.fn(),
        descValue: '', setDescValue: vi.fn(), patchCase: vi.fn(), setShowDeleteConfirm: vi.fn(),
        t: Object.assign((k: string) => k, { rich: (k: string) => k }), tCommon: (k: string) => k,
    } as unknown as CaseDetailState;
}

function savedCd(): CaseDetailState {
    const caseData = {
        Id: 5, UserId: 0, Title: 'A research question', Description: 'Description', Status: 'in_progress',
        Tags: [], CreatedAt: '2026-07-03', UpdatedAt: '2026-07-03',
        people: [], media: [], citations: [], comments: [],
    };
    return {
        caseData, isDraft: false, composing: false, finishComposing: vi.fn(), canDelete: true, activePermission: 'owner',
        saving: false, saveState: 'idle', titleValue: '', setTitleValue: vi.fn(),
        descValue: '', setDescValue: vi.fn(), patchCase: vi.fn(), setShowDeleteConfirm: vi.fn(),
        t: Object.assign((k: string) => k, { rich: (k: string) => k }), tCommon: (k: string) => k,
    } as unknown as CaseDetailState;
}

describe('CaseHeaderCard draft variant', () => {
    it('renders an editable title input with id case-title-input', () => {
        const { container } = render(<CaseHeaderCard cd={draftCd()} />);
        const input = container.querySelector('#case-title-input');
        expect(input).toBeInTheDocument();
        expect(input?.tagName).toBe('INPUT');
    });

    it('labels the question and background fields, and claims no save before one happens (#801, CS-4)', () => {
        const { getByLabelText, queryByText } = render(<CaseHeaderCard cd={draftCd()} />);
        expect(getByLabelText('field_title_label')).toHaveAttribute('id', 'case-title-input');
        expect(getByLabelText('field_description_label').tagName).toBe('TEXTAREA');
        expect(queryByText('saves_automatically')).not.toBeInTheDocument();
        expect(queryByText('saved')).not.toBeInTheDocument();
    });

    it('uses the light detail hero surface for draft mode', () => {
        const { container } = render(<CaseHeaderCard cd={draftCd()} />);
        const surface = container.firstElementChild as HTMLElement;
        expect(surface).toHaveClass('bg-card', 'p-5', 'mb-[16px]');
        expect(surface).not.toHaveClass('hero-dark');
    });
});

describe('CaseHeaderCard composing a new case (#912)', () => {
    it('keeps composing when focus moves from title to description, and finishes when it leaves', () => {
        const cd = draftCd();
        const { container, getByLabelText } = render(<><CaseHeaderCard cd={cd} /><button type="button">elsewhere</button></>);
        const title = getByLabelText('field_title_label');
        const desc = getByLabelText('field_description_label');
        fireEvent.blur(title, { relatedTarget: desc });
        expect(cd.finishComposing).not.toHaveBeenCalled();
        fireEvent.blur(desc, { relatedTarget: container.querySelector('button') });
        expect(cd.finishComposing).toHaveBeenCalledTimes(1);
    });
});

describe('CaseHeaderCard saved modes', () => {
    it('uses the light detail hero surface in view mode', () => {
        const { container, getByRole } = render(<CaseHeaderCard cd={savedCd()} />);
        const surface = container.firstElementChild as HTMLElement;
        expect(surface).toHaveClass('bg-card', 'p-5', 'mb-[16px]');
        expect(surface).not.toHaveClass('hero-dark');
        expect(getByRole('heading', { level: 1 })).toHaveTextContent('A research question');
    });

    it('keeps the light detail hero surface when entering edit mode', () => {
        const { container, getByRole } = render(<CaseHeaderCard cd={savedCd()} />);
        fireEvent.click(getByRole('button', { name: 'edit' }));
        const surface = container.firstElementChild as HTMLElement;
        expect(surface).toHaveClass('bg-card', 'p-5', 'mb-[16px]');
        expect(surface).not.toHaveClass('hero-dark');
        expect(getByRole('button', { name: 'save_changes' })).toBeInTheDocument();
    });
});

describe('CaseHeaderCard closing a case (#801, CS-2)', () => {
    it('asks for a conclusion when Closed is chosen, and Cancel leaves the status alone', () => {
        const cd = savedCd();
        const { getByRole, getByLabelText, queryByLabelText } = render(<CaseHeaderCard cd={cd} />);
        fireEvent.click(getByRole('button', { name: 'edit' }));
        fireEvent.click(getByRole('button', { name: 'status_closed' }));
        expect(getByLabelText('close_case_question')).toBeInTheDocument();
        expect(getByRole('button', { name: 'close_case_confirm' })).toBeDisabled();

        const dialog = getByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'cancel' }));
        expect(queryByLabelText('close_case_question')).not.toBeInTheDocument();
        expect(getByRole('button', { name: 'status_in_progress' })).toHaveAttribute('aria-pressed', 'true');
        expect(getByRole('button', { name: 'status_closed' })).toHaveAttribute('aria-pressed', 'false');
        expect(cd.patchCase).not.toHaveBeenCalled();
    });

    it('closes the case with the conclusion', () => {
        const cd = savedCd();
        const { getByRole, getByLabelText } = render(<CaseHeaderCard cd={cd} />);
        fireEvent.click(getByRole('button', { name: 'edit' }));
        fireEvent.click(getByRole('button', { name: 'status_closed' }));
        fireEvent.change(getByLabelText('close_case_question'), { target: { value: ' Johann and Maria Weber. ' } });
        fireEvent.click(getByRole('button', { name: 'close_case_confirm' }));
        expect(cd.patchCase).toHaveBeenCalledWith({
            Title: 'A research question',
            Description: 'Description',
            Status: 'closed',
            Conclusion: 'Johann and Maria Weber.',
        });
    });
});
