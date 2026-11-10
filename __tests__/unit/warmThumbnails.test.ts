/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { focalThumbWidth, THUMB_SIZES } from '@/lib/media-url';
import { warmThumbnails } from '@/lib/media/warmThumbnails';

/**
 * The warm is only worth anything if it fetches the SAME variant the avatar will
 * later ask for — a warm at another width is a second fetch that leaves the real
 * one cold. So these lock the width rule to `ProfileImage`'s (both now call
 * `focalThumbWidth`) and assert the URLs actually requested.
 *
 * DATA_MODE defaults to 'http' in tests, which is the branch that issues URLs.
 */
describe('focalThumbWidth', () => {
  it('asks for ~2x the container width, snapped to the server whitelist', () => {
    expect(focalThumbWidth(30)).toBe(64);
    expect(focalThumbWidth(36)).toBe(128); // 72 → next size up
  });

  it('scales the target up by the focal zoom, so a tight crop is not blurry', () => {
    // A 25% radius zooms 4x: 30 * 2 * 4 = 240 → 256.
    expect(focalThumbWidth(30, 25)).toBe(256);
  });

  it('does not zoom for a full-image radius, or a missing one', () => {
    expect(focalThumbWidth(30, 100)).toBe(64);
    expect(focalThumbWidth(30, null)).toBe(64);
  });

  it('never returns a width the media endpoint would reject', () => {
    // The endpoint 400s on any `w` outside THUMB_SIZES, so a clamped-up target
    // must land ON the list rather than past its end.
    expect(THUMB_SIZES).toContain(focalThumbWidth(4000, 1));
  });
});

describe('warmThumbnails (http mode)', () => {
  let requested: string[];
  let originalImage: typeof Image;

  beforeEach(() => {
    requested = [];
    originalImage = globalThis.Image;
    // happy-dom's Image would attempt a real load; record the src instead.
    class RecordingImage {
      decoding = 'auto';
      set src(value: string) { requested.push(value); }
    }
    globalThis.Image = RecordingImage as unknown as typeof Image;
  });

  afterEach(() => {
    globalThis.Image = originalImage;
    vi.restoreAllMocks();
  });

  it('requests the exact URL the avatar will render, focal width included', () => {
    warmThumbnails([{ mediaId: 7, focalRadius: 25 }], { containerWidth: 30, treeId: 3 });

    expect(requested).toEqual(['/api/media/7/file?treeId=3&w=256']);
  });

  it('skips people with no photo — their initials disc is the final state', () => {
    warmThumbnails(
      [{ mediaId: null }, { mediaId: undefined }, { mediaId: 9 }],
      { containerWidth: 30 },
    );

    expect(requested).toEqual(['/api/media/9/file?w=64']);
  });

  it('warms only the first screenful, so a 60-row preview does not stampede', () => {
    const targets = Array.from({ length: 60 }, (_, i) => ({ mediaId: i + 1 }));

    warmThumbnails(targets, { containerWidth: 30, limit: 5 });

    expect(requested).toHaveLength(5);
    expect(requested[0]).toBe('/api/media/1/file?w=64');
    expect(requested[4]).toBe('/api/media/5/file?w=64');
  });

  it('warms a given URL once, so re-renders do not re-issue it', () => {
    warmThumbnails([{ mediaId: 4242 }], { containerWidth: 30 });
    warmThumbnails([{ mediaId: 4242 }], { containerWidth: 30 });

    expect(requested).toEqual(['/api/media/4242/file?w=64']);
  });
});
