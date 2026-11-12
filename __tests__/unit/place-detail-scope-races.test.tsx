/** @vitest-environment happy-dom */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import type { PlaceDetail } from '@/lib/data/types';

let placeName = 'Alpha';
let placeId: string | null = null;
const replace = vi.fn();
const geocodeUpsert = vi.fn();
const updateCoordinates = vi.fn();
const rename = vi.fn();
const detail = vi.fn();
const list = vi.fn();
const redirectIfUnauthorized = vi.hoisted(() => vi.fn().mockReturnValue(false));

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => key === 'name' ? placeName : key === 'id' ? placeId : null }),
  useRouter: () => ({ push: vi.fn(), replace }),
}));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/contexts/TreeContext', () => ({
  useTree: () => ({ activeTreeId: 1, activePermission: 'owner', currentUserId: 1 }),
}));
vi.mock('@/lib/data', () => ({
  getDataClient: async () => ({ places: { detail, list, geocodeUpsert, updateCoordinates, rename } }),
}));
vi.mock('@/app/components/useErrorToast', () => ({
  useErrorToast: () => ({ redirectIfUnauthorized, reportError: vi.fn() }),
}));
vi.mock('@/app/components/useLoadPhase', () => ({
  useLoadPhase: (loading: boolean) => loading ? 'loading' : 'loaded',
}));
vi.mock('@/lib/data/cache', () => ({ dataCache: { get: vi.fn(), set: vi.fn() } }));
vi.mock('@/lib/places/prefetch', () => ({
  placeDetailKey: (treeId: number | null, place: string | number) => `${treeId ?? 'default'}:${place}`,
  usePrefetchPlaceDetail: () => vi.fn(),
}));
vi.mock('@/lib/media/warmThumbnails', () => ({ warmThumbnails: vi.fn() }));
vi.mock('@/app/components/LocationMap', () => ({ default: () => null }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => null }));
vi.mock('@/app/components/notes/OwnerNotesCard', () => ({
  OwnerNotesCard: () => null,
  NoteCount: () => null,
}));
vi.mock('@/app/places/PinMark', () => ({ PinMark: () => null }));
// The phone page renders alongside (CSS picks one); these races are the desktop edit's.
vi.mock('@/app/places/view/mobile/MobilePlacePage', () => ({ MobilePlacePage: () => null, MobilePlaceSkeleton: () => null }));

import PlaceDetailClient from '@/app/places/view/PlaceDetailView';

function place(name: string, id?: number): PlaceDetail {
  return {
    name,
    ...(id != null ? { id } : {}),
    people: [],
    factLinks: [],
    eventCounts: [],
    eventCount: 1,
    familyCount: 0,
    latitude: 1,
    longitude: 2,
    displayName: `${name} display`,
    parents: [],
    children: [],
  };
}

describe('PlaceDetail scope races', () => {
  beforeEach(() => {
    placeName = 'Alpha';
    placeId = null;
    vi.clearAllMocks();
    detail.mockImplementation(async (name: string) => place(name));
    list.mockResolvedValue({ places: [] });
    rename.mockResolvedValue(undefined);
  });

  it('opens a place reached by a name, another of its names included, under its id (#1167, #1186)', async () => {
    placeName = 'Lemberg';
    detail.mockImplementation(async () => place('Lviv', 7));
    render(<PlaceDetailClient />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/places/view?id=7'));
  });

  it('opened by id, loads and edits that place by id (#1186)', async () => {
    placeName = '';
    placeId = '7';
    detail.mockImplementation(async () => place('Paris', 7));
    const user = userEvent.setup();
    render(<PlaceDetailClient />);
    await screen.findByRole('heading', { name: 'Paris' });
    expect(detail).toHaveBeenCalledWith(7, 1);
    await user.click(screen.getByRole('button', { name: 'more_actions_for' }));
    await user.click(screen.getByRole('menuitem', { name: 'rename_or_merge' }));
    await user.click(screen.getAllByRole('button', { name: 'save' })[0]!);
    await waitFor(() => expect(updateCoordinates).toHaveBeenCalledWith(7, 1, 2, 1));
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not apply an old-place save completion to the replacement scope', async () => {
    let resolveSave!: () => void;
    updateCoordinates.mockImplementationOnce(() => new Promise<void>(resolve => { resolveSave = resolve; }));
    const user = userEvent.setup();
    const view = render(<PlaceDetailClient />);

    await screen.findByRole('heading', { name: 'Alpha' });
    await user.click(screen.getByRole('button', { name: 'more_actions_for' }));
    await user.click(screen.getByRole('menuitem', { name: 'rename_or_merge' }));
    await user.click(screen.getAllByRole('button', { name: 'save' })[0]!);
    await waitFor(() => expect(updateCoordinates).toHaveBeenCalledWith('Alpha', 1, 2, 1));

    placeName = 'Beta';
    view.rerender(<PlaceDetailClient />);
    await screen.findByRole('heading', { name: 'Beta' });
    expect(screen.queryByRole('button', { name: 'save' })).not.toBeInTheDocument();

    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });

    expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
    expect(screen.queryByText('save_failed')).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('types coordinates from a pasted pair and saves them (#56)', async () => {
    placeName = '';
    placeId = '7';
    detail.mockImplementation(async () => place('Paris', 7));
    updateCoordinates.mockResolvedValue({ auditIds: [] });
    const user = userEvent.setup();
    render(<PlaceDetailClient />);
    await screen.findByRole('heading', { name: 'Paris' });
    await user.click(screen.getByRole('button', { name: 'fix_location' }));
    await user.click(screen.getByRole('menuitem', { name: 'fix_type' }));
    const lat = screen.getByLabelText('latitude');
    await user.clear(lat);
    await user.click(lat);
    await user.paste('48.8566, 2.3522');
    expect(screen.getByLabelText('longitude')).toHaveValue('2.3522');
    await user.click(screen.getByRole('button', { name: 'save_changes' }));
    await waitFor(() => expect(updateCoordinates).toHaveBeenCalledWith(7, 48.8566, 2.3522, 1));
  });
});
