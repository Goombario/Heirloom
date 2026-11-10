/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('next/link', () => ({
    default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
        <a href={href} {...props}>{children}</a>
    ),
}));
vi.mock('@/app/components/PersonPicker', () => ({
    default: ({ disabled, placeholder }: { disabled?: boolean; placeholder?: string }) => (
        <input aria-label="person picker" disabled={disabled} placeholder={placeholder} />
    ),
}));
vi.mock('@/app/components/MediaImg', () => ({
    default: ({ alt }: { alt: string }) => <span data-media-alt={alt} />,
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import CaseEvidenceRail from '@/app/cases/view/CaseEvidenceRail';
import type { CaseDetailState } from '@/app/cases/view/useCaseDetail';

function mockCd(overrides: Partial<CaseDetailState> = {}): CaseDetailState {
    const caseData = {
        Id: 5, UserId: 1, Title: 'Research case', Description: null, Status: 'in_progress',
        Tags: ['archive'], CreatedAt: '2026-07-03', UpdatedAt: '2026-07-03',
        people: [],
        media: [{ Id: 8, Title: 'Portrait' }],
        citations: [{ Id: 9, SourceId: 4, Note: 'A note', Page: 'Folio 12', Quay: '3', DataText: 'Baptised', sourceType: 'Census', sourceTitle: 'A source' }],
        comments: [],
    };
    return {
        caseData, casePeople: [], caseReady: true, canEdit: true, canDelete: true, isDraft: false,
        openCaseCitation: vi.fn(), setConfirmRemoveCitation: vi.fn(),
        activeTreeId: null, tagInput: '',
        setShowAttachSource: vi.fn(), setShowUploadModal: vi.fn(), setTagInput: vi.fn(),
        setLightboxIndex: vi.fn(), addTag: vi.fn(), removeTag: vi.fn(),
        removeMediaFromCase: vi.fn(), removeCitation: vi.fn(), handlePeopleChange: vi.fn(),
        t: (key: string) => key, tCommon: (key: string) => key,
        ...overrides,
    } as unknown as CaseDetailState;
}

describe('CaseEvidenceRail', () => {
    it('keeps the aside landmark and uses rail cards with their headings inside', () => {
        const { container } = render(<CaseEvidenceRail cd={mockCd()} />);

        expect(screen.getByRole('complementary')).toBeInTheDocument();
        // One DetailRail recipe (#764): no grey well, each section a card.
        expect(container.querySelector('.person-rail')).not.toHaveClass('bg-surface-2');
        const cards = container.querySelectorAll('.person-rail > section.card');
        expect(cards).toHaveLength(4);
        cards.forEach((card) => expect(card.querySelector('h3')).not.toBeNull());
        expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(4);
        expect(screen.getAllByText('(1)')).toHaveLength(2);
    });

    it('preserves section actions and dispatches their handlers', () => {
        const cd = mockCd();
        render(<CaseEvidenceRail cd={cd} />);

        fireEvent.click(screen.getByRole('button', { name: 'cite_source' }));
        expect(cd.setShowAttachSource).toHaveBeenCalledWith(true);
        fireEvent.click(screen.getByRole('button', { name: 'add_media' }));
        expect(cd.setShowUploadModal).toHaveBeenCalledWith(true);
    });

    it('keeps empty-state copy and edit gating for an empty, read-only rail', () => {
        const cd = mockCd({
            canEdit: false,
            caseReady: false,
            caseData: {
                Id: 5, UserId: 1, Title: 'Research case', Description: null, Status: 'closed',
                Tags: [], CreatedAt: '2026-07-03', UpdatedAt: '2026-07-03',
                people: [], media: [], citations: [], comments: [],
            },
        } as Partial<CaseDetailState>);
        render(<CaseEvidenceRail cd={cd} />);

        expect(screen.getByText('no_people')).toBeInTheDocument();
        expect(screen.getByText('no_citations')).toBeInTheDocument();
        expect(screen.getByText('no_media')).toBeInTheDocument();
        expect(screen.getByText('no_tags')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'cite_source' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'add_media' })).toBeNull();
    });

    it('shows a source row with its translated type, page and certainty, and opens its preview (#918)', () => {
        const cd = mockCd();
        render(<CaseEvidenceRail cd={cd} />);
        const row = screen.getByRole('button', { name: /A source/ });
        expect(row).toHaveTextContent('type_Census');
        expect(row).toHaveTextContent('Folio 12 · certainty_short_3');
        fireEvent.click(row);
        expect(cd.openCaseCitation).toHaveBeenCalledWith(expect.objectContaining({ Id: 9 }), row);
        // Opening the source is the preview's job now, not the row's.
        expect(screen.queryByRole('link', { name: /A source/ })).toBeNull();
    });

    it('asks before removing a source, from a control that is always shown', () => {
        const cd = mockCd();
        render(<CaseEvidenceRail cd={cd} />);
        const remove = screen.getByRole('button', { name: 'remove_named' });
        expect(remove.className).not.toContain('opacity-0');
        fireEvent.click(remove);
        expect(cd.setConfirmRemoveCitation).toHaveBeenCalledWith(expect.objectContaining({ Id: 9 }));
        expect(cd.removeCitation).not.toHaveBeenCalled();
    });
});
