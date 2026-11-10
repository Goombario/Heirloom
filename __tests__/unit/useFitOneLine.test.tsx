/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useFitOneLine } from '@/app/hooks/useFitOneLine';

// happy-dom has no layout (and drops `calc(var())` font sizes), so fake one and
// read the fitted ratio from data-fit-ratio: the text is `chars` glyphs at 0.5em each,
// on one line while white-space is nowrap, in a 300px column.
const COLUMN = 300;
function fakeLayout(chars: number) {
  const desc = {
    scrollWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth'),
    clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
  };
  const px = (el: HTMLElement) => parseFloat(el.style.fontSize) || 40;
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get(this: HTMLElement) { return Math.round(chars * px(this) * 0.5); } });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return COLUMN; } });
  return () => {
    if (desc.scrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', desc.scrollWidth);
    if (desc.clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', desc.clientWidth);
  };
}

function Heading({ text }: { text: string }) {
  const ref = useFitOneLine<HTMLHeadingElement>({ token: '--text-4xl', minRatio: 28 / 40 });
  return <h1 ref={ref} style={{ fontSize: undefined }}>{text}</h1>;
}

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

// Long person names wrapped and made heroes different heights (#741).
describe('useFitOneLine (#741)', () => {
  // getComputedStyle has no stylesheet here, so give the heading its 40px base inline.
  const renderAt40 = (text: string) => {
    const style = document.createElement('style');
    style.textContent = 'h1 { font-size: 40px; }';
    document.head.appendChild(style);
    return render(<Heading text={text} />).container.querySelector('h1')!;
  };

  it('leaves a name that fits at full size alone', () => {
    restore = fakeLayout(14); // 14 × 20px = 280px ≤ 300
    const h1 = renderAt40('Hazel Bracken');
    expect(h1.style.fontSize).toBe('');
    expect(h1.dataset.fitRatio).toBeUndefined();
  });

  it('shrinks a longer name in 2px steps until it fits on one line', () => {
    restore = fakeLayout(18); // fits at 32px (288px), not at 34px (306px)
    const h1 = renderAt40('Pegeeegy Joan Bramley');
    expect(h1.dataset.fitRatio).toBe('0.800'); // 32px of 40
    expect(h1.style.whiteSpace).toBe('');
  });

  it('stops at the floor and lets the name wrap below it', () => {
    restore = fakeLayout(40); // would need 15px
    const h1 = renderAt40('A very long name with several given names and a nickname');
    expect(h1.dataset.fitRatio).toBe('0.700'); // the 28px floor
    expect(h1.style.whiteSpace).toBe('');
  });
});
