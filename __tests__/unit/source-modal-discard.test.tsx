/** @vitest-environment happy-dom */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useState } from 'react';

const h = vi.hoisted(() => ({
    get: vi.fn(),
    citedBy: vi.fn(),
    create: vi.fn(),
}));

const savedSource = {
    Id: 42,
    OwnerId: 7,
    Title: 'Persisted register',
    Type: 'Document',
    Author: null,
    Abbreviation: null,
    RepositoryName: null,
    CallNumber: null,
    Text: null,
    PublicationInfo: null,
    Contents: null,
};

vi.mock('@/lib/data', () => ({
    getDataClient: () => Promise.resolve({ sources: { get: h.get, citedBy: h.citedBy, create: h.create } }),
}));
vi.mock('@/app/components/useErrorToast', () => {
    // Stable, like the real hook's: the editor's load effect is keyed on it.
    const toast = { redirectIfUnauthorized: () => false };
    return { useErrorToast: () => toast };
});
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/app/hooks/useDocumentScrollLock', () => ({ useDocumentScrollLock: () => {} }));
vi.mock('next-intl', () => {
    // One stable `t` per namespace, as next-intl gives: a fresh one per render re-runs every effect keyed on it.
    const cache = new Map<string, (key: string) => string>();
    return {
        useTranslations: (namespace: string) => {
            if (!cache.has(namespace)) cache.set(namespace, (key: string) => `${namespace}.${key}`);
            return cache.get(namespace)!;
        },
    };
});
vi.mock('@/app/components/SourceFields', () => ({
    emptySourceForm: {
        Title: '', Abbreviation: '', Type: 'Document', Author: '', RepositoryName: '', CallNumber: '',
        Text: '', PublicationInfo: '', Contents: '',
    },
    SourceFields: ({ value, onChange }: { value: { Title: string }; onChange: (patch: { Title: string }) => void }) => (
        <input aria-label="source title" value={value.Title} onChange={(e) => onChange({ Title: e.target.value })} />
    ),
}));
vi.mock('@/app/components/Modal', () => ({
    default: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null,
}));
vi.mock('@/app/components/ConfirmDialog', () => ({ default: () => null }));
vi.mock('@/app/library/source-modal/parts', () => ({
    SourceIdentity: () => <div>identity</div>,
    SourceDetailBody: () => <div>details</div>,
    MobilePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    MobileBackButton: () => null,
    MobilePanelHeader: () => null,
}));
vi.mock('@/app/components/ui', () => ({
    Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
        <button type="button" onClick={onClick} disabled={disabled}>{children}</button>
    ),
    HeroEditButton: ({ onClick }: { onClick?: () => void }) => (
        <button type="button" onClick={onClick}>common.edit</button>
    ),
    InlineDataError: () => null,
    ScrollArea: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
    ),
}));
vi.mock('@/lib/icons', () => {
    const Icon = () => null;
    return { Pencil: Icon, Link2Off: Icon, Trash2: Icon, Plus: Icon, X: Icon };
});
import SourceModal from '@/app/library/SourceModal';
import { UnsavedChangesProvider } from '@/app/components/UnsavedChangesProvider';

describe('SourceModal edit cancellation', () => {
    beforeEach(() => {
        h.get.mockResolvedValue(savedSource);
        h.citedBy.mockResolvedValue([]);
        vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('restores persisted values and clears dirty state after confirmed cancel', async () => {
        render(
            <UnsavedChangesProvider>
                <SourceModal sourceId={42} treeId={7} canEdit canDelete onClose={() => {}} onChanged={() => {}} />
            </UnsavedChangesProvider>,
        );
        await waitFor(() => expect(screen.getByText('common.edit')).toBeInTheDocument());

        fireEvent.click(screen.getByText('common.edit'));
        const title = screen.getByRole('textbox', { name: 'source title' });
        fireEvent.change(title, { target: { value: 'Discarded draft' } });
        expect(screen.getByDisplayValue('Discarded draft')).toBeInTheDocument();

        fireEvent.click(screen.getByText('common.cancel'));
        await waitFor(() => expect(screen.getByText('common.edit')).toBeInTheDocument());
        fireEvent.click(screen.getByText('common.edit'));

        expect(screen.getByRole('textbox', { name: 'source title' })).toHaveValue('Persisted register');
        expect(window.confirm).toHaveBeenCalledWith('common.unsaved_changes_confirm');
    });

    it('opens the new source after saving it, not the list (#799)', async () => {
        h.create.mockResolvedValue({ ...savedSource, Id: 99, Title: 'New census' });
        const onCreated = vi.fn();
        const onClose = vi.fn();
        // As the library page does: the new-source modal goes, and the source opens.
        function Harness() {
            const [open, setOpen] = useState(true);
            return open ? (
                <SourceModal sourceId={null} treeId={7} canEdit canDelete onClose={onClose} onChanged={() => {}} onCreated={(id) => { setOpen(false); onCreated(id); }} />
            ) : null;
        }
        render(<UnsavedChangesProvider><Harness /></UnsavedChangesProvider>);
        fireEvent.change(screen.getByRole('textbox', { name: 'source title' }), { target: { value: 'New census' } });
        fireEvent.click(screen.getByText('common.save'));
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith(99));
        expect(onClose).not.toHaveBeenCalled();
    });
});
