/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { DataClient } from '@/lib/data';

// The crop screen as the phone photo viewer uses it to tag a face (phone review of
// #1117): the same circle as the portrait, saved as the face tag alone.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${Object.values(values).join(',')})` : key,
}));
vi.mock('@/lib/media/useMediaUrl', () => ({ useMediaUrl: () => ({ src: '/photo.jpg' }) }));
vi.mock('@/app/components/ui/Sheet', () => ({
  Sheet: ({ open, title, saveLabel, onSave, saveDisabled, children }: {
    open: boolean; title: string; saveLabel: string; onSave: () => void; saveDisabled: boolean; children: React.ReactNode;
  }) => open ? <div><h2>{title}</h2><button type="button" disabled={saveDisabled} onClick={onSave}>{saveLabel}</button>{children}</div> : null,
}));
vi.mock('@/lib/data', () => ({ getDataClient: vi.fn() }));

import { CropScreen } from '@/app/people/view/mobile/PortraitSheets';

const realDecode = HTMLImageElement.prototype.decode;
const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
beforeEach(() => {
  HTMLImageElement.prototype.decode = () => Promise.resolve();
  // happy-dom has no layout: the stage reads a phone's width when it mounts.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 390 });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => {
  HTMLImageElement.prototype.decode = realDecode;
  if (realWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', realWidth);
  vi.unstubAllGlobals();
});

async function renderCrop(purpose: 'portrait' | 'tag', existing: { Id: number; PersonId: number }[]) {
  const data = await import('@/lib/data');
  const client = { media: {
    listTags: vi.fn().mockResolvedValue(existing),
    createTag: vi.fn().mockResolvedValue({ auditIds: [1] }),
    updateTag: vi.fn().mockResolvedValue({ auditIds: [2] }),
    setPrimary: vi.fn().mockResolvedValue({ auditIds: [3] }),
  } };
  vi.mocked(data.getDataClient).mockResolvedValue(client as unknown as DataClient);
  const run = vi.fn(async (fn: () => Promise<unknown>) => { await fn(); return true; });
  const onDone = vi.fn();
  render(<CropScreen open purpose={purpose} target={{ media: { Id: 10, FocalX: 50, FocalY: 50 } }}
    person={{ Id: 42, FirstName: 'Ada Lovelace', LastName: 'Byron' }} treeId={1} run={run} onBack={vi.fn()} onDone={onDone} />);
  return { client, run, onDone };
}

/** The photo "loads": a 3000×2000 image, decoded. */
async function loadPhoto() {
  const img = await waitFor(() => { const el = document.querySelector('img'); if (!el) throw new Error('no img'); return el; });
  Object.defineProperty(img, 'naturalWidth', { value: 3000, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: 2000, configurable: true });
  fireEvent.load(img);
}

describe('CropScreen for a face tag', () => {
  it('names the face by first name and tags it without touching the portrait', async () => {
    const { client, onDone } = await renderCrop('tag', []);
    expect(screen.getByRole('heading', { name: 'tag_face_title(Ada)' })).toBeInTheDocument();
    // Only the round preview: the page photo isn't this person's portrait.
    expect(screen.queryByText('preview_page')).not.toBeInTheDocument();
    await loadPhoto();
    fireEvent.click(await screen.findByRole('button', { name: 'tag_save' }));
    await waitFor(() => expect(client.media.createTag).toHaveBeenCalledWith(10, expect.objectContaining({ PersonId: 42 }), 1));
    expect(client.media.setPrimary).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it('moves the face tag the person already has', async () => {
    const { client } = await renderCrop('tag', [{ Id: 5, PersonId: 42 }]);
    await loadPhoto();
    fireEvent.click(await screen.findByRole('button', { name: 'tag_save' }));
    await waitFor(() => expect(client.media.updateTag).toHaveBeenCalledWith(10, 5, expect.objectContaining({ RegionW: expect.any(Number) }), 1));
    expect(client.media.createTag).not.toHaveBeenCalled();
    expect(client.media.setPrimary).not.toHaveBeenCalled();
  });

  it('still makes the photo the portrait when used for one', async () => {
    const { client } = await renderCrop('portrait', []);
    await loadPhoto();
    fireEvent.click(await screen.findByRole('button', { name: 'use' }));
    await waitFor(() => expect(client.media.setPrimary).toHaveBeenCalledWith(10, 42, 1));
  });
});
