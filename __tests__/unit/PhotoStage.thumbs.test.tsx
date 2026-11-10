/**
 * @vitest-environment happy-dom
 *
 * Thumbnail strip (#88). The strip was hand-rolled native scroll with its
 * scrollbar hidden, no drag handler and no buttons, so on desktop it could not
 * be scrolled at all — it only moved as a side effect of changing photo. It is
 * Embla again, which is what the previous attempt (a2cc23e) tried and abandoned.
 *
 * The abandoned attempt failed because its track was `flex justify-center
 * min-w-min`: centring an OVERFLOWING flex track puts the leading slides at a
 * negative offset, Embla inherits that geometry, and its scroll range collapses.
 * The regression that matters most here is therefore "the track is not centred
 * while it overflows" — that single class is what made Embla look broken.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PhotoStage from '@/app/components/lightbox/PhotoStage';
import type { Media } from '@/lib/db/schema';

const translations: Record<string, string> = {
  photo_alt: 'Photo',
  photo_counter: '{current} of {total}',
  thumbnail_n: 'Thumbnail {n}',
  thumbnail_document_n: 'Document {n}',
  tag_a_face: 'Tag a face',
  done_tagging: 'Done tagging',
  draw_box_prompt: 'Drag a box over the face to tag someone.',
  tag_mode_esc_hint: 'Press Esc or Done tagging to finish.',
  close: 'Close',
  previous: 'Previous',
  next: 'Next',
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    let value = translations[key] ?? key;
    for (const [name, replacement] of Object.entries(values ?? {})) {
      value = value.replace(`{${name}}`, String(replacement));
    }
    return value;
  },
}));

/**
 * Embla needs real layout measurement, which happy-dom cannot provide, so the
 * carousels are stubbed. `overflows` drives what the strip's instance reports
 * from canScrollPrev/canScrollNext — the signal the component uses to decide
 * whether centring the track is safe.
 */
const carousels: { scrollTo: ReturnType<typeof vi.fn> }[] = [];
let overflows = false;

