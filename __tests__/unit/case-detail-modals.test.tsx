/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock('@/app/cases/view/useCaseDetail', () => ({ useCaseDetail: () => h.state }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/cases/view/CaseHeaderCard', () => ({ default: () => null }));
vi.mock('@/app/cases/view/CaseJournal', () => ({ default: () => null }));
vi.mock('@/app/cases/view/CaseEvidenceRail', () => ({ default: () => null }));
vi.mock('@/app/cases/view/MobileCasePage', () => ({ default: () => null }));
vi.mock('@/app/cases/view/desktop/ResearchWorkspace', () => ({ ResearchWorkspace: () => null }));
vi.mock('@/app/components/media/AddMediaModal', () => ({
    default: ({ target }: { target: { kind: string; caseId: number; source: { key: string } } }) => (
        <div data-testid="add-media" data-case={target.caseId} data-source={target.source.key} />
    ),
}));
vi.mock('@/app/components/AttachSourceSidebar', () => ({
    default: ({ factTable, initialView, initialCitationId }: { factTable: string; initialView?: string; initialCitationId?: number }) => (
        <div data-testid={`attach-${factTable}`} data-initial-view={initialView ?? ''} data-citation={initialCitationId ?? ''} />
    ),
}));
vi.mock('@/app/components/citations/CitationPreview', () => ({
    default: ({ onEdit, target }: { onEdit: (c: { Id: number }) => void; target: { citation: { Id: number } } }) => (
        <button type="button" onClick={() => onEdit(target.citation)}>edit_citation</button>
    ),
}));

import CaseDetailClient from '@/app/cases/view/CaseDetailView';

function caseState(overrides: Record<string, unknown> = {}) {
    const t = (k: string) => k;
    return {
        id: '3', activeTreeId: 1, t, tCommon: t,
        caseData: { Id: 3, Title: 'Who were her parents?', citations: [], media: [], Status: 'Open' },
        loading: false, fetchError: null, notFound: false, saveError: null,
        setSaveError: vi.fn(), setFetchError: vi.fn(), setLoading: vi.fn(),
        showUploadModal: false, setShowUploadModal: vi.fn(),
        libraryPickerSource: { key: 'case:3' },
        lightboxIndex: null, setLightboxIndex: vi.fn(),
        showDeleteConfirm: false, setShowDeleteConfirm: vi.fn(), deleting: false, deleteError: null, setDeleteError: vi.fn(),
        showAttachSource: false, setShowAttachSource: vi.fn(), canEdit: true, canDelete: true,
        showComposerCite: false, setShowComposerCite: vi.fn(), setPendingCommentCite: vi.fn(),
        fetchCase: vi.fn(), removeMediaFromCase: vi.fn(), handleDelete: vi.fn(),
        citationPreview: null, setCitationPreview: vi.fn(), editCitation: null, setEditCitation: vi.fn(),
        confirmRemoveCitation: null, setConfirmRemoveCitation: vi.fn(), removeCitation: vi.fn(),
        ...overrides,
    };
}

describe('case detail modals', () => {
    it('opens the case Cite source sidebar on Add source (#914)', () => {
        h.state = caseState({ showAttachSource: true });
        render(<CaseDetailClient />);
        expect(screen.getByTestId('attach-Cases').dataset.initialView).toBe('add');
    });

    it('adds media through the shared modal, fed the case\'s own library (#926, #1204)', () => {
        h.state = caseState({ showUploadModal: true });
        render(<CaseDetailClient />);
        expect(screen.getByTestId('add-media').dataset.source).toBe('case:3');
        expect(screen.getByTestId('add-media').dataset.case).toBe('3');
    });

    it("a case source's preview Edit citation opens the sidebar on that citation (#918)", () => {
        const setEditCitation = vi.fn();
        const citation = { Id: 41, SourceId: 9 };
        h.state = caseState({
            setEditCitation,
            citationPreview: { anchor: document.body, citation, fact: { factTable: 'Cases', factId: 3, label: 'section_sources', value: '', citations: [citation] } },
        });
        render(<CaseDetailClient />);
        screen.getByRole('button', { name: 'edit_citation' }).click();
        expect(setEditCitation).toHaveBeenCalledWith({ factTable: 'Cases', factId: 3, citationId: 41 });
    });

    it('opens the editor for a citation picked from the preview', () => {
        h.state = caseState({ editCitation: { factTable: 'CaseComments', factId: 12, citationId: 41 } });
        render(<CaseDetailClient />);
        expect(screen.getByTestId('attach-CaseComments').dataset.citation).toBe('41');
    });

    it('asks before removing a case source, and removes it on confirm (#918)', async () => {
        const removeCitation = vi.fn();
        h.state = caseState({ confirmRemoveCitation: { Id: 41, SourceId: 9 }, removeCitation });
        render(<CaseDetailClient />);
        expect(removeCitation).not.toHaveBeenCalled();
        screen.getByRole('button', { name: 'remove_confirm' }).click();
        await vi.waitFor(() => expect(removeCitation).toHaveBeenCalledWith(41));
    });
});
