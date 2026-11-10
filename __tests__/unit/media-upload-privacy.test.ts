import { afterEach, describe, expect, it, vi } from 'vitest';

const unlink = vi.hoisted(() => vi.fn());
vi.mock('fs/promises', () => ({ unlink }));

import { cleanupGeneratedMediaFile } from '@/lib/services/media-upload';

describe('generated media cleanup logging', () => {
  afterEach(() => {
    unlink.mockReset();
    vi.restoreAllMocks();
  });

  it('logs only a stable privacy-safe category and context when unlink fails', async () => {
    unlink.mockRejectedValueOnce(new Error('raw filesystem secret C:/private/photo.jpg'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await cleanupGeneratedMediaFile('C:/private/photo.jpg', 'import_materialization');

    expect(error).toHaveBeenCalledWith(
      'Generated media cleanup failed',
      { category: 'generated_media_cleanup_failed', context: 'import_materialization' },
    );
    expect(error.mock.calls[0]).not.toEqual(expect.arrayContaining([
      expect.stringContaining('C:/private/photo.jpg'),
      expect.objectContaining({ path: expect.anything(), error: expect.anything() }),
    ]));
  });
});
