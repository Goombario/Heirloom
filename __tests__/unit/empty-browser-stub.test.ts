import { describe, expect, it } from 'vitest';
import * as browserStub from '@/lib/empty';

describe('browser Node built-in stub', () => {
  it('provides inert exports required by media-thumbnail browser aliasing', async () => {
    expect(browserStub.constants).toEqual(expect.objectContaining({
      O_RDONLY: expect.any(Number),
      O_NOFOLLOW: expect.any(Number),
    }));

    for (const name of [
      'readFile',
      'mkdir',
      'readdir',
      'unlink',
      'link',
      'lstat',
      'open',
      'realpath',
    ] as const) {
      expect(browserStub[name]).toEqual(expect.any(Function));
      await expect(browserStub[name]()).rejects.toThrow('fs/promises is not available in the browser');
    }
  });
});
