/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import '@testing-library/jest-dom';
import en from '@/messages/en.json';

/**
 * The explore panel's person rows draw the shared `PersonAvatar`, but they used
 * to hand it a media id with NO focal crop — so `ProfileImage` fell back to a
 * centred object-cover and every row showed the whole photo squeezed into a 30px
 * disc instead of the face. These assert the two halves of the fix: the crop
 * reaches the image, and the thumbnails are warmed at that same crop's width.
 */
vi.mock('@/app/components/LanguageProvider', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

const detail = vi.fn();
vi.mock('@/lib/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data')>()),
  getDataClient: async () => ({ places: { detail } }) as unknown as Awaited<
    ReturnType<typeof import('@/lib/data').getDataClient>
  >,
}));

const warmThumbnails = vi.fn();
vi.mock('@/lib/media/warmThumbnails', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/media/warmThumbnails')>()),
  warmThumbnails: (...args: unknown[]) => warmThumbnails(...args),
}));

import { ExploreDetail } from '@/app/places/explore/ExploreDetail';

const HARRIET = {
  personId: 1,
  name: 'Harriet Bramley',
  sex: 'F',
  primaryMediaId: 5,
  focalX: 42,
  focalY: 30,
  focalRadius: 25,
  kind: 'birth',
  eventType: null,
  date: '1863',
  placeName: 'Mountnessing',
};

// A distinct place name per test: `useCachedResource` keys the shipped payload by
// place, and that cache outlives a render — reusing one name would serve the first
// test's people to the third.
function payload(name: string, factLinks: unknown[]) {
  return {
    name,
    people: [],
    factLinks,
    eventCounts: [],
    eventCount: 0,
    familyCount: 0,
    latitude: null,
    longitude: null,
    displayName: null,
    id: 1,
    form: null,
    parents: [],
    children: [],
  };
}

function renderDetail(place: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ExploreDetail placeName={place} treeId={3} />
    </NextIntlClientProvider>,
  );
}

describe('ExploreDetail — person avatars', () => {
  beforeEach(() => {
    detail.mockReset();
    warmThumbnails.mockReset();
    detail.mockImplementation(async (name: string) => payload(name, [HARRIET]));
  });

  it("requests the thumbnail at the focal crop's zoom, not the plain container width", async () => {
    // focalRadius 25 zooms 4x, so a 30px disc needs a 256px thumbnail
    // (30 * 2 * 4 = 240, snapped up). A row that lost the crop would ask for w=64
    // — the visible symptom being an uncropped photo, the wire symptom this width.
    const { container } = renderDetail('Mountnessing');

    await waitFor(() => {
      const srcs = Array.from(container.querySelectorAll('img')).map((i) => i.getAttribute('src'));
      expect(srcs).toContain('/api/media/5/file?treeId=3&w=256');
    });
  });

  it('warms the thumbnails as soon as the payload lands', async () => {
    renderDetail('Brentwood');

    // The effect also runs once on mount with no people yet (the panel renders
    // before its fetch resolves), so the payload's warm is the LAST call.
    await waitFor(() => expect(warmThumbnails.mock.calls.at(-1)?.[0]).toHaveLength(1));
    const [targets, opts] = warmThumbnails.mock.calls.at(-1)!;
    expect(targets).toEqual([{ mediaId: 5, focalRadius: 25 }]);
    expect(opts).toEqual({ containerWidth: 30, treeId: 3 });
  });

  it('still renders a person with no photo, warming nothing for them', async () => {
    detail.mockImplementation(async (name: string) => payload(name, [
      { ...HARRIET, personId: 2, name: 'Nell Bramley', primaryMediaId: null, focalX: null, focalY: null, focalRadius: null },
    ]));

    const { container } = renderDetail('Ingatestone');

    await waitFor(() => expect(warmThumbnails.mock.calls.at(-1)?.[0]).toHaveLength(1));
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(warmThumbnails.mock.calls.at(-1)![0]).toEqual([{ mediaId: null, focalRadius: null }]);
  });
});
