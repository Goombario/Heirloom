/** @vitest-environment happy-dom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

const lightbox = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => {
    const messages: Record<string, string> = {
      'personDetail.no_photos_title': 'No photos yet',
      'personDetail.no_photos_desc': 'Add a photo to get started.',
      'personDetail.add_picture': 'Add picture',
      'personDetail.photo_alt': 'Photo',
      'personDetail.primary_badge': 'Primary',
      'faceTags.tagged_badge': 'Tagged',
      'ownerMedia.fact_birth': 'Birth',
    };
    return (key: string) => messages[`${namespace}.${key}`] ?? key;
  },
}));
vi.mock('@/app/components/lightbox/MediaLightbox', () => ({
  default: (props: Record<string, unknown>) => {
    lightbox.props = props;
    return <div data-testid="lightbox" />;
  },
}));
vi.mock('@/app/components/MediaImg', () => ({ default: () => <div data-testid="image" /> }));

import { PersonGalleryCard } from '@/app/people/view/PersonGalleryCard';

const media = [
  { Id: 10, UserId: 1, Title: 'Portrait', FilePath: 'portrait.jpg', Format: 'jpg', ContentType: 'image/jpeg', IsOwned: true, IsTaggedHere: false, IsPersonPrimary: true, TagRegionX: null, TagRegionY: null, TagRegionW: null, TagRegionH: null },
  { Id: 20, UserId: 1, Title: null, FilePath: 'group.jpg', Format: 'jpg', ContentType: 'image/jpeg', IsOwned: false, IsTaggedHere: true, IsPersonPrimary: false, TagRegionX: 1, TagRegionY: 1, TagRegionW: 2, TagRegionH: 2 },
];

describe('PersonGalleryCard', () => {
  it('uses a wrapping gallery without horizontal scroller affordances and keeps badges', () => {
    render(<PersonGalleryCard media={media} personId={7} treeId={1} canEdit canDelete onPrimaryChanged={vi.fn()} />);
    expect(screen.getByTestId('media-gallery-grid')).toBeInTheDocument();
    expect(screen.queryByLabelText('previous')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('next')).not.toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('Tagged')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Portrait, Primary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Photo, Tagged' })).toBeInTheDocument();
  });

  it('shows no Birth / Death tag on a fact-scoped photo, but names the fact in its alt text (#1215)', () => {
    const birth = [{ ...media[0], Id: 30, Title: 'Baptism', IsPersonPrimary: false, OwnerFacts: ['Birth' as const] }];
    render(<PersonGalleryCard media={birth} personId={7} treeId={1} canEdit canDelete onPrimaryChanged={vi.fn()} />);
    expect(screen.queryByText('Birth')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Baptism, Birth' })).toBeInTheDocument();
  });

  it('uses the standard grid at every count, with no strip (#780)', () => {
    const { unmount } = render(<PersonGalleryCard media={media} personId={7} treeId={1} canEdit canDelete onPrimaryChanged={vi.fn()} />);
    expect(screen.getByTestId('media-gallery-grid')).toHaveClass('grid', 'grid-cols-[repeat(auto-fill,minmax(104px,1fr))]');
    unmount();
    const four = [10, 20, 30, 40].map((Id, i) => ({ ...media[i % 2], Id }));
    render(<PersonGalleryCard media={four} personId={7} treeId={1} canEdit canDelete onPrimaryChanged={vi.fn()} />);
    expect(screen.getByTestId('media-gallery-grid')).toHaveClass('grid', 'grid-cols-[repeat(auto-fill,minmax(104px,1fr))]');
  });

  it('keeps the permission-gated empty upload action', () => {
    const onAddPhoto = vi.fn();
    const { rerender } = render(<PersonGalleryCard media={[]} personId={7} treeId={1} canEdit canDelete onPrimaryChanged={vi.fn()} onAddPhoto={onAddPhoto} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add picture' }));
    expect(onAddPhoto).toHaveBeenCalledOnce();
    rerender(<PersonGalleryCard media={[]} personId={7} treeId={1} canEdit={false} canDelete={false} onPrimaryChanged={vi.fn()} onAddPhoto={onAddPhoto} />);
    expect(screen.queryByRole('button', { name: 'Add picture' })).not.toBeInTheDocument();
  });

  it('passes primary, tag, and delete refresh callbacks to the lightbox', () => {
    const refresh = vi.fn();
    render(<PersonGalleryCard media={media} personId={7} treeId={1} canEdit canDelete onPrimaryChanged={refresh} />);
    fireEvent.click(screen.getByRole('button', { name: 'Portrait, Primary' }));
    expect(lightbox.props).toMatchObject({ context: 'person', galleryPersonId: 7, onPrimaryChanged: refresh, onTagsChanged: refresh, onDeleted: refresh });
  });
});
