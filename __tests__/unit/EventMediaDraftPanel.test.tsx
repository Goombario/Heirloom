/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key,
}));
vi.mock('@/lib/data', () => ({
  DATA_MODE: 'local',
  getDataClient: vi.fn().mockResolvedValue({ media: {} }),
}));
const stagedFile = vi.hoisted(() => new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));
vi.mock('@/app/components/media/AddMediaModal', () => ({
  default: ({ onStage, onClose }: { onStage?: (picks: { files: File[]; mediaIds: number[] }) => void; onClose: () => void }) => (
    <button type="button" onClick={() => { onStage?.({ files: [stagedFile], mediaIds: [7] }); onClose(); }}>pick_media</button>
  ),
}));

import EventMediaDraftPanel from '@/app/components/media/EventMediaDraftPanel';
import { useEventMediaDraft } from '@/app/components/media/useEventMediaDraft';

function Harness() {
  const draft = useEventMediaDraft({ treeId: 2 });
  return <EventMediaDraftPanel treeId={2} draft={draft} />;
}

describe('EventMediaDraftPanel', () => {
  it('stages a file and a library photo from Add media without linking or uploading', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'add_button' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick_media' }));

    await waitFor(() => expect(screen.getByText('file_label:{"name":"photo.jpg"}')).toBeInTheDocument());
    expect(screen.getByText('existing:{"id":7}')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'remove' })).toHaveLength(2);
  });

  it('removes one staged item and leaves the other intact', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'add_button' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick_media' }));
    await waitFor(() => expect(screen.getByText('file_label:{"name":"photo.jpg"}')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: 'remove' })[0]);
    expect(screen.queryByText('file_label:{"name":"photo.jpg"}')).toBeNull();
    expect(screen.getByText('existing:{"id":7}')).toBeInTheDocument();
  });

  it('offers one Add media button under a labelled heading', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'add_button' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'title' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'pick_media' })).toBeNull();
  });

  it('gives each mounted panel a unique labelled heading', () => {
    function TwoPanels() {
      const first = useEventMediaDraft({ treeId: 2 });
      const second = useEventMediaDraft({ treeId: 2 });
      return <><EventMediaDraftPanel treeId={2} draft={first} /><EventMediaDraftPanel treeId={2} draft={second} /></>;
    }

    render(<TwoPanels />);
    const regions = screen.getAllByRole('region');
    const ids = regions.map(region => region.getAttribute('aria-labelledby'));
    expect(new Set(ids).size).toBe(2);
    expect(ids.every(id => id && document.getElementById(id)?.tagName === 'H3')).toBe(true);
  });
});
