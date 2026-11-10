/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Badge } from '@/app/components/ui';

describe('Badge', () => {
  // Quiet tags (audit §13 addendum, 2026-09-23): no edge on any tone but warning.
  it('draws no ring on any tone but warning', () => {
    for (const tone of ['neutral', 'outline', 'evidence', 'green', 'blue', 'red', 'violet', 'new'] as const) {
      const { unmount } = render(<Badge tone={tone}>{tone}</Badge>);
      expect(screen.getByText(tone).className).not.toMatch(/\bring-/);
      unmount();
    }
  });

  // #824/#899: the warning fill vanishes on a dark card, so its shape is a 1px edge.
  it('gives the warning tag a warning-edge ring on its pale fill', () => {
    render(<Badge tone="warning">warning</Badge>);
    expect(screen.getByText('warning')).toHaveClass('bg-warning-bg', 'ring-1', 'ring-inset', 'ring-warning-edge');
  });

  it('gives neutral the quiet NEW-style fill, and defaults to it', () => {
    const { rerender } = render(<Badge tone="neutral">Tag</Badge>);
    expect(screen.getByText('Tag')).toHaveClass('bg-new-bg', 'text-on-new');
    rerender(<Badge>Tag</Badge>);
    expect(screen.getByText('Tag')).toHaveClass('bg-new-bg', 'text-on-new');
  });

  /**
   * `outline` is plain muted text in the tag's slot: no fill, so it can never
   * collide with a surface-2 parent such as the Faces queue rail (where a filled
   * neutral once vanished), and no box either.
   */
  it('renders outline as unboxed muted text', () => {
    render(<Badge tone="outline">Needs a name</Badge>);
    const badge = screen.getByText('Needs a name');
    expect(badge).toHaveClass('bg-transparent', 'text-text-muted');
    expect(badge).not.toHaveClass('border');
  });

  it('keeps coloured tones filled', () => {
    render(<Badge tone="green">Matched</Badge>);
    expect(screen.getByText('Matched')).toHaveClass('bg-success-bg', 'text-success');
  });

  it('is a square tag, with the pill shape kept for dismissible filter tokens only', () => {
    const { rerender } = render(<Badge tone="warning">Tag</Badge>);
    expect(screen.getByText('Tag')).toHaveClass('rounded-[4px]');
    rerender(<Badge tone="outline" shape="pill">Pill</Badge>);
    expect(screen.getByText('Pill')).toHaveClass('rounded-full');
  });
});
