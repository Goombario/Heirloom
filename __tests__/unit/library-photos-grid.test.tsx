/** @vitest-environment happy-dom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: { title?: string; size?: string }) => ({
    photo_alt: 'Photo',
    photo_select: `Select ${values?.title ?? 'photo'}`,
    photo_deselect: `Deselect ${values?.title ?? 'photo'}`,
    photo_size_label: `Size ${values?.size ?? ''}`,
    photo_delete_failed: 'Deletion failed',
  }[key] ?? key),
}));
const mediaImgMocks = vi.hoisted(() => ({ retry: vi.fn() }));
const loadPhase = vi.hoisted(() => ({ value: 'loaded' as 'loading' | 'loaded' }));
vi.mock('@/app/components/MediaImg', () => ({ default: ({ alt, onFailure }: { alt: string; onFailure?: (retry: () => void) => void }) => (
  // eslint-disable-next-line @next/next/no-img-element -- lightweight test double
  <img src="photo.jpg" alt={alt} onError={() => onFailure?.(mediaImgMocks.retry)} />
) }));
vi.mock('@/app/components/lightbox/MediaLightbox', () => ({ default: () => <div data-testid="lightbox">lightbox</div> }));
vi.mock('@/app/components/SkeletonLoader', () => ({ SkeletonGrid: ({ className, columns, gap }: { className?: string; columns?: string | null; gap?: number }) => (
  <div
    data-testid="skeleton"
    className={className}
    data-columns={columns === null ? 'responsive' : columns}
    data-gap={gap}
  />
) }));
vi.mock('@/app/components/useLoadPhase', () => ({ useLoadPhase: () => loadPhase.value }));

import PhotosGrid from '@/app/library/sections/PhotosGrid';

const photos = [
  { Id: 1, UserId: 1, Title: 'Ada', FilePath: 'ada.jpg', Format: 'jpg', ContentType: 'image/jpeg', FileSize: 8.4 * 1024 * 1024 },
  { Id: 2, UserId: 1, Title: 'Charles', FilePath: 'charles.jpg', Format: 'jpg', ContentType: 'image/jpeg', FileSize: 0 },
];

describe('PhotosGrid selection', () => {
  const baseProps = {
    photos,
    loading: false,
    treeId: 1,
    canEdit: true,
    canDelete: true,
    onPrimaryChanged: vi.fn(),
    emptyState: <p>no photos</p>,
  };

  afterEach(() => {
    loadPhase.value = 'loaded';
  });

  it('renders the page-supplied empty state when there are no photos', () => {
    render(<PhotosGrid {...baseProps} photos={[]} />);
    expect(screen.getByText('no photos')).toBeInTheDocument();
  });

  it('opens the lightbox in browse mode', () => {
    render(<PhotosGrid {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ada' }));
    expect(screen.getByTestId('lightbox')).toBeInTheDocument();
  });

  it('uses the loaded grid breakpoints while photos are loading', () => {
    loadPhase.value = 'loading';
    render(<PhotosGrid {...baseProps} loading />);

    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton).toHaveClass(
      'grid-cols-2',
      'sm:grid-cols-3',
      'lg:grid-cols-4',
    );
    // No xl auto-fill: the capped list column only fits three 200px tracks there (#886).
    expect(skeleton.className).not.toContain('xl:');
    expect(skeleton).toHaveAttribute('data-columns', 'responsive');
    expect(skeleton).toHaveAttribute('data-gap', '10');
  });

  it('toggles selection instead of opening the lightbox in select mode', () => {
    const onToggleSelection = vi.fn();
    render(<PhotosGrid {...baseProps} selectionMode selectedIds={new Set()} failedIds={new Set()} onToggleSelection={onToggleSelection} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select Ada' }));
    expect(onToggleSelection).toHaveBeenCalledWith(1);
    expect(screen.queryByTestId('lightbox')).not.toBeInTheDocument();
  });

  it('exposes selected and failed state with a visible, shape-based cue', () => {
    render(<PhotosGrid {...baseProps} selectionMode selectedIds={new Set([1])} failedIds={new Set([2])} onToggleSelection={vi.fn()} />);
    const selected = screen.getByRole('button', { name: 'Deselect Ada' });
    const failed = screen.getByRole('button', { name: 'Select Charles' });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(failed).toHaveAttribute('aria-pressed', 'false');
    expect(selected.querySelector('[data-testid="selection-check"]')).toBeInTheDocument();
    expect(failed).toHaveAttribute('title', 'Deletion failed');
    expect(failed).toHaveAttribute('aria-describedby', 'photo-failure-status-2');
    expect(failed).toHaveAccessibleDescription('Deletion failed');
    expect(failed.querySelector('[data-testid="photo-failure-2"]')).toBeInTheDocument();
  });

  it('keeps the full tile keyboard focusable with a mobile-sized target', () => {
    render(<PhotosGrid {...baseProps} selectionMode selectedIds={new Set()} failedIds={new Set()} onToggleSelection={vi.fn()} />);
    const tile = screen.getByRole('button', { name: 'Select Ada' });
    expect(tile).toHaveClass('min-h-11', 'focus-ring');
    expect(tile.parentElement?.parentElement?.parentElement).toHaveClass(
      'grid-cols-2',
      'sm:grid-cols-3',
      'lg:grid-cols-4',
    );
  });

  it('does not leave a dangling failure description in browse mode', () => {
    render(<PhotosGrid {...baseProps} failedIds={new Set([1])} />);
    const tile = screen.getByRole('button', { name: 'Ada' });
    expect(tile).not.toHaveAttribute('aria-describedby');
  });

  it('disables selection tiles while a deletion is pending without losing state', () => {
    const onToggleSelection = vi.fn();
    render(<PhotosGrid
      {...baseProps}
      selectionMode
      selectionDisabled
      selectedIds={new Set([1])}
      failedIds={new Set([2])}
      onToggleSelection={onToggleSelection}
    />);
    const selected = screen.getByRole('button', { name: 'Deselect Ada' });
    const failed = screen.getByRole('button', { name: 'Select Charles' });
    expect(selected).toBeDisabled();
    expect(failed).toBeDisabled();
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(failed).toHaveAttribute('aria-describedby', 'photo-failure-status-2');
    fireEvent.click(selected);
    expect(onToggleSelection).not.toHaveBeenCalled();
  });

  it('shows localized size badges and accessible size text only for Largest first', () => {
    const { rerender } = render(<PhotosGrid {...baseProps} showFileSizes />);

    const adaTile = screen.getByRole('button', { name: 'Ada. Size 8.4\u00a0MB' });
    const sizeBadge = adaTile.querySelector('span[aria-hidden="true"]');
    expect(sizeBadge).toHaveTextContent(/8\.4\s+MB/);
    expect(sizeBadge).toHaveClass('right-2', 'top-2');
    expect(screen.queryByRole('button', { name: /Charles.*Size/ })).not.toBeInTheDocument();
    expect(adaTile).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Charles' })).toBeInTheDocument();

    rerender(<PhotosGrid {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Ada' }).querySelector('span[aria-hidden="true"]')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ada' })).toBeInTheDocument();
  });

  it('shows a visible media failure with a separate retry action', () => {
    render(<PhotosGrid {...baseProps} />);

    fireEvent.error(screen.getByRole('img', { name: 'Ada' }));
    const tile = screen.getByRole('button', { name: 'Ada' });
    expect(tile).toHaveAccessibleDescription('media_load_failed');

    fireEvent.click(screen.getByRole('button', { name: 'media_retry' }));
    expect(mediaImgMocks.retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'media_retry' })).not.toBeInTheDocument();
  });

  it('lets clicks through a failed tile so it can still be opened or selected (#948)', () => {
    const onToggleSelection = vi.fn();
    const { rerender } = render(<PhotosGrid {...baseProps} />);
    fireEvent.error(screen.getByRole('img', { name: 'Ada' }));

    // happy-dom has no hit testing: pin the CSS that lets a real click reach the tile.
    const overlay = screen.getByTestId('photo-media-failure-1');
    expect(overlay).toHaveClass('pointer-events-none');
    expect(screen.getByRole('button', { name: 'media_retry' })).toHaveClass('pointer-events-auto');
    fireEvent.click(screen.getByRole('button', { name: 'Ada' }));
    expect(screen.getByTestId('lightbox')).toBeInTheDocument();

    rerender(<PhotosGrid {...baseProps} selectionMode selectedIds={new Set([1])} failedIds={new Set()} onToggleSelection={onToggleSelection} />);
    fireEvent.click(screen.getByRole('button', { name: 'Deselect Ada' }));
    expect(onToggleSelection).toHaveBeenCalledWith(1);
    // The overlay hides the tile's own check, so it repeats it.
    expect(screen.getByTestId('failure-selection-check')).toBeInTheDocument();
  });
});
