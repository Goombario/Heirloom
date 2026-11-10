/**
 * @vitest-environment happy-dom
 *
 * Regression guard for the static-app profile-image flash. ProfileImage loads +
 * decodes a new blob in a hidden loader layer BEFORE swapping it in, so a
 * switch/Back-nav never shows a blank (undecoded) <img> and never flashes the "?"
 * glyph during the normal load window. The previously-decoded portrait is held
 * until the new one is ready — matching the hosted build. "?" only on real failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ProfileImage from '@/app/components/ProfileImage';

// Controllable useMediaUrl: flip `mockSrc` / `mockError` to simulate the local path.
let mockSrc: string | null = null;
let mockError = false;
vi.mock('@/lib/media/useMediaUrl', () => ({
  useMediaUrl: () => ({ src: mockSrc, loading: mockSrc === null && !mockError, error: mockError }),
}));

// jsdom decodes nothing; stub HTMLImageElement.decode to exercise decode-before-swap.
type DecodeMode = 'resolve' | 'manual' | 'reject';
let decodeMode: DecodeMode = 'resolve';
let pendingDecodes: Array<() => void> = [];
const realDecode = HTMLImageElement.prototype.decode;

/** The hidden loader <img> (aria-hidden, excluded from role queries). */
const loader = (c: HTMLElement) => c.querySelector('img[aria-hidden="true"]') as HTMLImageElement | null;

/** jsdom never fires load; simulate a decoded blob arriving in the loader. */
function fireLoaded(c: HTMLElement, nW = 256, nH = 192) {
  const el = loader(c)!;
  Object.defineProperty(el, 'naturalWidth', { value: nW, configurable: true });
  Object.defineProperty(el, 'naturalHeight', { value: nH, configurable: true });
  fireEvent.load(el);
}

beforeEach(() => {
  cleanup();
  mockSrc = null;
  mockError = false;
  decodeMode = 'resolve';
  pendingDecodes = [];
  HTMLImageElement.prototype.decode = function () {
    if (decodeMode === 'manual') return new Promise<void>((res) => pendingDecodes.push(res));
    if (decodeMode === 'reject') return Promise.reject(new Error('decode failed'));
    return Promise.resolve();
  };
});
afterEach(() => { HTMLImageElement.prototype.decode = realDecode; });

describe('ProfileImage decode-before-swap (local/static path)', () => {
  it('renders neither the visible image nor the "?" glyph while the blob is still resolving', () => {
    render(<ProfileImage mediaId={42} alt="Ada" containerWidth={96} containerHeight={96} />);
    expect(screen.queryByText('?')).toBeNull();
    expect(screen.queryByAltText('Ada')).toBeNull();
  });

  it('shows the image only after it has loaded + decoded (never a blank <img>)', async () => {
    mockSrc = 'blob:ready';
    const { container } = render(<ProfileImage mediaId={42} alt="Ada" containerWidth={96} containerHeight={96} />);
    // Only the hidden loader exists until it finishes.
    expect(screen.queryByAltText('Ada')).toBeNull();
    fireLoaded(container);
    const img = await screen.findByAltText('Ada');
    expect(img.getAttribute('src')).toBe('blob:ready');
    expect(screen.queryByText('?')).toBeNull();
  });

  it('HOLDS the previous decoded image until the new src finishes decoding', async () => {
    mockSrc = 'blob:AAA';
    const { container, rerender } = render(
      <ProfileImage mediaId={1} alt="First" containerWidth={96} containerHeight={96} />,
    );
    fireLoaded(container);
    expect((await screen.findByAltText('First')).getAttribute('src')).toBe('blob:AAA');

    // Switch to a new person whose decode is still pending.
    decodeMode = 'manual';
    mockSrc = 'blob:BBB';
    rerender(<ProfileImage mediaId={2} alt="Second" containerWidth={96} containerHeight={96} />);
    fireLoaded(container); // loader for BBB loads, but decode() is pending

    // Still painting the PREVIOUS portrait's blob (held) — no blank/monogram frame.
    // (alt already reflects the new person; only the pixels lag until decode.)
    const held = container.querySelector('img:not([aria-hidden])') as HTMLImageElement;
    expect(held.getAttribute('src')).toBe('blob:AAA');

    // Decode completes → atomic swap.
    pendingDecodes.forEach((r) => r());
    const swapped = await screen.findByAltText('Second');
    expect(swapped.getAttribute('src')).toBe('blob:BBB');
  });

  it('keeps the HELD image at its OWN crop, not the incoming person\'s focal', async () => {
    // First person cropped left (focalX 20); second cropped right (focalX 80).
    mockSrc = 'blob:AAA';
    const { container, rerender } = render(
      <ProfileImage mediaId={1} alt="First" focalX={20} focalY={50} containerWidth={96} containerHeight={96} />,
    );
    fireLoaded(container);
    const first = await screen.findByAltText('First');
    expect(first.style.objectPosition).toBe('20% 50%');

    // Switch: props (incl. focal) become the new person's while the new blob decodes.
    decodeMode = 'manual';
    mockSrc = 'blob:BBB';
    rerender(<ProfileImage mediaId={2} alt="Second" focalX={80} focalY={50} containerWidth={96} containerHeight={96} />);
    fireLoaded(container);

    // BUG GUARD: the still-held first image must NOT jump to the new focal (80%).
    const held = container.querySelector('img:not([aria-hidden])') as HTMLImageElement;
    expect(held.getAttribute('src')).toBe('blob:AAA');
    expect(held.style.objectPosition).toBe('20% 50%');

    // After the swap the new image uses its own focal.
    pendingDecodes.forEach((r) => r());
    const swapped = await screen.findByAltText('Second');
    expect(swapped.style.objectPosition).toBe('80% 50%');
  });

  it('shows the "?" glyph when the new blob fails to load', async () => {
    mockSrc = 'blob:broken';
    const { container } = render(<ProfileImage mediaId={42} alt="Ada" containerWidth={96} containerHeight={96} />);
    fireEvent.error(loader(container)!);
    expect(await screen.findByText('?')).toBeTruthy();
    expect(screen.queryByAltText('Ada')).toBeNull();
  });

  it('shows the "?" glyph when the blob loads but cannot decode (corrupt)', async () => {
    decodeMode = 'reject';
    mockSrc = 'blob:corrupt';
    const { container } = render(<ProfileImage mediaId={42} alt="Ada" containerWidth={96} containerHeight={96} />);
    fireLoaded(container); // loads, but decode() rejects
    expect(await screen.findByText('?')).toBeTruthy();
    expect(screen.queryByAltText('Ada')).toBeNull();
  });

  it('shows the "?" glyph when the local blob read genuinely fails (error, no src)', () => {
    mockError = true; // getFile/getThumb rejected — src stays null, but this is a failure
    render(<ProfileImage mediaId={42} alt="Ada" containerWidth={96} containerHeight={96} />);
    expect(screen.getByText('?')).toBeTruthy();
  });
});
