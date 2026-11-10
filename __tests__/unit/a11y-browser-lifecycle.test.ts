import { describe, expect, it, vi } from 'vitest';

import { runConcurrently, withBrowser } from '@/scripts/lib/browser-lifecycle.mjs';

describe('a11y browser lifecycle', () => {
  it('closes the browser when the scan callback fails', async () => {
    const browser = { close: vi.fn().mockResolvedValue(undefined) };

    await expect(withBrowser(
      async () => browser,
      async () => { throw new Error('synthetic scan failure'); },
    )).rejects.toThrow('synthetic scan failure');

    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('waits for sibling scans to settle before propagating a scan failure', async () => {
    let releaseSibling!: () => void;
    let siblingFinished = false;
    const sibling = new Promise<string>((resolve) => {
      releaseSibling = () => {
        siblingFinished = true;
        resolve('sibling result');
      };
    });
    const run = runConcurrently([
      async () => { throw new Error('synthetic scan failure'); },
      async () => sibling,
    ]);

    await Promise.resolve();
    expect(siblingFinished).toBe(false);
    releaseSibling();
    await expect(run).rejects.toThrow('synthetic scan failure');
    expect(siblingFinished).toBe(true);
  });
});
