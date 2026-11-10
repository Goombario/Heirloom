/** @vitest-environment happy-dom */
// Its own file: every load of sheetStack listens for popstate, so this needs the only copy.
import { describe, expect, it, vi } from 'vitest';

describe('a buried sheet step (#1053)', () => {
  it('is stepped over when Back lands on it with no sheet open', async () => {
    vi.resetModules();
    const { pushSheet } = await import('@/app/components/ui/sheetStack');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    pushSheet({ requestClose: vi.fn() })();
    window.dispatchEvent(new PopStateEvent('popstate', { state: { __NA: true, __heirloomSheetStep: 1 } }));
    expect(back).toHaveBeenCalledOnce();
    window.dispatchEvent(new PopStateEvent('popstate', { state: { __NA: true } }));
    expect(back).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
