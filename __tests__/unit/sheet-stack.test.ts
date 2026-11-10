/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The stack is module state, so each test loads a fresh copy.
async function load() {
  vi.resetModules();
  return import('@/app/components/ui/sheetStack');
}

describe('sheet stack history step (#1053)', () => {
  let push: ReturnType<typeof vi.spyOn>;
  let back: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({ __NA: true }, '');
    push = vi.spyOn(window.history, 'pushState');
    back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('adds one step for the open sheets, keeping the router state on it', async () => {
    const { pushSheet } = await load();
    const offA = pushSheet({ requestClose: vi.fn() });
    const offB = pushSheet({ requestClose: vi.fn() });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toMatchObject({ __NA: true });
    offB();
    offA();
    vi.runAllTimers();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('lets Back take the step while closing the top sheet, and puts a step back if a sheet stays open', async () => {
    const { pushSheet, sheetsTakeBack } = await load();
    const close = vi.fn();
    pushSheet({ requestClose: close });
    expect(sheetsTakeBack()).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    // A dirty sheet stays open: once the traversal lands, it gets a new step.
    window.dispatchEvent(new PopStateEvent('popstate', { state: { __NA: true } }));
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('keeps a sheet swapped for the next on the same step', async () => {
    const { pushSheet } = await load();
    const off = pushSheet({ requestClose: vi.fn() });
    off();
    pushSheet({ requestClose: vi.fn() });
    vi.runAllTimers();
    expect(push).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });

  it('leaves the step alone after a navigation buried it, and lets the guard decide with no sheet open', async () => {
    const { pushSheet, sheetsTakeBack } = await load();
    const off = pushSheet({ requestClose: vi.fn() });
    window.history.replaceState({ __NA: true, other: 'page' }, '');
    off();
    vi.runAllTimers();
    expect(back).not.toHaveBeenCalled();
    expect(sheetsTakeBack()).toBeNull();
  });
});
