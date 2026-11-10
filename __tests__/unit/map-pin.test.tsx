/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { pinSvgHtml, numberedPinSvgHtml, MapPin } from '@/app/components/map-pin';

describe('pinSvgHtml', () => {
    it('renders an svg using the ink CSS var fill and a black outline', () => {
        const html = pinSvgHtml();
        expect(html).toContain('<svg');
        // Colorblind-safe: ink fill paired with a non-color cue (black stroke + shape).
        expect(html).toContain('fill="var(--color-link)"');
        expect(html).toContain('stroke="#000000"');
        // The MapLibre marker element renders at the pin's intrinsic 24×32 size.
        expect(html).toContain('width="24"');
        expect(html).toContain('height="32"');
    });
});

describe('numberedPinSvgHtml', () => {
    it('embeds the stop number as svg text', () => {
        const html = numberedPinSvgHtml(3);
        expect(html).toContain('>3</text>');
        expect(html).toContain('fill="var(--color-link)"');
        expect(html).toContain('stroke="#000000"');
        // The numbered journey marker renders at its intrinsic 26×34 size.
        expect(html).toContain('width="26"');
        expect(html).toContain('height="34"');
    });

    it('renders distinct markup for different numbers', () => {
        expect(numberedPinSvgHtml(1)).not.toBe(numberedPinSvgHtml(2));
        expect(numberedPinSvgHtml(12)).toContain('>12</text>');
    });
});

describe('MapPin', () => {
    it('renders an svg at the default 24×32 size', () => {
        const { container } = render(<MapPin />);
        const svg = container.querySelector('svg');
        expect(svg).not.toBeNull();
        expect(svg!.getAttribute('width')).toBe('24');
        expect(svg!.getAttribute('height')).toBe('32');
        expect(svg!.getAttribute('aria-hidden')).toBe('true');
    });

    it('scales height proportionally to the requested width', () => {
        const { container } = render(<MapPin size={48} />);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('width')).toBe('48');
        // 48/24 * 32 = 64
        expect(svg.getAttribute('height')).toBe('64');
    });

    it('uses the ink fill with a black outline (colorblind-safe)', () => {
        const { container } = render(<MapPin />);
        const path = container.querySelector('path')!;
        expect(path.getAttribute('fill')).toBe('var(--color-link)');
        expect(path.getAttribute('stroke')).toBe('#000000');
    });
});
