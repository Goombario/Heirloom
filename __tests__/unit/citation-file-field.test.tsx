/** @vitest-environment happy-dom */
// #47: a citation's own file, on its row and in its editor.
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const h = vi.hoisted(() => ({
    listForOwner: vi.fn(),
    unlinkFromOwner: vi.fn(),
    addProps: null as null | Record<string, unknown>,
}));

vi.mock('@/lib/data', () => ({
    DATA_MODE: 'http',
    getDataClient: () => Promise.resolve({ media: { listForOwner: h.listForOwner, unlinkFromOwner: h.unlinkFromOwner } }),
}));
vi.mock('@/app/components/MediaImg', () => ({ default: () => <span data-testid="thumb" /> }));
vi.mock('@/app/components/lightbox/DocumentLinks', () => ({
    useDocumentFile: (id: number) => ({ fileHref: `/api/media/${id}/file`, downloadHref: null }),
}));
vi.mock('@/app/components/media/AddMediaModal', () => ({
    default: (props: Record<string, unknown>) => { h.addProps = props; return <div role="dialog" />; },
}));
vi.mock('next-intl', () => ({
    useTranslations: (ns?: string) => (key: string, values?: Record<string, unknown>) => {
        const full = ns ? `${ns}.${key}` : key;
        return values ? `${full}:${Object.values(values).join(',')}` : full;
    },
}));

import { CitationFileField, CitationFileLine, pdfPageOf } from '@/app/components/citations/CitationFileField';

const register = { Id: 5, Title: 'Birth register', ContentType: 'application/pdf' };

describe('pdfPageOf', () => {
    it.each([['4', 4], ['p. 4', 4], ['p.4', 4], ['page 12', 12], ['Pg 3', 3], [' 7 ', 7]])('reads %j as page %i', (page, n) => {
        expect(pdfPageOf(page)).toBe(n);
    });

    it.each([null, undefined, '', 'Vol. 1889, entry 1', 'entry 4', 'p. 0', 'folio 2'])('names no page for %j', (page) => {
        expect(pdfPageOf(page)).toBeNull();
    });
});

describe('CitationFileLine', () => {
    it('names the file and its kind, with the PDF page the citation names', () => {
        render(<CitationFileLine title="Birth register" contentType="application/pdf" page="p. 1" />);
        expect(screen.getByLabelText('citationFile.line_aria:Birth register')).toHaveTextContent('Birth register· citationFile.kind_pdf_page:1');
    });
});

describe('CitationFileField', () => {
    beforeEach(() => {
        h.listForOwner.mockReset().mockResolvedValue([register]);
        h.unlinkFromOwner.mockReset().mockResolvedValue(undefined);
        h.addProps = null;
    });

    it('lists the citation file and opens a PDF at the page the citation names', async () => {
        render(<CitationFileField citationId={9} treeId={3} page="p. 4" canEdit />);
        expect(await screen.findByText('Birth register')).toBeInTheDocument();
        expect(h.listForOwner).toHaveBeenCalledWith('Citation', 9, 3);
        expect(screen.getByText('citationFile.kind_pdf_page:4')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'citationFile.open' })).toHaveAttribute('href', '/api/media/5/file#page=4');
        expect(screen.getByText('citationFile.opens_at_page')).toBeInTheDocument();
    });

    it('removes a file from the citation only, and tells the caller', async () => {
        const onChange = vi.fn();
        render(<CitationFileField citationId={9} treeId={3} page={null} canEdit onChange={onChange} />);
        await userEvent.click(await screen.findByRole('button', { name: 'citationFile.remove_aria:Birth register' }));
        await waitFor(() => expect(h.unlinkFromOwner).toHaveBeenCalledWith(5, 'Citation', 9, 3));
        expect(onChange).toHaveBeenCalled();
    });

    it('attaches through Add media aimed at the citation', async () => {
        h.listForOwner.mockResolvedValue([]);
        render(<CitationFileField citationId={9} treeId={3} page={null} canEdit targetName="Parish register" />);
        await userEvent.click(await screen.findByRole('button', { name: 'citationFile.attach' }));
        expect(h.addProps).toMatchObject({ target: { kind: 'owner', ownerTable: 'Citation', ownerId: 9 }, treeId: 3, targetName: 'Parish register' });
    });

    it('shows nothing to a viewer when the citation has no file', async () => {
        h.listForOwner.mockResolvedValue([]);
        const { container } = render(<CitationFileField citationId={9} treeId={3} page={null} canEdit={false} />);
        await waitFor(() => expect(h.listForOwner).toHaveBeenCalled());
        await waitFor(() => expect(container).toBeEmptyDOMElement());
    });
});
