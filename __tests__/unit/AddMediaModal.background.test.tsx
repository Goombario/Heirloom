/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

const { createUploadPreviewMock } = vi.hoisted(() => ({ createUploadPreviewMock: vi.fn() }));

vi.mock('next-intl', () => {
  const t = (key: string, values?: Record<string, unknown>) => {
    if (values && 'count' in values) return `${key}:${values.count as number}`;
    if (values && 'name' in values) return `${key}:${values.name as string}`;
    return key;
  };
  // Component uses t.rich for the {browse}-link hints and the To line; mock returns the key.
  (t as unknown as { rich: (key: string) => string }).rich = (key: string) => key;
  return { useLocale: () => 'en', useTranslations: () => t };
});

const uploadMock = vi.fn().mockResolvedValue({ Id: 1 });
const findDuplicatesMock = vi.fn().mockResolvedValue([]);
const linkToOwnerMock = vi.fn().mockResolvedValue(undefined);
const listMock = vi.fn().mockResolvedValue({ media: [], count: 0 });
const listForOwnerMock = vi.fn().mockResolvedValue([]);
// The local build: photos are processed on this device, so a desktop batch runs in the background (#62).
vi.mock('@/lib/data/mode', () => ({ DATA_MODE: 'local' }));
vi.mock('@/lib/data', () => {
  const client = () => ({
    media: { upload: uploadMock, findDuplicates: findDuplicatesMock, linkToOwner: linkToOwnerMock, list: listMock, listForOwner: listForOwnerMock },
  });
  return {
    getDataClient: () => Promise.resolve(client()),
    withWriteBatch: (run: (c: ReturnType<typeof client>) => Promise<unknown>) => run(client()),
  };
});

// happy-dom has no crypto.subtle, and the real digest is covered by
// content-hash.test.ts. Map each file to a deterministic hash of its own text so
// two Files with identical bytes collide exactly as they would in production.
vi.mock('@/lib/media/content-hash', () => ({
  hashBytes: async (bytes: Uint8Array | ArrayBuffer) => {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return `hash-${new TextDecoder().decode(view)}`;
  },
  CONTENT_HASH_PATTERN: /^[a-f0-9]{64}$/,
}));

vi.mock('@/lib/media/upload-preview', () => ({
  createUploadPreview: createUploadPreviewMock,
}));

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

beforeEach(() => {
  resetBackgroundMedia();
  uploadMock.mockClear();
  uploadMock.mockResolvedValue({ Id: 1 });
  findDuplicatesMock.mockClear();
  findDuplicatesMock.mockResolvedValue([]);
  pushMock.mockClear();
  linkToOwnerMock.mockClear();
  listMock.mockClear();
  listForOwnerMock.mockResolvedValue([]);
  createUploadPreviewMock.mockReset();
  createUploadPreviewMock.mockResolvedValue(null);
  let created = 0;
  globalThis.URL.createObjectURL = vi.fn(() => `blob:preview-${created++}`);
  globalThis.URL.revokeObjectURL = vi.fn();
});

import AddMediaModal, { type AddMediaTarget } from '@/app/components/media/AddMediaModal';
import { StorageLimitError } from '@/lib/data/errors';
import { BackgroundMediaStatus } from '@/app/components/media/BackgroundMediaStatus';
import { resetBackgroundMedia } from '@/app/components/media/backgroundMedia';

/** A File whose bytes are its own marker text, so hashes are predictable. */
function photo(marker: string, name = `${marker}.jpg`) {
  return new File([marker], name, { type: 'image/jpeg' });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function selectFiles(files: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

/** Waits for the scan to settle by watching the primary action's count. */
function uploadButton(count: number) {
  return screen.getByRole('button', { name: `add_n:${count}` });
}

const PERSON: AddMediaTarget = { kind: 'owner', ownerTable: 'People', ownerId: 42 };

/** Add media from a person's gallery unless told otherwise; the library is empty. */
function UploadModal({ target = PERSON, onUploaded, ...rest }: Partial<React.ComponentProps<typeof AddMediaModal>> & { onUploaded?: () => void }) {
  return <AddMediaModal target={target} treeId={null} onClose={vi.fn()} onAdded={onUploaded ?? vi.fn()} {...rest} />;
}


describe('AddMediaModal: adding in the background on a desktop, local build (#62)', () => {
  it('closes at once and keeps adding, showing progress outside the dialog', async () => {
    const second = deferred<{ Id: number }>();
    uploadMock.mockResolvedValueOnce({ Id: 1 }).mockReturnValueOnce(second.promise);
    const onAdded = vi.fn();
    const onMediaChanged = vi.fn();
    render(<><UploadModal onUploaded={onAdded} onMediaChanged={onMediaChanged} /><BackgroundMediaStatus /></>);
    selectFiles([photo('alpha'), photo('beta')]);
    await waitFor(() => expect(uploadButton(2)).toBeInTheDocument());

    fireEvent.click(uploadButton(2));
    expect(onAdded).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByText('background_adding')).toBeInTheDocument());
    // The gallery refreshes as the first photo lands, before the batch is done.
    await waitFor(() => expect(onMediaChanged).toHaveBeenCalled());

    second.resolve({ Id: 2 });
    await waitFor(() => expect(screen.getByText('background_added:2')).toBeInTheDocument());
    expect(uploadMock).toHaveBeenCalledTimes(2);
  });

  it('reports a batch that stops partway, with what it added', async () => {
    uploadMock.mockResolvedValueOnce({ Id: 1 }).mockRejectedValueOnce(new StorageLimitError('full'));
    render(<><UploadModal /><BackgroundMediaStatus /></>);
    selectFiles([photo('alpha'), photo('beta')]);
    await waitFor(() => expect(uploadButton(2)).toBeInTheDocument());

    fireEvent.click(uploadButton(2));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('background_stopped'));
    fireEvent.click(screen.getByRole('button', { name: 'background_dismiss' }));
    expect(screen.queryByText('background_stopped')).toBeNull();
  });
});
