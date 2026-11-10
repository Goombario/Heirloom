// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ScrollArea } from '@/app/components/ui/ScrollArea';

describe('ScrollArea', () => {
  // overflow: scroll, not auto — the rail has to stay painted when the content
  // fits, or the reserved column reads as an unexplained gap beside the content.
  it('keeps the scrollbar rail painted by default', () => {
    const { container } = render(<ScrollArea>content</ScrollArea>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('scroll-area');
    expect(el.className).toContain('overflow-y-scroll');
  });

  it('falls back to auto when the rail is turned off', () => {
    const { container } = render(<ScrollArea persistentRail={false}>content</ScrollArea>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('overflow-y-auto');
    expect(el.className).not.toContain('overflow-y-scroll');
  });

  it('sets the overflow axis', () => {
    const { container } = render(<ScrollArea axis="both">content</ScrollArea>);
    expect((container.firstElementChild as HTMLElement).className).toContain('overflow-scroll');
  });

  it('pins the cross axis for a horizontal scroller', () => {
    const { container } = render(<ScrollArea axis="x">content</ScrollArea>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('overflow-x-scroll');
    expect(el.className).toContain('overflow-y-hidden');
  });

  it('forwards className and arbitrary div props', () => {
    const { container } = render(<ScrollArea className="max-h-80" data-testid="results" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('max-h-80');
    expect(el.getAttribute('data-testid')).toBe('results');
  });
});