vi.mock('embla-carousel-react', () => ({
  default: () => {
    const api = {
      canScrollPrev: () => overflows,
      canScrollNext: () => overflows,
      selectedScrollSnap: () => 0,
      scrollPrev: vi.fn(),
      scrollNext: vi.fn(),
      scrollTo: vi.fn(),
      reInit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    carousels.push(api);
    return [() => {}, api];
  },
}));

vi.mock('@/app/components/MediaImg', () => ({
  default: ({ alt, mediaId, width }: { alt: string; mediaId: number; width?: number }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src="/stub.jpg" data-media-id={mediaId} data-width={width ?? 'full'} />
  ),
}));

const items = [
  { Id: 10, Title: 'One' },
  { Id: 11, Title: 'Two' },
  { Id: 12, Title: 'Three' },
] as Media[];

function renderStage(overrides: Partial<React.ComponentProps<typeof PhotoStage>> = {}) {
  const onChangeIndex = vi.fn();
  const result = render(
    <PhotoStage
      items={items}
      index={0}
      onChangeIndex={onChangeIndex}
      treeId={1}
      alt="Photo"
      tags={[]}
      overlayTags
      tagMode={false}
      hoveredTagId={null}
      onHoverTag={vi.fn()}
      onDrawComplete={vi.fn()}
      counterCurrent={1}
      counterTotal={items.length}
      ctxNoun="Back to gallery"
      onClose={vi.fn()}
      onDoneTagging={vi.fn()}
      {...overrides}
    />,
  );
  return { onChangeIndex, ...result };
}

/** The flex track that holds the thumb buttons. */
function thumbTrack(): HTMLElement {
  return screen.getByRole('button', { name: 'One' }).parentElement!;
}

beforeEach(() => {
  carousels.length = 0;
  overflows = false;
});

describe('PhotoStage thumbnail strip', () => {
  it('mounts full-size media only for the active slide and its neighbours', () => {
    const manyItems = [10, 11, 12, 13, 14].map((Id) => ({ Id, Title: `Photo ${Id}` })) as Media[];
    const { container } = renderStage({ items: manyItems, index: 2, counterCurrent: 3, counterTotal: manyItems.length });

    const fullImages = Array.from(container.querySelectorAll('img')).filter((image) => image.dataset.width === 'full');
    expect(fullImages.map((image) => image.dataset.mediaId)).toEqual(['11', '12', '13']);
  });

  it('renders one thumbnail per item', () => {
    renderStage();
    expect(screen.getByRole('button', { name: 'One' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Three' })).toBeInTheDocument();
  });

  it('names an untitled thumbnail by its kind and place (#1232)', () => {
    renderStage({ items: [{ Id: 10, Title: '' }, { Id: 11, Title: null, ContentType: 'application/pdf' }] as Media[], counterTotal: 2 });
    expect(screen.getByRole('button', { name: 'Thumbnail 1' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Document 2' })).not.toHaveAttribute('aria-current');
  });

  it('hides the strip for a single photo', () => {
    renderStage({ items: [items[0]], counterTotal: 1 });
    expect(screen.queryByRole('button', { name: 'One' })).not.toBeInTheDocument();
  });

  it('hides the strip in the bare (mobile) stage', () => {
    renderStage({ bare: true });
    expect(screen.queryByRole('button', { name: 'One' })).not.toBeInTheDocument();
  });

  it('changes photo when a thumbnail is clicked', () => {
    const { onChangeIndex } = renderStage();
    fireEvent.click(screen.getByRole('button', { name: 'Three' }));
    expect(onChangeIndex).toHaveBeenCalledWith(2);
  });

  it('does NOT centre the track while the strip overflows', () => {
    // This is the exact class that broke a2cc23e. Centring an overflowing flex
    // track hides the leading slides at a negative offset and collapses Embla's
    // scroll range, which is what made Embla look like it "never scrolled".
    overflows = true;
    renderStage();
    expect(thumbTrack().className).not.toContain('justify-center');
  });

  it('centres the track when every thumbnail fits', async () => {
    overflows = false;
    renderStage();

    // The fit is measured in a requestAnimationFrame, matching how the pager
    // defers its arrow state (the repo's no-direct-set-state-in-use-effect
    // pattern), so centring lands one frame after mount rather than on it.
    expect(thumbTrack().className).not.toContain('justify-center');
    await waitFor(() => expect(thumbTrack().className).toContain('justify-center'));
  });

  it('starts un-centred so Embla never measures a centred overflowing track', async () => {
    // Ordering guard, not cosmetics. If the initial state were "centred", Embla
    // would take its first measurement of an overflowing track while it was
    // centred — precisely the geometry that collapsed a2cc23e's scroll range.
    overflows = true;
    renderStage();
    expect(thumbTrack().className).not.toContain('justify-center');
    await waitFor(() => expect(thumbTrack().className).not.toContain('justify-center'));
  });

  it('does not hide a scrollbar it no longer has', () => {
    // The native strip suppressed the scrollbar in both engines, which is how it
    // ended up with no scroll affordance at all. Embla's viewport is
    // overflow-hidden by design, so neither suppression should survive.
    renderStage();
    const viewport = thumbTrack().parentElement!;
    expect(viewport.className).not.toContain('overflow-x-auto');
    expect(viewport.className).not.toContain('scrollbar');
    expect(viewport.getAttribute('style') ?? '').not.toContain('scrollbar-width');
  });

  it('recentres the active thumbnail on the strip, not the pager', () => {
    renderStage({ index: 2 });
    // Two carousels are created: the photo pager first, the strip second.
    expect(carousels).toHaveLength(2);
    expect(carousels[1].scrollTo).toHaveBeenCalledWith(2);
  });
});
