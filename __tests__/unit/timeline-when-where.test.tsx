/** @vitest-environment happy-dom */

import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';
import { Timeline, TimelineWhenWhere } from '@/app/components/Timeline';

const text = (el: React.ReactElement) => render(el).container.textContent;

// With a long place, the date line used to end in an orphaned " ·" (or the next
// line opened with one) when the place wrapped onto its own line (#808).
describe('TimelineWhenWhere (#808)', () => {
    it('glues the separator to the date and the place with no-break spaces', () => {
        const out = text(<TimelineWhenWhere date={<span>Feb 15, 1889</span>} place="Lumen, Asteria Provincial District" />);
        expect(out).toBe('Feb 15, 1889 · Lumen, Asteria Provincial District');
        // The only break opportunities left are inside the place, after one of its words.
        expect(out).not.toMatch(/ ·|· /);
    });

    it('keeps the date on one line', () => {
        const { container } = render(<TimelineWhenWhere date={<span>Feb 15, 1889</span>} place="Lumen" />);
        expect(container.querySelector('.whitespace-nowrap')?.textContent).toBe('Feb 15, 1889');
    });

    it('drops the separator when either side is missing, and renders nothing when both are', () => {
        expect(text(<TimelineWhenWhere place="Sunvale" />)).toBe('Sunvale');
        expect(text(<TimelineWhenWhere date={<span>1960</span>} place={null} />)).toBe('1960');
        expect(render(<TimelineWhenWhere date={null} place={null} />).container).toBeEmptyDOMElement();
    });
});

// Cite pins trailing the meta line dropped onto a line of their own when a long
// place wrapped, so every timeline renders them beside the title instead (#906).
describe('Timeline citations slot (#906)', () => {
    it('renders citations on the title line, not the meta line', () => {
        const { container } = render(
            <Timeline items={[{
                key: 'a', icon: null, title: 'Birth',
                meta: <TimelineWhenWhere date={<span>1889</span>} place="A very long place, Somewhere Province" />,
                citations: <button type="button">cite</button>,
            }]} />,
        );
        expect(container.querySelector('.tl-med-title button')).toHaveTextContent('cite');
        expect(container.querySelector('.tl-med-meta button')).toBeNull();
    });
});
