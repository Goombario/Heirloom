import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '@/lib/data/errors';

const mocks = vi.hoisted(() => ({
  resolveMediaUploadTargets: vi.fn(),
  createCanonicalMedia: vi.fn(),
  getMediaStorageUsed: vi.fn(),
  getMediaByUploadIntent: vi.fn(),
  getMediaImportItem: vi.fn(),
  lockMediaImportItem: vi.fn(),
  transitionMediaImportItem: vi.fn(),
  lockTreeForUpdate: vi.fn(),
  resolveTreeScope: vi.fn(),
  getClient: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  captureFacesForMedia: vi.fn(),
  primeThumbnailCache: vi.fn(),
}));

vi.mock('@/lib/services/media-upload-targets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/media-upload-targets')>()),
  resolveMediaUploadTargets: mocks.resolveMediaUploadTargets,
}));
vi.mock('@/lib/db/queries/media', () => ({
  getMediaStorageUsed: mocks.getMediaStorageUsed,
  getMediaByUploadIntent: mocks.getMediaByUploadIntent,
  patchMediaFile: vi.fn(),
  patchMediaTitle: vi.fn(),
  getMediaImportItem: mocks.getMediaImportItem,
  lockMediaImportItem: mocks.lockMediaImportItem,
  transitionMediaImportItem: mocks.transitionMediaImportItem,
}));
vi.mock('@/lib/services/media', () => ({
  createCanonicalMedia: mocks.createCanonicalMedia,
}));
vi.mock('@/lib/db/connection', () => ({ getClient: mocks.getClient }));
vi.mock('@/lib/db/queries/trees', () => ({
  resolveTreeScope: mocks.resolveTreeScope,
  lockTreeForUpdate: mocks.lockTreeForUpdate,
}));
vi.mock('@/lib/db/queries/media-import-items', () => ({
  getMediaImportItem: mocks.getMediaImportItem,
  lockMediaImportItem: mocks.lockMediaImportItem,
  transitionMediaImportItem: mocks.transitionMediaImportItem,
  findReusableImportMedia: async () => null,
  listStoredSizeReuseCandidates: async () => [],
  reuseMediaForImportItem: async () => undefined,
}));
vi.mock('@/lib/services/media-face-capture', () => ({ captureFacesForMedia: mocks.captureFacesForMedia }));
vi.mock('@/lib/media-thumbnail', () => ({ primeThumbnailCache: mocks.primeThumbnailCache }));
vi.mock('@/lib/data-dir', () => ({ getDataDir: () => 'C:\\scoped-data' }));
vi.mock('fs/promises', () => ({
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile,
  unlink: mocks.unlink,
}));

import { materializeImportMediaService, uploadMediaService, validateUploadFile } from '@/lib/services/media-upload';

const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];

