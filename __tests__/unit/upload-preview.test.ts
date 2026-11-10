import { beforeEach, describe, expect, it, vi } from 'vitest';

const { downscaleToThumb } = vi.hoisted(() => ({ downscaleToThumb: vi.fn() }));

vi.mock('@/lib/media/process-image', () => ({
  downscaleToThumb,
}));

import { createUploadPreview } from '@/lib/media/upload-preview';

describe('createUploadPreview', () => {
  beforeEach(() => {
    downscaleToThumb.mockReset();
  });

  it('returns a bounded JPEG Blob for a raster image', async () => {
    downscaleToThumb.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/jpeg',
    });

    const preview = await createUploadPreview(new Uint8Array([9, 8, 7]), 'image/png');

    expect(downscaleToThumb).toHaveBeenCalledWith(new Uint8Array([9, 8, 7]), 'image/png', 256);
    expect(preview).toBeInstanceOf(Blob);
    expect(preview?.type).toBe('image/jpeg');
    expect(preview && new Uint8Array(await preview.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it.each(['image/svg+xml', 'image/gif'])('returns null for %s', async (contentType) => {
    downscaleToThumb.mockResolvedValue(null);

    await expect(createUploadPreview(new Uint8Array([1]), contentType)).resolves.toBeNull();
  });

  it('returns null when decoding or encoding fails', async () => {
    downscaleToThumb.mockRejectedValue(new Error('decode failed'));

    await expect(createUploadPreview(new Uint8Array([1]), 'image/jpeg')).resolves.toBeNull();
  });
});
