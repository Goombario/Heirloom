/** @vitest-environment happy-dom */

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

const picker = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
const listGalleryForOwner = vi.hoisted(() => vi.fn());
const redirectIfUnauthorized = vi.hoisted(() => vi.fn().mockReturnValue(false));

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));
vi.mock('@/lib/data', () => ({
  getDataClient: async () => ({ media: { listGalleryForOwner } }),
}));
vi.mock('@/app/components/media/MediaGallery', () => ({
  default: ({ items }: { items: Array<{ Id: number }> }) => (
    <div data-testid="media-items">{items.map((item) => item.Id).join(',')}</div>
  ),
}));
vi.mock('@/app/components/media/AddMediaModal', () => ({
  default: (props: Record<string, unknown>) => {
    picker.props = props;
    return null;
  },
}));
vi.mock('@/app/components/useErrorToast', () => ({ useErrorToast: () => ({ reportError: vi.fn(), redirectIfUnauthorized }) }));
vi.mock('@/lib/utils/data-error', () => ({
  handleDataError: () => false,
  errorToastKey: () => 'error_generic',
}));

import { OwnerMediaCard } from '@/app/components/media/OwnerMediaCard';

describe('OwnerMediaCard Add media relevance', () => {
  it('passes already-loaded relevant person IDs to Add media without refetching them', async () => {
    listGalleryForOwner.mockResolvedValue([]);
    render(
      <OwnerMediaCard
        ownerTable="Families"
        ownerId={4}
        treeId={1}
        canEdit
        canDelete
        relevantPersonIds={[11, 12, 12]}
      />,
    );

    await waitFor(() => expect(listGalleryForOwner).toHaveBeenCalledTimes(1));
    await act(async () => {
      screen.getByRole('button', { name: /ownerMedia\.add_button/ }).click();
    });
    await waitFor(() => expect(picker.props).toEqual(expect.objectContaining({ relevantPersonIds: [11, 12, 12], target: expect.objectContaining({ kind: 'owner', ownerTable: 'Families', ownerId: 4 }) })));
    expect(listGalleryForOwner).toHaveBeenCalledTimes(1);
  });

  it('shows a retryable translated error instead of an empty gallery on a failed read', async () => {
    listGalleryForOwner.mockRejectedValueOnce(new Error('private server text'));
    render(
      <OwnerMediaCard ownerTable="Families" ownerId={4} treeId={1} canEdit canDelete />,
    );

    expect(await screen.findByText('common.error_generic')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeInTheDocument();
    expect(screen.queryByText('ownerMedia.empty_edit')).not.toBeInTheDocument();

    listGalleryForOwner.mockResolvedValueOnce([]);
    await act(async () => { screen.getByRole('button', { name: 'common.retry' }).click(); });
    await waitFor(() => expect(screen.getByText('ownerMedia.empty_edit')).toBeInTheDocument());
    expect(screen.queryByText('private server text')).not.toBeInTheDocument();
  });

  it('does not show a previous owner\'s gallery when the next owner load fails', async () => {
    listGalleryForOwner
      .mockResolvedValueOnce([{ Id: 41 }])
      .mockRejectedValueOnce(new Error('new owner failed'));
    const { rerender } = render(
      <OwnerMediaCard ownerTable="Families" ownerId={4} treeId={1} canEdit canDelete />,
    );
    await waitFor(() => expect(screen.getByTestId('media-items')).toHaveTextContent('41'));

    rerender(<OwnerMediaCard ownerTable="Families" ownerId={5} treeId={1} canEdit canDelete />);
    expect(screen.queryByTestId('media-items')).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('common.error_generic');
    expect(screen.queryByTestId('media-items')).not.toBeInTheDocument();
  });
});