describe('validateUploadFile', () => {
  it.each(allowedExtensions)('accepts the whitelisted %s extension', (extension) => {
    const file = new File(['image'], `photo${extension}`, { type: 'image/test' });

    expect(validateUploadFile(file)).toMatchObject({ file, ext: extension });
  });

  it('rejects an extension outside the whitelist', () => {
    const file = new File(['document'], 'document.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    expect(() => validateUploadFile(file)).toThrow('File type not allowed');
  });

  it.each(['application/pdf', ''])('accepts a PDF declared as "%s"', (type) => {
    const file = new File(['%PDF-1.7'], 'Register.PDF', { type });

    expect(validateUploadFile(file)).toMatchObject({ file, ext: '.pdf', kind: 'pdf' });
  });

  it('rejects a PDF name with an image type, and an image name with the PDF type', () => {
    expect(() => validateUploadFile(new File(['x'], 'a.pdf', { type: 'image/png' }))).toThrow('Only image and PDF files');
    expect(() => validateUploadFile(new File(['x'], 'a.png', { type: 'application/pdf' }))).toThrow('Only image and PDF files');
  });
});

describe('uploadMediaService mutation ordering', () => {
  const params = {
    title: null,
    isPrimary: false,
    personId: 11,
    caseId: null,
    ownerTable: null,
    ownerRecordId: null,
    requestedTreeId: 10,
    requestedOwnerId: null,
    currentUserId: 7,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveMediaUploadTargets.mockResolvedValue({
      scope: { treeId: 10, ownerId: 2, permission: 'edit' },
      personId: 11,
      caseId: null,
      owner: null,
    });
    mocks.getMediaStorageUsed.mockResolvedValue(0);
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.unlink.mockResolvedValue(undefined);
    mocks.captureFacesForMedia.mockResolvedValue({ captured: 0, caption: null });
    mocks.primeThumbnailCache.mockResolvedValue('created');
    mocks.resolveTreeScope.mockResolvedValue({ treeId: 10, ownerId: 2, permission: 'edit' });
    mocks.lockTreeForUpdate.mockResolvedValue(true);
  });

  it('does not decode bytes when target validation rejects', async () => {
    const rejection = new NotFoundError('Person not found in this tree');
    mocks.resolveMediaUploadTargets.mockRejectedValueOnce(rejection);
    const file = new File(['image'], 'portrait.jpg', { type: 'image/jpeg' });
    const arrayBuffer = vi.spyOn(file, 'arrayBuffer');

    await expect(uploadMediaService({ ...params, file })).rejects.toBe(rejection);

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(mocks.getMediaStorageUsed).not.toHaveBeenCalled();
    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.createCanonicalMedia).not.toHaveBeenCalled();
  });

  it('deletes only the exact newly written file when canonical persistence fails', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.getClient.mockResolvedValue({ query, release: vi.fn() });
    mocks.createCanonicalMedia.mockRejectedValueOnce(new Error('database write failed'));
    const file = new File(['<svg/>'], 'portrait.svg', { type: 'image/svg+xml' });

    await expect(uploadMediaService({ ...params, file })).rejects.toThrow('database write failed');

    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    const writtenPath = mocks.writeFile.mock.calls[0][0];
    expect(mocks.unlink).toHaveBeenCalledTimes(1);
    expect(mocks.unlink).toHaveBeenCalledWith(writtenPath);
  });

  it('reports the recoverable generated path when exact-path cleanup also fails', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const databaseError = new Error('database write failed');
    const cleanupError = new Error('unlink failed');
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getClient.mockResolvedValue({ query, release: vi.fn() });
    mocks.createCanonicalMedia.mockRejectedValueOnce(databaseError);
    mocks.unlink.mockRejectedValueOnce(cleanupError);
    const file = new File(['<svg/>'], 'family-name.svg', { type: 'image/svg+xml' });

    await expect(uploadMediaService({ ...params, file })).rejects.toBe(databaseError);

    const writtenPath = mocks.writeFile.mock.calls[0][0];
    expect(mocks.unlink).toHaveBeenCalledWith(writtenPath);
    expect(report).toHaveBeenCalledWith(
      'Generated media cleanup failed',
      { category: 'generated_media_cleanup_failed', context: 'interactive_upload' },
    );
    expect(report).not.toHaveBeenCalledWith(
      expect.stringContaining(String(writtenPath)),
      expect.objectContaining({ path: expect.anything(), error: cleanupError }),
    );
    expect(String(writtenPath)).not.toContain('family-name');
  });

  it('primes the hosted 256px cache only after a newly created media row is persisted', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const media = {
      Id: 42, UserId: 2, TreeId: 10, Title: 'portrait.svg', FilePath: '11_1.svg',
      ContentType: 'image/svg+xml', ContentHash: 'hash',
    };
    mocks.getClient.mockResolvedValue({ query, release: vi.fn() });
    mocks.createCanonicalMedia.mockResolvedValue(media);
    const file = new File(['<svg/>'], 'portrait.svg', { type: 'image/svg+xml' });

    await expect(uploadMediaService({ ...params, file })).resolves.toEqual(media);

    expect(mocks.lockTreeForUpdate).toHaveBeenCalledWith(10, expect.any(Object));
    expect(mocks.lockTreeForUpdate.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.getMediaStorageUsed.mock.invocationCallOrder[0]);
    expect(mocks.getMediaStorageUsed.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.createCanonicalMedia.mock.invocationCallOrder[0]);
    expect(mocks.primeThumbnailCache).toHaveBeenCalledWith(expect.objectContaining({
      original: expect.any(Buffer), userId: 2, size: 256, contentType: 'image/svg+xml',
    }));
  });

  it('does not prime when persistence reports an upload-intent replay', async () => {
    const bytes = Buffer.from('<svg/>');
    const { createHash } = await import('node:crypto');
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const existing = {
      Id: 42, UserId: 2, TreeId: 10, Title: 'portrait.svg', FilePath: 'existing.svg',
      ContentType: 'image/svg+xml', ContentHash: contentHash,
      UploadIntentTarget: '{"caseId":null,"owner":null,"personId":11}',
      UploadIntentId: 'intent',
    };
    mocks.getMediaByUploadIntent
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.getClient.mockResolvedValue({ query, release: vi.fn() });
    const file = new File([bytes], 'portrait.svg', { type: 'image/svg+xml' });

    await expect(uploadMediaService({ ...params, file, uploadIntentId: 'intent' })).resolves.toMatchObject({ Id: 42 });

    expect(mocks.primeThumbnailCache).not.toHaveBeenCalled();
  });

  it('logs a stable category and keeps the created media result when priming fails', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const media = {
      Id: 42, UserId: 2, TreeId: 10, Title: 'portrait.svg', FilePath: '11_1.svg',
      ContentType: 'image/svg+xml', ContentHash: 'hash',
    };
    mocks.getClient.mockResolvedValue({ query, release: vi.fn() });
    mocks.createCanonicalMedia.mockResolvedValue(media);
    mocks.primeThumbnailCache.mockRejectedValueOnce(new Error('synthetic prime failure'));
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const file = new File(['<svg/>'], 'portrait.svg', { type: 'image/svg+xml' });

    await expect(uploadMediaService({ ...params, file })).resolves.toEqual(media);
    expect(report).toHaveBeenCalledWith('Thumbnail priming failed', {
      category: 'thumbnail_prime_failed', context: 'interactive_upload',
    });
    report.mockRestore();
  });

  it('primes imported media only after COMMIT and connection release', async () => {
    const events: string[] = [];
    const query = vi.fn().mockImplementation(async (sql: string) => {
      events.push(`query:${sql}`);
      return { rows: [], rowCount: 0 };
    });
    const release = vi.fn(() => events.push('release'));
    const pending = {
      id: 9, status: 'pending', archivePath: 'media/source.jpg', mediaId: 42,
      skipFaceCapture: false,
    };
    const ready = { ...pending, status: 'ready' };
    mocks.getMediaImportItem.mockResolvedValueOnce(pending);
    mocks.lockMediaImportItem.mockResolvedValue(pending);
    mocks.transitionMediaImportItem.mockResolvedValue(ready);
    mocks.getClient.mockResolvedValue({ query, release });
    mocks.primeThumbnailCache.mockImplementationOnce(async () => {
      events.push('prime');
      return 'created';
    });
    const file = new File(['<svg/>'], 'source.svg', { type: 'image/svg+xml' });

    await expect(materializeImportMediaService({
      itemId: 9, archivePath: 'media/source.jpg', file,
      requestedTreeId: 10, requestedOwnerId: null, currentUserId: 7,
    })).resolves.toMatchObject({ outcome: 'ready' });

    expect(events.indexOf('query:COMMIT')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('release')).toBeGreaterThan(events.indexOf('query:COMMIT'));
    expect(events.indexOf('prime')).toBeGreaterThan(events.indexOf('release'));
  });

  it('stores a PDF as it came, without thumbnail priming or face capture', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const media = {
      Id: 43, UserId: 2, TreeId: 10, Title: 'register.pdf', FilePath: '11_1.pdf',
      ContentType: 'application/pdf', ContentHash: 'hash',
    };
    mocks.getClient.mockResolvedValue({ query, release: vi.fn() });
    mocks.createCanonicalMedia.mockResolvedValue(media);
    const bytes = Buffer.from('%PDF-1.4\n%%EOF\n');
    const file = new File([bytes], 'register.pdf', { type: 'application/pdf' });

    await expect(uploadMediaService({ ...params, file })).resolves.toEqual(media);

    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(String(mocks.writeFile.mock.calls[0][0])).toMatch(/\.pdf$/);
    expect(Buffer.compare(mocks.writeFile.mock.calls[0][1], bytes)).toBe(0);
    expect(mocks.createCanonicalMedia).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ContentType: 'application/pdf', Format: 'PDF', FileSize: bytes.length }),
    }), expect.anything());
    expect(mocks.primeThumbnailCache).not.toHaveBeenCalled();
    expect(mocks.captureFacesForMedia).not.toHaveBeenCalled();
  });

  it('refuses a file named .pdf whose bytes are not a PDF, before writing anything', async () => {
    const file = new File(['<html><script>alert(1)</script>'], 'evil.pdf', { type: 'application/pdf' });

    await expect(uploadMediaService({ ...params, file })).rejects.toThrow('not a valid PDF');

    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.createCanonicalMedia).not.toHaveBeenCalled();
  });

  it('materializes an imported PDF without priming or face capture', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const pending = { id: 9, status: 'pending', archivePath: 'media/O1-deed.pdf', mediaId: 42, skipFaceCapture: false };
    mocks.getMediaImportItem.mockResolvedValueOnce(pending);
    mocks.lockMediaImportItem.mockResolvedValue(pending);
    mocks.transitionMediaImportItem.mockResolvedValue({ ...pending, status: 'ready' });
    mocks.getClient.mockResolvedValue({ query, release: vi.fn() });
    const file = new File(['%PDF-1.7\n'], 'O1-deed.pdf', { type: 'application/pdf' });

    await expect(materializeImportMediaService({
      itemId: 9, archivePath: 'media/O1-deed.pdf', file,
      requestedTreeId: 10, requestedOwnerId: null, currentUserId: 7,
    })).resolves.toMatchObject({ outcome: 'ready' });

    expect(String(mocks.writeFile.mock.calls[0][0])).toMatch(/\.pdf$/);
    expect(mocks.primeThumbnailCache).not.toHaveBeenCalled();
    expect(mocks.captureFacesForMedia).not.toHaveBeenCalled();
    // A GEDCOM _PRIM on the document is dropped: a PDF is never a portrait.
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SET "IsPrimary" = 0'), [42]);
  });

  it('records a fake imported PDF as an unsupported type', async () => {
    const pending = { id: 9, status: 'pending', archivePath: 'media/O1-deed.pdf', mediaId: 42, skipFaceCapture: false };
    mocks.getMediaImportItem.mockResolvedValueOnce(pending);
    mocks.lockMediaImportItem.mockResolvedValue(pending);
    mocks.transitionMediaImportItem.mockResolvedValue({ ...pending, status: 'failed' });
    mocks.getClient.mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: vi.fn() });
    const file = new File(['not a pdf'], 'O1-deed.pdf', { type: 'application/pdf' });

    await expect(materializeImportMediaService({
      itemId: 9, archivePath: 'media/O1-deed.pdf', file,
      requestedTreeId: 10, requestedOwnerId: null, currentUserId: 7,
    })).resolves.toMatchObject({ outcome: 'failed', failureCode: 'unsupported_media_type' });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});
