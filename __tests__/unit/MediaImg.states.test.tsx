/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mediaUrlMock = vi.hoisted(() => ({
  state: {
    src: null as string | null,
    loading: true,
    error: false,
    retry: vi.fn(),
    fallback: vi.fn(),
    usingFullFallback: false,
    reloadKey: 0,
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => ({
    media_loading: 'Loading photo…',
    media_load_failed: 'Photo unavailable',
  }[key] ?? key),
}));
vi.mock('@/lib/media/useMediaUrl', () => ({ useMediaUrl: () => mediaUrlMock.state }));

import MediaImg from '@/app/components/MediaImg';

describe('MediaImg states', () => {
  beforeEach(() => {
    mediaUrlMock.state = {
      src: null,
      loading: true,
      error: false,
      retry: vi.fn(),
      fallback: vi.fn(),
      usingFullFallback: false,
      reloadKey: 0,
    };
  });

  it('renders a visible loading state while the local object URL resolves', () => {
    render(<MediaImg mediaId={1} width={256} alt="Portrait" />);
    expect(screen.getByLabelText('Loading photo…')).toBeInTheDocument();
  });

  it('falls back from a failed thumbnail before showing a final error', async () => {
    const onFailure = vi.fn();
    mediaUrlMock.state = { ...mediaUrlMock.state, loading: false, error: true };
    const { rerender } = render(<MediaImg mediaId={1} width={256} alt="Portrait" onFailure={onFailure} />);
    await waitFor(() => expect(mediaUrlMock.state.fallback).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText('Photo unavailable')).not.toBeInTheDocument();

    mediaUrlMock.state = { ...mediaUrlMock.state, usingFullFallback: true };
    rerender(<MediaImg mediaId={1} width={256} alt="Portrait" onFailure={onFailure} />);
    expect(screen.getByLabelText('Photo unavailable')).toBeInTheDocument();
    await waitFor(() => expect(onFailure).toHaveBeenCalledWith(mediaUrlMock.state.retry));
  });
});
