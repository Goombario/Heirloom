/** @vitest-environment happy-dom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import MediaStorageCard from '@/app/library/sections/MediaStorageCard';
import type { MediaStorageSummary } from '@/lib/data/types';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const text = ({
      photo_storage_this_tree: 'This tree',
      photo_storage_title: 'Media storage',
      photo_storage_percent: '{percent}% used',
      photo_storage_of_limit: 'of {limit}',
      photo_storage_progress_label: 'Media storage used',
      photo_storage_available: 'Available',
      photo_storage_near_limit: 'Near the limit',
      photo_storage_almost_full: 'Almost full',
      photo_storage_full: 'Full',
      photo_storage_left: '{remaining} left',
      photo_storage_review_largest: 'Review largest files',
      photo_storage_device: 'Storage managed by this device',
      photo_storage_error: 'Storage information unavailable',
      photo_storage_retry: 'Retry',
    }[key] ?? key);
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
  },
}));

const treeSummary = (percentUsed: number): MediaStorageSummary => ({
  usedBytes: 82 * 1024 * 1024,
  limitBytes: 100 * 1024 * 1024,
  remainingBytes: 18 * 1024 * 1024,
  percentUsed,
  quotaMode: 'tree',
});

const baseProps = {
  loading: false,
  error: null,
  onRetry: vi.fn(),
  onReviewLargest: vi.fn(),
};

describe('MediaStorageCard', () => {
  it.each([
    [79, 'Available'],
    [80, 'Near the limit'],
    [90, 'Almost full'],
    [100, 'Full'],
  ])('renders the %s%% threshold as %s', (percent, label) => {
    render(<MediaStorageCard {...baseProps} summary={treeSummary(percent)} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(Math.min(100, percent)));
  });

  it('is the rail footer: no card chrome at rest, a tinted box only as a warning (#780)', () => {
    const { unmount } = render(<MediaStorageCard {...baseProps} summary={treeSummary(40)} />);
    expect(screen.getByTestId('library-storage-card')).not.toHaveClass('shadow-card', 'border');
    unmount();
    render(<MediaStorageCard {...baseProps} summary={treeSummary(92)} />);
    expect(screen.getByTestId('library-storage-card')).toHaveClass('border', 'border-warning');
  });

  it('shows device-managed usage without a fabricated percentage or progress bar', () => {
    render(<MediaStorageCard
      {...baseProps}
      summary={{
        usedBytes: 12 * 1024 * 1024,
        limitBytes: null,
        remainingBytes: null,
        percentUsed: null,
        quotaMode: 'device',
      }}
    />);

    expect(screen.getByText(/12\s+MB/)).toBeInTheDocument();
    expect(screen.getByText('Storage managed by this device')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review largest files' })).toBeInTheDocument();
  });

  it('keeps a summary failure retryable without rendering quota values', () => {
    const onRetry = vi.fn();
    render(<MediaStorageCard {...baseProps} summary={null} error={new Error('private server detail')} onRetry={onRetry} />);

    expect(screen.getByText('Storage information unavailable')).toBeInTheDocument();
    expect(screen.queryByText('private server detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('routes Review largest files to the supplied sort action', () => {
    const onReviewLargest = vi.fn();
    render(<MediaStorageCard {...baseProps} onReviewLargest={onReviewLargest} summary={treeSummary(82)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Review largest files' }));
    expect(onReviewLargest).toHaveBeenCalledOnce();
  });
});
