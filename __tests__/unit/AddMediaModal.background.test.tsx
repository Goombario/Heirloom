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
// Every build: a desktop batch runs in the background queue (#62, #207).
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
import BackgroundJobsChip from '@/app/components/media/BackgroundJobsChip';
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


describe('AddMediaModal: adding in the background on a desktop (#62, #207)', () => {
  it('closes at once and keeps adding, showing progress outside the dialog', async () => {
    const second = deferred<{ Id: number }>();
    uploadMock.mockResolvedValueOnce({ Id: 1 }).mockReturnValueOnce(second.promise);
    const onAdded = vi.fn();
    const onMediaChanged = vi.fn();
    render(<><UploadModal onUploaded={onAdded} onMediaChanged={onMediaChanged} /><BackgroundJobsChip /></>);
    selectFiles([photo('alpha'), photo('beta')]);
    await waitFor(() => expect(uploadButton(2)).toBeInTheDocument());

    fireEvent.click(uploadButton(2));
    expect(onAdded).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByText('chip_running')).toBeInTheDocument());
    // The gallery refreshes as the first photo lands, before the batch is done.
    await waitFor(() => expect(onMediaChanged).toHaveBeenCalled());

    second.resolve({ Id: 2 });
    await waitFor(() => expect(screen.getByText('chip_done:2')).toBeInTheDocument());
    expect(uploadMock).toHaveBeenCalledTimes(2);
  });

  it('reports a batch that stops partway, with what it added', async () => {
    uploadMock.mockResolvedValueOnce({ Id: 1 }).mockRejectedValueOnce(new StorageLimitError('full'));
    render(<><UploadModal /><BackgroundJobsChip /></>);
    selectFiles([photo('alpha'), photo('beta')]);
    await waitFor(() => expect(uploadButton(2)).toBeInTheDocument());

    fireEvent.click(uploadButton(2));
    await waitFor(() => expect(screen.getByText('chip_stopped')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'chip_aria_stopped' }));
    // The row says why in plain words and which photo wasn't added (#236). Storage
    // is full, so Retry is offered but greyed out, after "See what uses space".
    const row = screen.getAllByRole('listitem')[0];
    expect(row).toHaveTextContent('why_storage');
    expect(row).toHaveTextContent('not_added:1');
    expect(row).toHaveTextContent('beta.jpg');
    expect(screen.getByRole('link', { name: 'see_space' })).toHaveAttribute('href', '/library');
    expect(screen.getByRole('button', { name: 'retry_rest:1' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }));
    expect(screen.queryByText('chip_stopped')).toBeNull();
  });

  it('waits out the hosted upload limit and carries on, without an error', async () => {
    const { RateLimitError } = await import('@/lib/data/errors');
    uploadMock.mockRejectedValueOnce(new RateLimitError('busy', 0.05)).mockResolvedValue({ Id: 1 });
    render(<><UploadModal /><BackgroundJobsChip /></>);
    selectFiles([photo('alpha')]);
    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());

    fireEvent.click(uploadButton(1));
    await waitFor(() => expect(screen.getByText('chip_waiting')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('chip_done:1')).toBeInTheDocument());
    expect(uploadMock).toHaveBeenCalledTimes(2);
  });

  it('stops on an expired sign-in with a Sign in link, without redirecting', async () => {
    const { UnauthorizedError } = await import('@/lib/data/errors');
    uploadMock.mockRejectedValueOnce(new UnauthorizedError());
    render(<><UploadModal /><BackgroundJobsChip /></>);
    selectFiles([photo('alpha'), photo('beta')]);
    await waitFor(() => expect(uploadButton(2)).toBeInTheDocument());

    fireEvent.click(uploadButton(2));
    await waitFor(() => expect(screen.getByText('chip_stopped')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'chip_aria_stopped' }));
    expect(screen.getByRole('link', { name: 'sign_in' })).toHaveAttribute('href', '/api/auth/signin');
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('why_sign_in');
    expect(screen.getByRole('button', { name: 'retry_rest:2' })).toBeEnabled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // #236: Retry queues what the stopped job hadn't done, skipping what made it.
  it('retries only the photos that were not added', async () => {
    uploadMock.mockResolvedValueOnce({ Id: 1 }).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({ Id: 3 });
    render(<><UploadModal /><BackgroundJobsChip /></>);
    selectFiles([photo('alpha'), photo('beta'), photo('gamma')]);
    await waitFor(() => expect(uploadButton(3)).toBeInTheDocument());

    fireEvent.click(uploadButton(3));
    await waitFor(() => expect(screen.getByText('chip_stopped')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'chip_aria_stopped' }));
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('why_network');
    expect(uploadMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'retry_rest:2' }));
    await waitFor(() => expect(screen.getByText('chip_done:2')).toBeInTheDocument());
    expect(uploadMock).toHaveBeenCalledTimes(4);
  });
});
