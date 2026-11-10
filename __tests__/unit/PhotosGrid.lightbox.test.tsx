/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'en' }));
vi.mock('@/app/components/MediaImg', () => ({ default: () => null }));
// The lightbox stub shows which photo is open and lets the test delete it.
vi.mock('@/app/components/lightbox/MediaLightbox', () => ({
    default: ({ items, index, onDeleted, onChangeIndex }: {
        items: Array<{ Id: number }>; index: number;
        onDeleted: (id: number) => void; onChangeIndex: (i: number) => void;
    }) => (
        <div data-testid="lightbox" data-open-id={items[index]?.Id}>
            <button type="button" onClick={() => { onChangeIndex(index); onDeleted(items[index].Id); }}>delete-open</button>
        </div>
    ),
}));

import PhotosGrid from '@/app/library/sections/PhotosGrid';
import type { MediaWithPerson } from '@/lib/db/schema';

const photo = (Id: number, Title: string) => ({ Id, Title, TaggedPersonNames: [] }) as unknown as MediaWithPerson;
const props = {
    loading: false, treeId: 1, canEdit: true, canDelete: true, onPrimaryChanged: vi.fn(),
    emptyState: <p>empty</p>,
};

describe('PhotosGrid lightbox (#802, MD-1)', () => {
    it('stays open on the tagged photo when a refresh drops it from the Untagged list', () => {
        const a = photo(1, 'Wedding'), b = photo(2, 'Picnic');
        const view = render(<PhotosGrid {...props} photos={[a, b]} />);
        fireEvent.click(screen.getByRole('button', { name: 'Wedding' }));
        expect(screen.getByTestId('lightbox')).toHaveAttribute('data-open-id', '1');

        // Tagging a face refreshes the grid; under the Untagged filter the photo leaves it.
        view.rerender(<PhotosGrid {...props} photos={[b]} />);
        expect(screen.getByTestId('lightbox')).toHaveAttribute('data-open-id', '1');

        // Even when the list empties, the lightbox stays.
        view.rerender(<PhotosGrid {...props} photos={[]} />);
        expect(screen.getByText('empty')).toBeInTheDocument();
        expect(screen.getByTestId('lightbox')).toHaveAttribute('data-open-id', '1');
    });

    it('drops a deleted photo from the open list and shows its successor', () => {
        const view = render(<PhotosGrid {...props} photos={[photo(1, 'Wedding'), photo(2, 'Picnic')]} />);
        fireEvent.click(screen.getByRole('button', { name: 'Wedding' }));
        fireEvent.click(screen.getByRole('button', { name: 'delete-open' }));
        view.rerender(<PhotosGrid {...props} photos={[photo(2, 'Picnic')]} />);
        expect(screen.getByTestId('lightbox')).toHaveAttribute('data-open-id', '2');
    });
});
