/** @vitest-environment happy-dom */
// #392 — /places/view rendered a centred "Loading" text line that reserved no
// geometry, so a hard reload painted blank -> text -> data. These assert the
// placeholder actually reserves the body, and that the load is not silent.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import '@testing-library/jest-dom';
import en from '@/messages/en.json';

vi.mock('@/app/components/LanguageProvider', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

import PlaceDetailSkeleton from '@/app/places/view/PlaceDetailSkeleton';

function renderSkeleton() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PlaceDetailSkeleton />
    </NextIntlClientProvider>,
  );
}

describe('PlaceDetailSkeleton', () => {
  it('announces the load instead of being silent to a screen reader', () => {
    renderSkeleton();

    // Every bar is aria-hidden, so without this the load says nothing at all —
    // the bare text line it replaced at least announced itself.
    const status = screen.getByRole('status', { name: en.places.loading });

    expect(status).toHaveAttribute('aria-busy', 'true');
  });

  it('reserves the map box, which is the tallest thing on the page', () => {
    const { container } = renderSkeleton();

    // 280px matches the loaded LocationMap height in PlaceDetailView; if that
    // changes and this does not, the page starts reflowing again.
    expect(container.querySelector('.h-\\[280px\\]')).toBeInTheDocument();
  });

  it('reserves both body columns, not just the left one', () => {
    const { container } = renderSkeleton();

    const grid = container.querySelector('[role="status"]');

    expect(grid?.className).toContain('lg:grid-cols-[minmax(0,1.4fr)_1fr]');
  });

  it('reserves several person rows rather than a single bar', () => {
    const { container } = renderSkeleton();

    // A one-row placeholder would still let the card grow by hundreds of px.
    expect(container.querySelectorAll('.rounded-full').length).toBeGreaterThanOrEqual(5);
  });

  it('hides every decorative bar from assistive tech', () => {
    const { container } = renderSkeleton();

    const bars = container.querySelectorAll('.skeleton');

    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) expect(bar).toHaveAttribute('aria-hidden', 'true');
  });
});
