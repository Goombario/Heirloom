/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars && 'count' in vars ? `${key}:${vars.count}` : key,
}));

// The panel formats dates through the shared formatter, which needs the active
// locale. Stubbed rather than wrapped in LanguageProvider so this stays a focused
// test of the fetch/render behaviour below.
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

import { ExploreDetail } from '@/app/places/explore/ExploreDetail';

/**
 * REGRESSION GUARD (Places → Explore, "0 people linked").
 *
 * `treeId` is null for the user's DEFAULT tree — the normal case, since the
 * server resolves null to the real tree. The multi-tree rename in 44aa63a turned
 * a valid `ownerId` truthiness check (ownerId was always set once the session
 * resolved) into `placeName && treeId ? … : null`, which meant the detail panel
 * only ever fetched for users who had explicitly switched to a non-default or
 * shared tree. Everyone else got a null cache key, so `useCachedResource`
 * short-circuited, no request was made at all, and the panel rendered
 * "0 people linked / no people recorded" — while the list beside the map still
 * showed the correct avatars and counts, because that comes from a separate,
 * non-tree-gated `places.list` call.
 *
 * The "no request is ever made" part is the real tell, so that is what these
 * assert — not merely that people eventually render.
 */
describe('ExploreDetail — default tree (treeId = null)', () => {
  beforeEach(() => {
    detail.mockReset();
    detail.mockResolvedValue({
      name: 'Dover',
      people: [
        { Id: 1, FirstName: 'Dorothy', LastName: 'Bramley', Sex: 'F', role: 'born', BirthDate: '1913', DeathDate: null, PrimaryMediaId: null, FocalX: null, FocalY: null, FocalRadius: null },
        { Id: 2, FirstName: 'Peggy', LastName: 'Bramley', Sex: 'F', role: 'born', BirthDate: '1917', DeathDate: null, PrimaryMediaId: null, FocalX: null, FocalY: null, FocalRadius: null },
      ],
      // The pane renders factLinks (one entry per person, each fact with its
      // reason), so the payload carries them alongside the people list.
      // `placeName` is the place the fact itself holds — equal to the selected
      // place for a leaf like Dover, so no sub-place suffix is rendered.
      factLinks: [
        { personId: 1, name: 'Dorothy Bramley', sex: 'F', primaryMediaId: null, kind: 'birth', eventType: null, date: '1913', placeName: 'Dover' },
        { personId: 2, name: 'Peggy Bramley', sex: 'F', primaryMediaId: null, kind: 'birth', eventType: null, date: '1917', placeName: 'Dover' },
      ],
      eventCounts: [],
      eventCount: 0,
      familyCount: 0,
      latitude: null,
      longitude: null,
      displayName: null,
      id: 93,
      form: null,
      parents: [],
      children: [],
    });
  });

  it('fetches the place detail even though treeId is null', async () => {
    render(<ExploreDetail placeName="Dover" treeId={null} />);
    await waitFor(() => expect(detail).toHaveBeenCalled());
    // …and forwards the null through rather than blocking on it.
    expect(detail).toHaveBeenCalledWith('Dover', null);
  });

  it('renders the linked people instead of the empty state', async () => {
    const { container } = render(<ExploreDetail placeName="Dover" treeId={null} />);
    await waitFor(() =>
      expect(container.querySelectorAll('a[href^="/people/view?id="]').length).toBe(2),
    );
    expect(screen.queryByText('no_people_recorded')).not.toBeInTheDocument();
  });

  it('still fetches for an explicitly selected non-default tree', async () => {
    render(<ExploreDetail placeName="Dover" treeId={7} />);
    await waitFor(() => expect(detail).toHaveBeenCalledWith('Dover', 7));
  });

  it('does not fetch when no place is selected', async () => {
    render(<ExploreDetail placeName={null} treeId={null} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(detail).not.toHaveBeenCalled();
  });
});
