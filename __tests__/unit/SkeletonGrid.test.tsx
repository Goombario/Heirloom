/** @vitest-environment happy-dom */

import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';
import { DetailSkeleton, SkeletonGrid, WorkspaceSkeleton } from '@/app/components/SkeletonLoader';

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

describe('v1.1 detail skeletons (#63, #698)', () => {
  it('paints the dark cover band and a 4:3 portrait, never a round avatar', () => {
    const { getByTestId } = render(<DetailSkeleton />);
    expect(getByTestId('cover-skeleton').querySelector('.cover-band')).toHaveClass('hero-dark');
    const portrait = getByTestId('cover-skeleton-portrait');
    expect(portrait.closest('.cover-portrait')).not.toBeNull();
    expect(portrait).not.toHaveClass('rounded-full');
  });

  it('splits the family portrait into two partner halves', () => {
    const { getByTestId } = render(<DetailSkeleton portrait="split" />);
    expect(getByTestId('cover-skeleton')).toHaveClass('cover--family');
    expect(getByTestId('cover-skeleton-portrait').children).toHaveLength(2);
  });

  it('lays the body out on the same detail-body classes as the loaded page', () => {
    const { container } = render(<DetailSkeleton />);
    const body = container.querySelector('.detail-body');
    expect(body).toHaveClass('detail-body--index', 'detail-body--rail', 'detail-body--sheet', 'detail-body--divided');
    expect(container.querySelector('h1')).toBeNull();
  });

  it('gives the research case its workspace band and three panes', () => {
    const { getByTestId, container } = render(<WorkspaceSkeleton />);
    expect(getByTestId('workspace-skeleton').querySelector('.cover-band')).toHaveClass('hero-dark');
    expect(container.querySelector('.research-ws__panes')?.children).toHaveLength(3);
  });
});
