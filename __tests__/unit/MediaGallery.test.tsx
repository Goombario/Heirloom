/** @vitest-environment happy-dom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

const lightbox = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/app/components/MediaImg', () => ({ default: () => <div data-testid="image" /> }));
vi.mock('@/app/components/lightbox/MediaLightbox', () => ({
  default: (props: Record<string, unknown>) => {
    lightbox.props = props;
    return <div data-testid="lightbox" />;
  },
}));

import { MediaGallery } from '@/app/components/media/MediaGallery';

const item = (Id: number) => ({ Id, UserId: 1, Title: `Photo ${Id}`, FilePath: `${Id}.jpg`, Format: 'jpg', ContentType: 'image/jpeg' });
const config = { context: 'library' as const, canEdit: true, canDelete: true };

describe('MediaGallery', () => {
  it('tracks the active media by id when the collection reorders', () => {
    const { rerender } = render(<MediaGallery items={[item(10), item(20)]} treeId={1} lightbox={config} />);
    fireEvent.click(screen.getByRole('button', { name: 'Photo 20' }));
    expect(lightbox.props).toMatchObject({ index: 1 });
    rerender(<MediaGallery items={[item(20), item(10)]} treeId={1} lightbox={config} />);
    expect(lightbox.props).toMatchObject({ index: 0 });
    expect((lightbox.props?.items as Array<{ Id: number }>)[0].Id).toBe(20);
  });

  it('closes when the active id disappears after a refresh', () => {
    const { rerender } = render(<MediaGallery items={[item(10), item(20)]} treeId={1} lightbox={config} />);
    fireEvent.click(screen.getByRole('button', { name: 'Photo 20' }));
    expect(screen.getByTestId('lightbox')).toBeInTheDocument();
    rerender(<MediaGallery items={[item(10)]} treeId={1} lightbox={config} />);
    expect(screen.queryByTestId('lightbox')).not.toBeInTheDocument();
  });

  it('does not reopen a removed id if that id is restored later', () => {
    const { rerender } = render(<MediaGallery items={[item(10), item(20)]} treeId={1} lightbox={config} />);
    fireEvent.click(screen.getByRole('button', { name: 'Photo 20' }));
    rerender(<MediaGallery items={[item(10)]} treeId={1} lightbox={config} />);
    expect(screen.queryByTestId('lightbox')).not.toBeInTheDocument();

    rerender(<MediaGallery items={[item(20), item(10)]} treeId={1} lightbox={config} />);
    expect(screen.queryByTestId('lightbox')).not.toBeInTheDocument();
  });
});
