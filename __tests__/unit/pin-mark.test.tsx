/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { PinMark } from '@/app/places/PinMark';
import en from '@/messages/en.json';

function renderMark(state: 'own' | 'inherited' | 'none') {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PinMark state={state} />
    </NextIntlClientProvider>,
  );
}

describe('PinMark', () => {
  it('renders a map pin for a place with its own coordinates', () => {
    const { container } = renderMark('own');
    // lucide-react renders an <svg> with a stable class per icon.
    expect(container.querySelector('svg.lucide-map-pin')).not.toBeNull();
  });

  it('renders a hollow circle, not a filled dot, when there is no pin', () => {
    const { container } = renderMark('none');
    expect(container.querySelector('svg.lucide-circle')).not.toBeNull();
    expect(screen.getByTitle(en.places.no_pin)).toBeTruthy();
  });

  it('keeps the dashed diamond for an inherited pin', () => {
    renderMark('inherited');
    expect(screen.getByTitle(en.places.inherited_pin)).toBeTruthy();
  });
});
