/**
 * @vitest-environment happy-dom
 *
 * The empty part of the lightbox top bar is backdrop too (#253): clicking it
 * closes, while the close button, the counter text and tag mode keep their
 * own behaviour.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PhotoStage from '@/app/components/lightbox/PhotoStage';
import type { Media } from '@/lib/db/schema';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('embla-carousel-react', () => ({
  default: () => [() => {}, {
    canScrollPrev: () => false, canScrollNext: () => false, selectedScrollSnap: () => 0,
    scrollPrev: vi.fn(), scrollNext: vi.fn(), scrollTo: vi.fn(), reInit: vi.fn(), on: vi.fn(), off: vi.fn(),
  }],
}));

vi.mock('@/app/components/MediaImg', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} src="/stub.jpg" />,
}));

const items = [{ Id: 10, Title: 'One' }] as Media[];

function renderStage(tagMode: boolean) {
  const onClose = vi.fn();
  render(
    <PhotoStage items={items} index={0} onChangeIndex={vi.fn()} treeId={1} alt="Photo" tags={[]}
      overlayTags tagMode={tagMode} hoveredTagId={null} onHoverTag={vi.fn()} onDrawComplete={vi.fn()}
      counterCurrent={1} counterTotal={1} ctxNoun="Back to gallery" onClose={onClose} onDoneTagging={vi.fn()} />,
  );
  return onClose;
}

describe('PhotoStage top bar (#253)', () => {
  it('closes when its empty part is clicked', () => {
    const onClose = renderStage(false);
    fireEvent.click(screen.getByTestId('lightbox-top-bar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the counter text is clicked', () => {
    const onClose = renderStage(false);
    fireEvent.click(screen.getByText('Back to gallery'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close from the bar in tag mode', () => {
    const onClose = renderStage(true);
    fireEvent.click(screen.getByTestId('lightbox-top-bar'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('PhotoStage zoom controls (#252)', () => {
  it('sits in the top bar while browsing and while tagging', () => {
    renderStage(false);
    expect(screen.getByRole('group', { name: 'zoom_group' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'zoom_in' })).toBeInTheDocument();
  });

  it('puts Done tagging just before the zoom buttons in tag mode', () => {
    renderStage(true);
    const done = screen.getByRole('button', { name: 'done_tagging' });
    const group = screen.getByRole('group', { name: 'zoom_group' });
    expect(done.nextElementSibling).toBe(group);
  });

  it('leaves zoom out and fit off at fit', () => {
    renderStage(false);
    expect(screen.getByRole('button', { name: 'zoom_out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'zoom_fit' })).toBeDisabled();
  });
});
