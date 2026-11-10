import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sharp: vi.fn(),
  resolveMediaUploadTargets: vi.fn(),
  getMediaStorageUsed: vi.fn(),
  getMediaByUploadIntent: vi.fn(),
  createCanonicalMedia: vi.fn(),
  getClient: vi.fn(),
  lockTreeForUpdate: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  captureFacesForMedia: vi.fn(),
  primeThumbnailCache: vi.fn(),
}));

vi.mock('sharp', () => ({ default: mocks.sharp }));
vi.mock('@/lib/services/media-upload-targets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/media-upload-targets')>()),
  resolveMediaUploadTargets: mocks.resolveMediaUploadTargets,
}));
vi.mock('@/lib/db/queries/media', () => ({
  getMediaStorageUsed: mocks.getMediaStorageUsed,
  getMediaByUploadIntent: mocks.getMediaByUploadIntent,
  patchMediaFile: vi.fn(),
  patchMediaTitle: vi.fn(),
}));
vi.mock('@/lib/services/media', () => ({ createCanonicalMedia: mocks.createCanonicalMedia }));
vi.mock('@/lib/db/connection', () => ({ getClient: mocks.getClient }));
vi.mock('@/lib/db/queries/trees', () => ({ lockTreeForUpdate: mocks.lockTreeForUpdate }));
vi.mock('@/lib/services/media-face-capture', () => ({ captureFacesForMedia: mocks.captureFacesForMedia }));
vi.mock('@/lib/media-thumbnail', () => ({ primeThumbnailCache: mocks.primeThumbnailCache }));
vi.mock('@/lib/data-dir', () => ({ getDataDir: () => 'C:\\scoped-data' }));
vi.mock('fs/promises', () => ({
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile,
  unlink: mocks.unlink,
}));

import { uploadMediaService } from '@/lib/services/media-upload';

describe('hosted upload Sharp safety', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveMediaUploadTargets.mockResolvedValue({
      scope: { treeId: 10, ownerId: 2, permission: 'edit' },
      personId: 11, caseId: null, owner: null,
    });
    mocks.getMediaStorageUsed.mockResolvedValue(0);
    mocks.lockTreeForUpdate.mockResolvedValue(true);
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.unlink.mockResolvedValue(undefined);
    mocks.captureFacesForMedia.mockResolvedValue({ captured: 0, caption: null });
    mocks.primeThumbnailCache.mockResolvedValue('created');
    mocks.getClient.mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    });
    mocks.createCanonicalMedia.mockResolvedValue({
      Id: 42, UserId: 2, TreeId: 10, Title: 'portrait.jpg', FilePath: '11_photo.jpg',
      ContentType: 'image/jpeg', ContentHash: 'hash',
    });
    const pipeline = {
      rotate: vi.fn().mockReturnThis(),
      resize: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('compressed')),
    };
    mocks.sharp.mockReturnValue(pipeline);
  });

  it('passes the decoded input-pixel ceiling to Sharp during upload compression', async () => {
    const file = new File([Buffer.from('jpeg bytes')], 'portrait.jpg', { type: 'image/jpeg' });

    await uploadMediaService({
      file, title: null, isPrimary: false, personId: 11, caseId: null,
      ownerTable: null, ownerRecordId: null, requestedTreeId: 10,
      requestedOwnerId: null, currentUserId: 7,
    });

    expect(mocks.sharp).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({
      limitInputPixels: 64_000_000,
    }));
  });
});
