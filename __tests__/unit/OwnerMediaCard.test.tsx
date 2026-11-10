/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

const gallery = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
const listGalleryForOwner = vi.hoisted(() => vi.fn());
const unlinkFromOwner = vi.hoisted(() => vi.fn());
vi.mock('next-intl', () => ({ useTranslations: (namespace: string) => {
  const messages: Record<string, string> = {
    'ownerMedia.empty': 'No media attached.',
    'ownerMedia.empty_edit': 'No media yet.',
    'ownerMedia.add_button': 'Add media',
    'ownerMedia.attach_existing': 'Attach from library',
    'ownerMedia.remove': 'Remove from this record',
    'ownerMedia.photo_alt': 'Attached media',
    'ownerMedia.fact_birth': 'Birth',
    'common.loading': 'Loading',
  };
  return (key: string) => messages[`${namespace}.${key}`] ?? key;
} }));
vi.mock('@/lib/data', () => ({ getDataClient: async () => ({ media: { listGalleryForOwner, unlinkFromOwner } }) }));
vi.mock('@/app/components/media/MediaGallery', () => ({
  default: (props: Record<string, unknown>) => {
    gallery.props = props;
    return <div data-testid="shared-gallery" />;
  },
}));
vi.mock('@/app/components/UploadModal', () => ({ default: () => null }));
vi.mock('@/app/components/media/MediaPickerModal', () => ({ default: () => null }));
vi.mock('@/app/components/useErrorToast', () => ({ useErrorToast: () => ({ reportError: vi.fn() }) }));
vi.mock('@/lib/utils/data-error', () => ({ handleDataError: () => false }));

import { OwnerMediaCard } from '@/app/components/media/OwnerMediaCard';

const rows = [
  { Id: 10, UserId: 1, Title: 'Explicit family photo', FilePath: 'a.jpg', Format: 'jpg', ContentType: 'image/jpeg', IsExplicit: true },
  { Id: 20, UserId: 1, Title: 'Tagged family photo', FilePath: 'b.jpg', Format: 'jpg', ContentType: 'image/jpeg', IsExplicit: false },
];
const dualFamilyRow = {
  Id: 30, UserId: 1, Title: 'Shared family photo', FilePath: 'c.jpg', Format: 'jpg', ContentType: 'image/jpeg',
  IsExplicit: true, IsInferred: true,
};

