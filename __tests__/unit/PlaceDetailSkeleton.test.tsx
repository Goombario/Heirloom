/** @vitest-environment happy-dom */
// #392, #63 — /places/view rendered a centred "Loading" text line that reserved no
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

  it('reserves the v1.1 map cover at the loaded map height (#63)', () => {
    const { getByTestId } = renderSkeleton();

    // 340px matches the LocationMap height in PlaceCover; if that changes and
    // this does not, the page starts reflowing again.
    const cover = getByTestId('place-cover-skeleton');
    expect(cover).toHaveClass('place-cover');
    expect(cover.querySelector('.h-\\[340px\\]')).toBeInTheDocument();
    expect(cover.querySelector('.place-cover__foot')).toHaveClass('hero-dark');
  });

  it('reserves the sheet body and its rail, as the loaded DetailBody lays them out', () => {
    const { container } = renderSkeleton();

    const body = container.querySelector('.detail-body');
    expect(body).toHaveClass('place-body', 'detail-body--sheet', 'detail-body--rail');
    expect(body?.querySelector('.detail-body__rail')).toBeInTheDocument();
  });

  it('hides every decorative bar from assistive tech', () => {
    const { container } = renderSkeleton();

    const bars = container.querySelectorAll('.skeleton');

    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) expect(bar).toHaveAttribute('aria-hidden', 'true');
  });
});
