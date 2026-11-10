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
import { AppToaster } from '@/app/components/ui/Toast';
import { RateLimitError, StorageLimitError } from '@/lib/data/errors';

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

function tileImage() {
  return document.querySelector('img') as HTMLImageElement;
}

describe('AddMediaModal: new files', () => {
  it('uses lazy asynchronous decoding for every tile image', async () => {
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 42 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha')]);

    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    const image = tileImage();
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('decoding', 'async');
  });

  it('hashes and previews the same original bytes read once per row', async () => {
    const file = photo('original-bytes');
    const arrayBuffer = vi.spyOn(file, 'arrayBuffer');
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 42 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([file]);

    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(createUploadPreviewMock).toHaveBeenCalledWith(new Uint8Array(
      Array.from(new TextEncoder().encode('original-bytes')),
    ), 'image/jpeg');
  });

  it('does not reread a row when another add batch arrives during its scan', async () => {
    const first = photo('first');
    const second = photo('second');
    const firstRead = deferred<ArrayBuffer>();
    const firstArrayBuffer = vi.spyOn(first, 'arrayBuffer').mockReturnValue(firstRead.promise);
    const secondArrayBuffer = vi.spyOn(second, 'arrayBuffer');
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 42 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);

    selectFiles([first]);
    selectFiles([second]);
    expect(secondArrayBuffer).not.toHaveBeenCalled();
    firstRead.resolve(new TextEncoder().encode('first').buffer);
    await waitFor(() => expect(firstArrayBuffer).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(secondArrayBuffer).toHaveBeenCalledTimes(1));
  });

  it('swaps one row to a derived preview and revokes its original exactly once', async () => {
    const derived = new Blob(['thumb'], { type: 'image/jpeg' });
    createUploadPreviewMock.mockResolvedValue(derived);
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 42 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha')]);

    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    const image = tileImage();
    await waitFor(() => expect(image).toHaveAttribute('src', 'blob:preview-1'));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-0');
  });

  it('keeps the original preview when bounded preview creation fails', async () => {
    createUploadPreviewMock.mockRejectedValue(new Error('decode failed'));
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 42 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha')]);

    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    expect(tileImage()).toHaveAttribute('src', 'blob:preview-0');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('revokes an in-flight derived URL when the modal unmounts', async () => {
    const preview = deferred<Blob | null>();
    createUploadPreviewMock.mockReturnValue(preview.promise);
    const view = render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 42 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha')]);
    await waitFor(() => expect(createUploadPreviewMock).toHaveBeenCalled());

    view.unmount();
    preview.resolve(new Blob(['thumb'], { type: 'image/jpeg' }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-0');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('revokes the derived preview when the modal closes, and exactly once overall', async () => {
    createUploadPreviewMock.mockResolvedValue(new Blob(['thumb'], { type: 'image/jpeg' }));
    const file = photo('alpha');
    const onUploaded = vi.fn();
    const view = render(<UploadModal treeId={null} onClose={vi.fn()} onUploaded={onUploaded} />);
    selectFiles([file]);
    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    await waitFor(() => expect(tileImage()).toHaveAttribute('src', 'blob:preview-1'));

    fireEvent.click(uploadButton(1));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-0');

    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('renders a tile per selected file and uploads each with personId', async () => {
    const onUploaded = vi.fn();
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 42 }} treeId={null} onClose={vi.fn()} onUploaded={onUploaded} />);

    const f1 = photo('alpha');
    const f2 = photo('beta');
    selectFiles([f1, f2]);

    await waitFor(() => expect(uploadButton(2)).toBeInTheDocument());
    fireEvent.click(uploadButton(2));

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2));
    expect(uploadMock).toHaveBeenCalledWith(
      expect.objectContaining({ file: f1, personId: 42 }),
      null,
    );
    // No follow-up step: a finished batch closes straight away.
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('describe-photo')).not.toBeInTheDocument();
  });

  it('no longer sends a caption — Title falls back downstream', async () => {
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha')]);
    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    fireEvent.click(uploadButton(1));

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    expect(uploadMock.mock.calls[0][0]).not.toHaveProperty('title');
  });

  it('marks exactly one tile primary (person context) and sends isPrimary', async () => {
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 7 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha'), photo('beta')]);
    await waitFor(() => expect(uploadButton(2)).toBeInTheDocument());

    const setPrimaryButtons = screen.getAllByRole('button', { name: 'set_primary' });
    fireEvent.click(setPrimaryButtons[1]);

    fireEvent.click(uploadButton(2));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2));

    const calls = uploadMock.mock.calls.map(c => c[0]);
    expect(calls.filter(c => c.isPrimary)).toHaveLength(1);
    expect(calls.find(c => c.file.name === 'beta.jpg').isPrimary).toBe(true);
  });

  it('hides the primary control in case context', async () => {
    render(<UploadModal target={{ kind: 'case', caseId: 3, source: { key: 'case:3', loadCandidates: async () => [], attach: async () => undefined } }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha')]);
    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'set_primary' })).toBeNull();
  });

  // ---- #592: duplicate guard ------------------------------------------------

  it('swaps a photo the tree already holds for its library copy, still ticked', async () => {
    findDuplicatesMock.mockResolvedValue([
      { hash: 'hash-beta', mediaId: 7, title: 'Wedding portrait', reason: 'in-tree' },
    ]);
    const onUploaded = vi.fn();
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} onUploaded={onUploaded} />);
    selectFiles([photo('alpha'), photo('beta')]);

    await waitFor(() => expect(screen.getByText('swap_note_named')).toBeInTheDocument());
    expect(screen.getByText('status_picked_new:2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'tile_in_library:beta.jpg' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(uploadButton(2));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock.mock.calls[0][0].file.name).toBe('alpha.jpg');
    expect(linkToOwnerMock).toHaveBeenCalledWith(7, 'People', 1, null, undefined);
  });

  it('shows a duplicate of something already attached here as unpickable', async () => {
    findDuplicatesMock.mockResolvedValue([{ hash: 'hash-beta', mediaId: 7, title: null, reason: 'in-tree' }]);
    listForOwnerMock.mockResolvedValue([{ Id: 7 }]);
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} />);
    selectFiles([photo('alpha'), photo('beta')]);

    await waitFor(() => expect(screen.getByRole('button', { name: 'tile_already_here:beta.jpg' })).toBeDisabled());
    expect(uploadButton(1)).toBeInTheDocument();
  });

  it('on the Library page, leaves a photo the tree already holds unticked', async () => {
    findDuplicatesMock.mockResolvedValue([{ hash: 'hash-beta', mediaId: 7, title: null, reason: 'in-tree' }]);
    render(<UploadModal target={{ kind: 'library' }} treeId={null} />);
    selectFiles([photo('alpha'), photo('beta')]);

    await waitFor(() => expect(screen.getByText('library_dup_note:1')).toBeInTheDocument());
    expect(uploadButton(1)).toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('uploads only the ticked tiles', async () => {
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} />);
    selectFiles([photo('alpha'), photo('beta')]);
    await waitFor(() => expect(uploadButton(2)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'tile_new:beta.jpg' }));
    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    fireEvent.click(uploadButton(1));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    expect(uploadMock.mock.calls[0][0].file.name).toBe('alpha.jpg');
  });

  it('Clear unticks everything and empties the footer', async () => {
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} />);
    expect(screen.queryByRole('button', { name: 'clear' })).toBeNull();
    selectFiles([photo('alpha')]);
    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    await waitFor(() => expect(uploadButton(0)).toBeDisabled());
    expect(screen.queryByRole('button', { name: 'clear' })).toBeNull();
  });

  it('flags the same file picked twice within one batch', async () => {
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    // Identical bytes, different filenames — exactly the "dragged it twice" case.
    selectFiles([photo('alpha', 'alpha.jpg'), photo('alpha', 'alpha (1).jpg')]);

    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'tile_picked_twice:alpha (1).jpg' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('asks the server about each distinct hash only once', async () => {
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha', 'a.jpg'), photo('alpha', 'b.jpg'), photo('beta')]);

    await waitFor(() => expect(findDuplicatesMock).toHaveBeenCalled());
    expect(findDuplicatesMock.mock.calls[0][0]).toEqual(['hash-alpha', 'hash-beta']);
  });

  it('re-includes a file picked twice when its tile is tapped', async () => {
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} />);
    selectFiles([photo('alpha', 'alpha.jpg'), photo('alpha', 'alpha (1).jpg')]);
    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'tile_picked_twice:alpha (1).jpg' }));
    await waitFor(() => expect(uploadButton(2)).toBeInTheDocument());
  });

  it('keeps every photo selected when the duplicate check fails', async () => {
    findDuplicatesMock.mockRejectedValue(new Error('offline'));
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha'), photo('beta')]);

    await waitFor(() => expect(uploadButton(2)).toBeInTheDocument());
    expect(screen.queryByText(/swap_note/)).toBeNull();
  });

  it('shows no duplicate summary when nothing matches', async () => {
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha')]);
    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    expect(screen.queryByText(/swap_note/)).toBeNull();
  });

  // ---- #593: partial-failure surface ---------------------------------------

  it('flags a batch interrupted partway and retries only what is left', async () => {
    uploadMock
      .mockResolvedValueOnce({ Id: 1 })
      .mockRejectedValueOnce(new Error('boom'));
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha'), photo('beta')]);
    await waitFor(() => expect(uploadButton(2)).toBeInTheDocument());
    fireEvent.click(uploadButton(2));

    await waitFor(() => expect(screen.getByText('batch_stopped')).toBeInTheDocument());
    expect(screen.getByText('batch_partial')).toBeInTheDocument();
    // The photo that went up keeps its green tick; only the other is still picked.
    expect(uploadButton(1)).toBeInTheDocument();
    fireEvent.click(uploadButton(1));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(3));
    expect(uploadMock.mock.calls[2][0].file.name).toBe('beta.jpg');
  });

  it('refreshes media state after a partial batch persisted a photo', async () => {
    const onMediaChanged = vi.fn();
    uploadMock
      .mockResolvedValueOnce({ Id: 1 })
      .mockRejectedValueOnce(new Error('boom'));
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} onMediaChanged={onMediaChanged} />);
    selectFiles([photo('alpha'), photo('beta')]);
    await waitFor(() => expect(uploadButton(2)).toBeInTheDocument());
    fireEvent.click(uploadButton(2));

    await waitFor(() => expect(onMediaChanged).toHaveBeenCalledOnce());
  });

  it('uses the rate-limit wording instead of the raw error on a 429', async () => {
    uploadMock.mockRejectedValueOnce(new RateLimitError('Too many upload requests. Please try again later.'));
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha')]);
    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    fireEvent.click(uploadButton(1));

    await waitFor(() => expect(screen.getByText('batch_rate_limited')).toBeInTheDocument());
    expect(screen.queryByText(/Too many upload requests/)).toBeNull();
  });

  it('uses the translated storage-full wording instead of the raw quota error', async () => {
    uploadMock.mockRejectedValueOnce(new StorageLimitError('raw quota details'));
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha')]);
    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    fireEvent.click(uploadButton(1));

    await waitFor(() => expect(screen.getByText('error_storage_full')).toBeInTheDocument());
    expect(screen.queryByText('raw quota details')).toBeNull();
  });

  it('uses authoritative structured quota details when the hosted upload returns them', async () => {
    uploadMock.mockRejectedValueOnce(new StorageLimitError('raw quota details', {
      usedBytes: 90 * 1024 * 1024,
      limitBytes: 100 * 1024 * 1024,
      remainingBytes: 10 * 1024 * 1024,
    }));
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha')]);
    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    fireEvent.click(uploadButton(1));

    await waitFor(() => expect(screen.getByText('storage_limit_details')).toBeInTheDocument());
    expect(screen.queryByText('raw quota details')).toBeNull();
  });

  it('warns before upload when the hosted tree is near its quota', () => {
    render(<UploadModal
      target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }}
      treeId={null}
      storageSummary={{
        usedBytes: 82 * 1024 * 1024,
        limitBytes: 100 * 1024 * 1024,
        remainingBytes: 18 * 1024 * 1024,
        percentUsed: 82,
        quotaMode: 'tree',
      }}
      onClose={vi.fn()}
      onUploaded={vi.fn()}
    />);

    expect(screen.getByText('storage_near_limit')).toBeInTheDocument();
  });

  it('uses generic translated wording instead of exposing local database details', async () => {
    const rawDetails = 'duplicate key value violates unique constraint "MediaBlob_pkey"';
    uploadMock.mockRejectedValueOnce(new Error(rawDetails));
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha')]);
    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    fireEvent.click(uploadButton(1));

    await waitFor(() => expect(screen.getByText('error_generic')).toBeInTheDocument());
    expect(screen.queryByText(rawDetails)).toBeNull();
  });

  it('keeps the upload fallback for non-Error failures', async () => {
    uploadMock.mockRejectedValueOnce('offline sentinel');
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha')]);
    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    fireEvent.click(uploadButton(1));

    await waitFor(() => expect(screen.getByText('upload_failed')).toBeInTheDocument());
  });

  it('clears a stale batch banner when more files are added', async () => {
    uploadMock.mockRejectedValueOnce(new Error('boom'));
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha')]);
    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    fireEvent.click(uploadButton(1));
    await waitFor(() => expect(screen.getByText('batch_stopped')).toBeInTheDocument());

    selectFiles([photo('beta')]);
    await waitFor(() => expect(screen.queryByText('batch_stopped')).toBeNull());
  });

  // ---- general -------------------------------------------------------------

  it('renders the drop strip before anything is added', () => {
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} onClose={vi.fn()} onUploaded={vi.fn()} />);
    expect(screen.getByText('drop_title')).toBeInTheDocument();
    expect(screen.getByText('drop_to_person')).toBeInTheDocument();
  });

  it('appends more tiles when more files are added', async () => {
    render(<UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} />);
    selectFiles([photo('alpha')]);
    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    selectFiles([photo('beta')]);
    await waitFor(() => expect(uploadButton(2)).toBeInTheDocument());
  });

  it('sums FacesFound across a batch into a single toast linking to the Faces review page', async () => {
    uploadMock
      .mockResolvedValueOnce({ Id: 1, FacesFound: 2 })
      .mockResolvedValueOnce({ Id: 2, FacesFound: 1 });
    render(<><AppToaster /><UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} onClose={vi.fn()} onUploaded={vi.fn()} /></>);
    selectFiles([photo('alpha'), photo('beta')]);
    await waitFor(() => expect(uploadButton(2)).toBeInTheDocument());
    fireEvent.click(uploadButton(2));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2));

    const toast = await screen.findByText('faces_found:3');
    fireEvent.click(screen.getByRole('button', { name: 'faces_review' }));
    expect(pushMock).toHaveBeenCalledWith('/library?tab=faces');
    expect(toast).toBeInTheDocument();
  });

  it('shows no toast when no upload in the batch carried face data', async () => {
    const upload = deferred<{ Id: number; FacesFound: number }>();
    uploadMock.mockImplementationOnce(() => upload.promise);
    // AppToaster MUST be mounted here — sonner's toast.success() only reaches the
    // DOM through a live <Toaster>, so without one this assertion would pass
    // whether or not the component ever called showSuccessToast.
    const onUploaded = vi.fn();
    render(<><AppToaster /><UploadModal target={{ kind: 'owner', ownerTable: 'People', ownerId: 1 }} treeId={null} onClose={vi.fn()} onUploaded={onUploaded} /></>);
    selectFiles([photo('alpha')]);
    await waitFor(() => expect(uploadButton(1)).toBeInTheDocument());
    fireEvent.click(uploadButton(1));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    // Keep the upload unresolved while checking that completion is the only
    // event that can produce a Faces toast.
    expect(screen.queryByText(/faces_found/)).toBeNull();
    upload.resolve({ Id: 1, FacesFound: 0 });
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));

    expect(screen.queryByText(/faces_found/)).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