describe('OwnerMediaCard', () => {
  it('loads the shared owner gallery and only exposes unlink for explicit rows', async () => {
    listGalleryForOwner.mockResolvedValue(rows);
    render(<OwnerMediaCard ownerTable="Families" ownerId={4} treeId={1} canEdit canDelete />);
    await waitFor(() => expect(listGalleryForOwner).toHaveBeenCalledWith('Families', 4, 1, undefined));
    expect(screen.getByTestId('shared-gallery')).toBeInTheDocument();
    const props = gallery.props!;
    const renderAction = props.renderAction as (row: typeof rows[number]) => React.ReactNode;
    expect(renderAction(rows[0])).toBeTruthy();
    expect(renderAction(rows[1])).toBeNull();
    const lightbox = props.lightbox as { canRemoveItem?: (row: typeof rows[number]) => boolean; showDeleteAction?: (row: typeof rows[number]) => boolean; onRemoveFromContext?: unknown; removeActionLabel?: string };
    expect(lightbox.canRemoveItem?.(rows[0])).toBe(true);
    expect(lightbox.canRemoveItem?.(rows[1])).toBe(false);
    expect(lightbox.showDeleteAction?.(rows[0])).toBe(true);
    expect(lightbox.showDeleteAction?.(rows[1])).toBe(false);
    expect(lightbox.onRemoveFromContext).toBeTypeOf('function');
    expect(lightbox.removeActionLabel).toBe('Remove from this record');
  });

  it('does not provide destructive actions for inferred rows or when the writer cannot edit', async () => {
    listGalleryForOwner.mockResolvedValue(rows);
    const { rerender } = render(<OwnerMediaCard ownerTable="Sources" ownerId={4} treeId={1} canEdit={false} canDelete={false} />);
    await waitFor(() => expect(listGalleryForOwner).toHaveBeenCalledWith('Sources', 4, 1, undefined));
    const props = gallery.props!;
    const lightbox = props.lightbox as { canRemoveItem?: (row: typeof rows[number]) => boolean; showDeleteAction?: (row: typeof rows[number]) => boolean; onRemoveFromContext?: unknown };
    expect((props.renderAction as (row: typeof rows[number]) => React.ReactNode)(rows[0])).toBeNull();
    expect(lightbox.canRemoveItem?.(rows[0])).toBe(false);
    expect(lightbox.showDeleteAction?.(rows[0])).toBe(false);
    expect(lightbox.onRemoveFromContext).toBeUndefined();
    rerender(<OwnerMediaCard ownerTable="Events" ownerId={4} treeId={1} canEdit canDelete />);
    expect(gallery.props).toBeTruthy();
  });

  it('unlinks without calling the hard-delete API', async () => {
    listGalleryForOwner.mockResolvedValue(rows);
    render(<OwnerMediaCard ownerTable="Events" ownerId={4} treeId={1} canEdit canDelete />);
    await waitFor(() => expect(gallery.props).toBeTruthy());
    await (gallery.props!.lightbox as { onRemoveFromContext: (id: number) => Promise<void> }).onRemoveFromContext(10);
    expect(unlinkFromOwner).toHaveBeenCalledWith(10, 'Events', 4, 1, undefined);
  });

  it('keeps a dual family link as inferred after unlinking its explicit link', async () => {
    listGalleryForOwner.mockResolvedValue([dualFamilyRow]);
    render(<OwnerMediaCard ownerTable="Families" ownerId={4} treeId={1} canEdit canDelete />);
    await waitFor(() => expect(gallery.props?.items).toEqual([dualFamilyRow]));

    await (gallery.props!.lightbox as { onRemoveFromContext: (id: number) => Promise<void> }).onRemoveFromContext(30);

    await waitFor(() => expect(gallery.props?.items).toEqual([{
      ...dualFamilyRow,
      IsExplicit: false,
      IsInferred: true,
    }]));
    expect((gallery.props!.lightbox as { canRemoveItem?: (row: typeof dualFamilyRow) => boolean }).canRemoveItem?.({
      ...dualFamilyRow,
      IsExplicit: false,
      IsInferred: true,
    })).toBe(false);
  });

  it('is a fact panel when given a fact: it lists and removes only that fact\'s links (ADR 0030)', async () => {
    listGalleryForOwner.mockResolvedValue([rows[0]]);
    render(<OwnerMediaCard ownerTable="People" ownerId={4} ownerFact="Birth" treeId={1} canEdit canDelete />);
    await waitFor(() => expect(listGalleryForOwner).toHaveBeenCalledWith('People', 4, 1, 'Birth'));
    expect(gallery.props!.renderBadge).toBeUndefined();
    await (gallery.props!.lightbox as { onRemoveFromContext: (id: number) => Promise<void> }).onRemoveFromContext(10);
    expect(unlinkFromOwner).toHaveBeenCalledWith(10, 'People', 4, 1, 'Birth');
  });

  it('labels a fact link in the owner list and keeps it after the record link goes', async () => {
    const both = { ...rows[0], IsExplicit: true, OwnerFacts: ['Birth'] };
    listGalleryForOwner.mockResolvedValue([both]);
    render(<OwnerMediaCard ownerTable="People" ownerId={4} treeId={1} canEdit canDelete />);
    await waitFor(() => expect(gallery.props?.items).toEqual([both]));
    const badge = (gallery.props!.renderBadge as (row: typeof both) => React.ReactElement<{ children: string }>)(both);
    expect(badge.props.children).toBe('Birth');
    expect((gallery.props!.getAlt as (row: typeof both) => string)(both)).toBe('Explicit family photo, Birth');

    await (gallery.props!.lightbox as { onRemoveFromContext: (id: number) => Promise<void> }).onRemoveFromContext(10);
    await waitFor(() => expect(gallery.props?.items).toEqual([{ ...both, IsExplicit: false }]));
  });
});
