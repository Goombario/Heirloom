/** @vitest-environment happy-dom */

import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';
import { DetailSkeleton, SkeletonGrid } from '@/app/components/SkeletonLoader';

describe('SkeletonGrid responsive columns', () => {
  it('allows responsive utility columns to replace the inline template', () => {
    render(
      <SkeletonGrid
        items={1}
        columns={null}
        gap={10}
        className="grid-cols-2 sm:grid-cols-3"
      />,
    );

    const grid = document.querySelector('[aria-busy="true"]');
    expect(grid).not.toBeNull();
    expect(grid).toHaveClass('grid', 'grid-cols-2', 'sm:grid-cols-3');
    expect((grid as HTMLElement).style.gridTemplateColumns).toBe('');
    expect(grid).toHaveStyle({ gap: '10px' });
  });
});

describe('DetailSkeleton hero tone (#698)', () => {
  it('paints the dark hero island by default, so person and family heroes do not flash light to dark', () => {
    const { getByTestId } = render(<DetailSkeleton />);
    expect(getByTestId('detail-skeleton-hero')).toHaveClass('hero-dark');
  });

  it('paints the light card hero for cases', () => {
    const { getByTestId } = render(<DetailSkeleton heroTone="light" />);
    expect(getByTestId('detail-skeleton-hero')).not.toHaveClass('hero-dark');
  });
});
