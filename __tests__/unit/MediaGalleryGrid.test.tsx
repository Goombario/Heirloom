/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => ({ photo_alt: 'Attached media' }[key] ?? key),
}));
vi.mock('@/app/components/MediaImg', () => ({
  default: (props: { alt: string; width?: number; loading?: 'lazy' | 'eager' }) => (
    // eslint-disable-next-line @next/next/no-img-element -- lightweight test double
    <img src="photo.jpg" alt={props.alt} width={props.width} loading={props.loading} />
  ),
}));

import { MediaGalleryGrid } from '@/app/components/media/MediaGalleryGrid';

const items = [
  { Id: 10, UserId: 1, Title: null, FilePath: 'ten.jpg', Format: 'jpg', ContentType: 'image/jpeg' },
  { Id: 20, UserId: 1, Title: 'Family reunion', FilePath: 'twenty.jpg', Format: 'jpg', ContentType: 'image/jpeg' },
];

describe('MediaGalleryGrid', () => {
  it('uses a wrapping responsive grid and lazy 256px thumbnails', () => {
    render(<MediaGalleryGrid items={items} treeId={3} onOpen={vi.fn()} />);
    const grid = screen.getByTestId('media-gallery-grid');
    expect(grid).toHaveClass('grid', 'grid-cols-[repeat(auto-fill,minmax(104px,1fr))]');
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getAllByRole('img')[0]).toHaveAttribute('width', '256');
    expect(screen.getAllByRole('img')[0]).toHaveAttribute('loading', 'lazy');
  });

  it('derives translated alt text while preserving a title as the accessible label', () => {
    render(<MediaGalleryGrid items={items} treeId={3} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Attached media' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Family reunion' })).toHaveAttribute('title', 'Family reunion');
  });

  it('opens by semantic keyboard activation and supports optional badge/action slots', async () => {
    const onOpen = vi.fn();
    render(
      <MediaGalleryGrid
        items={items.slice(0, 1)}
        treeId={3}
        onOpen={onOpen}
        renderBadge={() => <span data-testid="badge">Primary</span>}
        renderAction={() => <button type="button" className="min-h-11 min-w-11">Remove</button>}
      />,
    );
    expect(screen.getByTestId('badge')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveClass('min-h-11', 'min-w-11');
    const tile = screen.getByRole('button', { name: 'Attached media' });
    expect(tile).toHaveClass('min-h-11', 'min-w-11', 'focus-ring');
    tile.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith(10);
  });

  it('omits optional slots and actionable markup for an empty gallery', () => {
    render(<MediaGalleryGrid items={[]} treeId={3} onOpen={vi.fn()} renderBadge={() => <span>badge</span>} renderAction={() => <button>remove</button>} />);
    expect(screen.queryByTestId('media-gallery-grid')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('badge')).not.toBeInTheDocument();
  });
});
