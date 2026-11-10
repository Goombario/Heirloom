/** @vitest-environment happy-dom */
/**
 * #846: Escape while the Cite on… write is in flight neither asks to discard
 * nor leaves the view, and the "Cited on N facts." line shows once it lands.
 * The real Modal, CiteOnPanel and unsaved-changes guard; the data is mocked.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const h = vi.hoisted(() => ({
    createMany: vi.fn(),
}));

const census = {
    Id: 30, OwnerId: 7, Title: '1901 Census of Asteria, household 12', Type: 'Census', Author: null, Abbreviation: null,
    RepositoryName: null, CallNumber: null, Text: null, PublicationInfo: null, Contents: null,
};
const people: Record<number, object> = {
    1: { Id: 1, FirstName: 'Tom', LastName: 'Bracken', BirthDate: '1859', events: [] },
    2: { Id: 2, FirstName: 'Ann', LastName: 'Bracken', BirthDate: '1885', events: [] },
};

vi.mock('@/lib/data', () => ({
    getDataClient: () => Promise.resolve({
        sources: { get: vi.fn().mockResolvedValue(census), citedBy: vi.fn().mockResolvedValue([]) },
        families: {
            search: vi.fn().mockResolvedValue([{ Id: 9, husbandName: 'Tom Bracken', wifeName: null, childCount: 1, MarriageDate: null }]),
            get: vi.fn().mockResolvedValue({ husband: { Id: 1 }, wife: null, children: [{ Id: 2 }] }),
        },
        people: { get: (id: number) => Promise.resolve(people[id]), search: vi.fn().mockResolvedValue([]) },
        citations: { createMany: h.createMany },
    }),
}));
vi.mock('@/app/components/useErrorToast', () => {
    const toast = { redirectIfUnauthorized: () => false };
    return { useErrorToast: () => toast };
});
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/app/hooks/useDocumentScrollLock', () => ({ useDocumentScrollLock: () => {} }));
vi.mock('next-intl', () => {
    const cache = new Map<string, (key: string, values?: Record<string, unknown>) => string>();
    return {
        useTranslations: (namespace: string) => {
            if (!cache.has(namespace)) {
                cache.set(namespace, (key, values) => values && 'count' in values ? `${key}:${values.count}` : key);
            }
            return cache.get(namespace)!;
        },
    };
});
vi.mock('@/app/library/source-modal/parts', () => ({
    SourceIdentity: () => <div>identity</div>,
    SourceDetailBody: ({ onCiteOn }: { onCiteOn?: () => void }) => <button type="button" onClick={onCiteOn}>cite on</button>,
    MobilePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    MobileBackButton: () => null,
    MobilePanelHeader: () => null,
}));

import SourceModal from '@/app/library/SourceModal';
import { UnsavedChangesProvider } from '@/app/components/UnsavedChangesProvider';

describe('SourceModal: Escape during a Cite on… save (#846)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('neither asks nor closes while the write is in flight, and shows the result once it lands', async () => {
        let finish: () => void = () => {};
        h.createMany.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
        const onClose = vi.fn();
        const user = userEvent.setup();
        render(
            <UnsavedChangesProvider>
                <SourceModal sourceId={30} treeId={7} canEdit canDelete onClose={onClose} onChanged={() => {}} />
            </UnsavedChangesProvider>,
        );

        await user.click(await screen.findByRole('button', { name: 'cite on' }));
        await user.type(screen.getByRole('textbox', { name: 'search_families_plain' }), 'Bracken');
        await user.click(await screen.findByRole('button', { name: /Tom Bracken/ }));
        await screen.findByRole('heading', { name: /Ann Bracken/ });
        for (const box of screen.getAllByRole('checkbox', { name: /BIRT/ })) await user.click(box);
        await user.click(screen.getByRole('button', { name: 'cite_on_submit:2' }));
        await waitFor(() => expect(h.createMany).toHaveBeenCalledOnce());

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(window.confirm).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'cite_on_citing' })).toBeInTheDocument();

        await act(async () => { finish(); });
        const done = await screen.findByText('cite_on_done:2');
        expect(done).toHaveFocus();
        expect(window.confirm).not.toHaveBeenCalled();

        // The guard is clear: Escape now closes the source without asking.
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(window.confirm).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledOnce();
    });
});
