/** @vitest-environment happy-dom */
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import JourneySketch from '@/app/components/JourneySketch';

const sweden = [
  { lat: 59.86, lng: 17.64, label: 'Uppsala, Sweden', year: '1888' },
  { lat: 59.87, lng: 17.65, label: 'Svartbäcken, Uppsala, Sweden', year: '1910' },
  { lat: 55.7, lng: 13.19, label: 'Lund, Sweden', year: '1932' },
];

describe('JourneySketch', () => {
  it('draws the route over the bundled outline map', async () => {
    const { container } = render(<JourneySketch stops={sweden} />);
    expect(container.querySelectorAll('circle')).toHaveLength(3);
    expect(container.querySelector('.journey-sketch__end')).not.toBeNull();
    // The land and borders arrive once the Natural Earth chunk loads.
    await waitFor(() => expect(container.querySelector('.journey-sketch__land')).not.toBeNull());
    expect(container.querySelector('.journey-sketch__land')!.getAttribute('d')!.length).toBeGreaterThan(200);
    // Sweden's borders with Norway and Finland are in view.
    expect(container.querySelector('.journey-sketch__border')).not.toBeNull();
  });

  it('keeps every stop inside the picture, one place included', () => {
    for (const stops of [sweden, [sweden[0]]]) {
      const { container, unmount } = render(<JourneySketch stops={stops} />);
      for (const c of container.querySelectorAll('circle')) {
        const [x, y] = [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))];
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(260);
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(150);
      }
      unmount();
    }
  });

  it('draws nothing without a stop', () => {
    const { container } = render(<JourneySketch stops={[]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
