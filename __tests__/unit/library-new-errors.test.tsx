/** @vitest-environment happy-dom */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const h = vi.hoisted(() => ({
    createSource: vi.fn(),
    push: vi.fn(),
}));

vi.mock('@/lib/data', () => ({
    getDataClient: () => Promise.resolve({ sources: { create: h.createSource } }),
}));
vi.mock('@/app/contexts/TreeContext', () => ({
    useTree: () => ({ activeTreeId: 7 }),
}));
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: h.push }),
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next-intl', () => ({
    useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));
// The source-field component is not under test; this keeps the fixture focused
// on the page's save/error boundary.
vi.mock('@/app/components/SourceFields', () => ({
    SourceFields: ({ value, onChange }: { value: { Title: string }; onChange: (patch: { Title: string }) => void }) => (
        <input
            aria-label="source title"
            value={value.Title}
            onChange={(event) => onChange({ Title: event.target.value })}
        />
    ),
    emptySourceForm: {
        Title: '', Abbreviation: '', Type: 'Document', Author: '', RepositoryName: '',
        CallNumber: '', Text: '', PublicationInfo: '', Contents: '',
    },
}));

import NewSourcePage from '@/app/library/new/page';

describe('new source save errors', () => {
    beforeEach(() => {
        h.createSource.mockRejectedValue(new Error('PGlite: relation Sources does not exist'));
    });

    afterEach(() => vi.clearAllMocks());

    it('renders a translated generic error instead of the raw save failure', async () => {
        const user = userEvent.setup();
        render(<NewSourcePage />);
        await user.type(screen.getByRole('textbox', { name: 'source title' }), 'A fictional source');
        // Desktop bar and phone footer both render in jsdom (CSS picks one, #807).
        await user.click(screen.getAllByRole('button', { name: 'library.save_source' })[0]);

        await waitFor(() => expect(screen.getByText('common.error_generic')).toBeInTheDocument());
        expect(screen.queryByText('PGlite: relation Sources does not exist')).not.toBeInTheDocument();
    });
});
