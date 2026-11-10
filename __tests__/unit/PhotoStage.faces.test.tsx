/**
 * @vitest-environment happy-dom
 *
 * First component-level coverage of the lightbox stage. Guards the three
 * behaviours that PRs for #456/#457/#458 introduced and that nothing else
 * asserts:
 *
 *   - a face is a LINK to the person, not a popover trigger (#457)
 *   - a hidden face is still MOUNTED so it can be hovered (#458) — the bug was
 *     an early return, so "renders nothing" is exactly the regression to catch
 *   - tag mode is announced and cannot be entered without a visible exit (#456)
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PhotoStage from '@/app/components/lightbox/PhotoStage';
import type { LightboxTag } from '@/app/components/lightbox/types';
import type { Media } from '@/lib/db/schema';

const translations: Record<string, string> = {
  photo_alt: 'Photo',
  photo_counter: '{current} of {total}',
  thumbnail_n: 'Thumbnail {n}',
  tag_a_face: 'Tag a face',
  done_tagging: 'Done tagging',
  draw_box_prompt: 'Drag a box over the face to tag someone.',
  tag_mode_esc_hint: 'Press Esc or Done tagging to finish.',
  back_to_gallery: 'Back to gallery',
  close: 'Close',
  previous: 'Previous',
  next: 'Next',
  done: 'Done',
  redraw_face: 'Redraw face',
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

// Embla owns real layout measurement, which happy-dom cannot provide. The stage
// only consumes the API surface below.
vi.mock('embla-carousel-react', () => ({
  default: () => [
    () => {},
    {
      canScrollPrev: () => false,
      canScrollNext: () => false,
      selectedScrollSnap: () => 0,
      scrollPrev: vi.fn(),
      scrollNext: vi.fn(),
      scrollTo: vi.fn(),
      reInit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    },
  ],
}));

vi.mock('@/app/components/MediaImg', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} src="/stub.jpg" />,
}));

function makeTag(overrides: Partial<LightboxTag> = {}): LightboxTag {
  return {
    Id: 1,
    MediaId: 10,
    PersonId: 42,
    RegionX: 10,
    RegionY: 10,
    RegionW: 20,
    RegionH: 20,
    IsPrimary: 0,
    PersonFirstName: 'Ada',
    PersonLastName: 'Example',
    PersonEffectiveFirstName: null,
    PersonNickname: null,
    ...overrides,
  } as LightboxTag;
}

const items = [{ Id: 10, Title: 'A photo' }] as Media[];

function renderStage(overrides: Partial<React.ComponentProps<typeof PhotoStage>> = {}) {
  const onHoverTag = vi.fn();
  const onDoneTagging = vi.fn();
  render(
    <PhotoStage
      items={items}
      index={0}
      onChangeIndex={vi.fn()}
      treeId={1}
      alt="Photo"
      tags={[makeTag()]}
      overlayTags
      tagMode={false}
      hoveredTagId={null}
      onHoverTag={onHoverTag}
      onDrawComplete={vi.fn()}
      counterCurrent={1}
      counterTotal={1}
      ctxNoun="Back to gallery"
      onClose={vi.fn()}
      onDoneTagging={onDoneTagging}
      {...overrides}
    />,
  );
  return { onHoverTag, onDoneTagging };
}

describe('PhotoStage face overlay', () => {
  it('renders a tagged face as a link straight to the person (#457)', () => {
    renderStage();
    const face = screen.getByRole('link', { name: 'Ada Example' });
    expect(face).toHaveAttribute('href', '/people/view?id=42');
  });

  it('does not render a face popover', () => {
    renderStage();
    // The popover was the only thing carrying a "View profile" affordance.
    expect(screen.queryByText(/view profile/i)).not.toBeInTheDocument();
  });

  it('keeps a hidden face mounted so it can be hovered (#458)', () => {
    // The original bug was `if (!visible) return null`, which left nothing under
    // the cursor. With overlays off the face must still exist, just transparent.
    renderStage({ overlayTags: false });
    const face = screen.getByRole('link', { name: 'Ada Example' });
    expect(face).toBeInTheDocument();
    expect(face.parentElement).toHaveStyle({ opacity: '0' });
  });

  it('reveals a hidden face when it is the hovered tag', () => {
    renderStage({ overlayTags: false, hoveredTagId: 1 });
    const face = screen.getByRole('link', { name: 'Ada Example' });
    expect(face.parentElement).toHaveStyle({ opacity: '1' });
  });

  it('feeds the shared hover channel from the photo, not just the rail (#458)', () => {
    const { onHoverTag } = renderStage({ overlayTags: false });
    const wrapper = screen.getByRole('link', { name: 'Ada Example' }).parentElement!;

    fireEvent.mouseEnter(wrapper);
    expect(onHoverTag).toHaveBeenCalledWith(1);

    fireEvent.mouseLeave(wrapper);
    expect(onHoverTag).toHaveBeenCalledWith(null);
  });

  it('reveals a face on keyboard focus, so invisible targets are not tabbed through', () => {
    const { onHoverTag } = renderStage({ overlayTags: false });
    fireEvent.focus(screen.getByRole('link', { name: 'Ada Example' }));
    expect(onHoverTag).toHaveBeenCalledWith(1);
  });
});

describe('PhotoStage tag mode', () => {
  it('never lets a face hit target swallow the draw gesture', () => {
    renderStage({ tagMode: true });
    const wrapper = screen.getByRole('link', { name: 'Ada Example' }).parentElement!;
    expect(wrapper).toHaveStyle({ pointerEvents: 'none' });
  });

  it('frames the photo wrapper the draw gesture measures, not the whole stage (#640)', () => {
    renderStage({ tagMode: true });
    const frame = screen.getByTestId('tag-mode-frame');
    const drawSurface = screen.getByRole('link', { name: 'Ada Example' }).parentElement!.parentElement!;
    expect(frame.parentElement).toBe(drawSurface);
    expect(frame).toHaveClass('pointer-events-none', 'inset-0');
  });

  it('shows no mode frame outside tag mode', () => {
    renderStage({ tagMode: false });
    expect(screen.queryByTestId('tag-mode-frame')).toBeNull();
  });

  it('takes faces out of the tab order while drawing', () => {
    renderStage({ tagMode: true });
    expect(screen.getByRole('link', { name: 'Ada Example' })).toHaveAttribute('tabindex', '-1');
  });

  it('does not fire the hover channel in tag mode', () => {
    const { onHoverTag } = renderStage({ tagMode: true });
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Ada Example' }).parentElement!);
    expect(onHoverTag).not.toHaveBeenCalled();
  });

  it('shows a visible exit and announces the mode (#456)', () => {
    const { onDoneTagging } = renderStage({ tagMode: true });

    // role="status" is what makes entering the mode perceivable to a screen
    // reader — previously nothing announced it.
    expect(screen.getByRole('status')).toHaveTextContent('Drag a box over the face to tag someone.');

    fireEvent.click(screen.getByRole('button', { name: /done tagging/i }));
    expect(onDoneTagging).toHaveBeenCalled();
  });

  it('tells the user Esc also leaves the mode', () => {
    renderStage({ tagMode: true });
    expect(screen.getByRole('status')).toHaveTextContent(/Esc/);
  });

  it('announces that drawing will replace an existing face region', () => {
    renderStage({ tagMode: true, drawTargetTagId: 1 });
    expect(screen.getByRole('status')).toHaveTextContent('Redraw face');
    expect(screen.getByRole('button', { name: /done tagging/i })).toBeInTheDocument();
  });
});

// Esc mid-gesture (tag mode off before the pointer is released) used to keep the
// press's anchor, so the next draw continued from it (#639).
describe('PhotoStage draw gesture cancel (#639)', () => {
  type OnDraw = React.ComponentProps<typeof PhotoStage>['onDrawComplete'];
  const props = (tagMode: boolean, onDrawComplete: OnDraw) => (
    <PhotoStage
      items={items} index={0} onChangeIndex={vi.fn()} treeId={1} alt="Photo"
      tags={[]} overlayTags tagMode={tagMode} hoveredTagId={null} onHoverTag={vi.fn()}
      onDrawComplete={onDrawComplete} counterCurrent={1} counterTotal={1}
      ctxNoun="Back to gallery" onClose={vi.fn()} onDoneTagging={vi.fn()}
    />
  );
  const stage = () => screen.getByAltText('Photo').parentElement!;

  it('starts a fresh box after Esc, and the cancelled press creates nothing', () => {
    const onDrawComplete = vi.fn<OnDraw>();
    const { rerender } = render(props(true, onDrawComplete));
    const el = stage();
    Object.defineProperty(el, 'offsetWidth', { configurable: true, value: 400 });
    Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 400 });
    el.setPointerCapture = vi.fn();

    fireEvent.pointerDown(el, { clientX: 10, clientY: 10, pointerId: 1 });
    rerender(props(false, onDrawComplete)); // Esc
    fireEvent.pointerUp(stage(), { clientX: 10, clientY: 10, pointerId: 1 });
    expect(onDrawComplete).not.toHaveBeenCalled();

    rerender(props(true, onDrawComplete)); // re-enter tag mode
    fireEvent.pointerDown(stage(), { clientX: 200, clientY: 200, pointerId: 2 });
    fireEvent.pointerMove(stage(), { clientX: 300, clientY: 300, pointerId: 2 });
    fireEvent.pointerUp(stage(), { clientX: 300, clientY: 300, pointerId: 2 });
    expect(onDrawComplete).toHaveBeenCalledTimes(1);
    expect(onDrawComplete.mock.calls[0][0]).toMatchObject({ RegionX: 50, RegionY: 50, RegionW: 25, RegionH: 25 });
  });

  it('drops a pressed anchor when tag mode ends without a release', () => {
    const onDrawComplete = vi.fn<OnDraw>();
    const { rerender } = render(props(true, onDrawComplete));
    const el = stage();
    Object.defineProperty(el, 'offsetWidth', { configurable: true, value: 400 });
    Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 400 });
    el.setPointerCapture = vi.fn();

    fireEvent.pointerDown(el, { clientX: 10, clientY: 10, pointerId: 1 });
    rerender(props(false, onDrawComplete));
    rerender(props(true, onDrawComplete));
    fireEvent.pointerDown(stage(), { clientX: 200, clientY: 200, pointerId: 2 });
    fireEvent.pointerMove(stage(), { clientX: 300, clientY: 300, pointerId: 2 });
    fireEvent.pointerUp(stage(), { clientX: 300, clientY: 300, pointerId: 2 });
    expect(onDrawComplete.mock.calls[0][0]).toMatchObject({ RegionX: 50, RegionY: 50 });
  });
});
