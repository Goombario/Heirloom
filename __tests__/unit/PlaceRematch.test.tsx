/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const fetchCandidates = vi.fn();
vi.mock('@/lib/geocode/photon', () => ({
  fetchCandidates: (...args: unknown[]) => fetchCandidates(...args),
}));

const geocodingEnabled = vi.fn(() => true);
vi.mock('@/lib/geocode/prefs', () => ({
  isGeocodingEnabled: () => geocodingEnabled(),
  getGeocodingChoice: () => (geocodingEnabled() ? 'on' : 'off'),
  subscribeGeocodingChoice: () => () => {},
  setGeocodingEnabled: vi.fn(),
}));

import PlaceRematch from '@/app/places/view/PlaceRematch';

function candidate(name: string) {
  return {
    props: { name },
    result: { name, displayName: name, lat: 51.1, lng: 1.3, osmType: 'relation', osmId: 1, countryCode: 'GB' },
  };
}

describe('PlaceRematch — correcting a bad geocoder match (#447)', () => {
  beforeEach(() => {
    fetchCandidates.mockReset();
    geocodingEnabled.mockReturnValue(true);
  });

  it('searches the current place name as soon as it opens — that is the question being asked', async () => {
    const user = userEvent.setup();
    fetchCandidates.mockResolvedValue([candidate('Dover, Kent, England')]);
    render(<PlaceRematch placeName="Dover" onPick={() => {}} />);

    await user.click(screen.getByRole('button', { name: /rematch/ }));
    await waitFor(() => expect(fetchCandidates).toHaveBeenCalled());
    expect(fetchCandidates.mock.calls[0][0]).toBe('Dover');
    expect(await screen.findByText('Dover, Kent, England')).toBeInTheDocument();
  });

  it('hands the picked candidate back whole and closes', async () => {
    const user = userEvent.setup();
    const picked = candidate('Dover, Delaware, United States');
    fetchCandidates.mockResolvedValue([picked]);
    const onPick = vi.fn();
    render(<PlaceRematch placeName="Dover" onPick={onPick} />);

    await user.click(screen.getByRole('button', { name: /rematch/ }));
    await user.click(await screen.findByText('Dover, Delaware, United States'));

    // The WHOLE candidate, not just its name: the caller needs the coordinates and
    // the OSM ids to rewrite the provenance as one unit.
    expect(onPick).toHaveBeenCalledWith(picked);
    expect(screen.queryByText('Dover, Delaware, United States')).toBeNull();
    // Focus returns to the trigger rather than falling to <body>.
    expect(screen.getByRole('button', { name: /rematch/ })).toHaveFocus();
  });

  it('says so instead of searching when geocoding is turned off', async () => {
    const user = userEvent.setup();
    geocodingEnabled.mockReturnValue(false);
    render(<PlaceRematch placeName="Dover" onPick={() => {}} />);

    await user.click(screen.getByRole('button', { name: /rematch/ }));
    expect(await screen.findByText('rematch_geocoding_off')).toBeInTheDocument();
    expect(fetchCandidates).not.toHaveBeenCalled();
  });

  it('reports a failed search rather than showing it as "no matches"', async () => {
    const user = userEvent.setup();
    fetchCandidates.mockRejectedValue(new Error('network'));
    render(<PlaceRematch placeName="Dover" onPick={() => {}} />);

    await user.click(screen.getByRole('button', { name: /rematch/ }));
    // The SEARCH failed — nothing was written, so this must not claim the place
    // could not be re-matched. That copy belongs to the caller's write path.
    expect(await screen.findByText('rematch_search_failed')).toBeInTheDocument();
    expect(screen.queryByText('rematch_failed')).toBeNull();
  });

  it('asks for more characters instead of advising a SHORTER search it cannot run', async () => {
    const user = userEvent.setup();
    render(<PlaceRematch placeName="Ur" onPick={() => {}} />);

    await user.click(screen.getByRole('button', { name: /rematch/ }));
    expect(await screen.findByText('rematch_type_more')).toBeInTheDocument();
    expect(screen.queryByText('rematch_no_results')).toBeNull();
    expect(fetchCandidates).not.toHaveBeenCalled();
  });

  it('keeps Escape inside the picker — the form behind it must not also close', async () => {
    const user = userEvent.setup();
    fetchCandidates.mockResolvedValue([candidate('Dover, Kent, England')]);
    // Stands in for PlaceDetailView's own document-level Escape handler, which
    // cancels editing and discards the buffered coordinates.
    const onDocumentEscape = vi.fn();
    document.addEventListener('keydown', onDocumentEscape);
    try {
      render(<PlaceRematch placeName="Dover" onPick={() => {}} />);
      await user.click(screen.getByRole('button', { name: /rematch/ }));
      await screen.findByText('Dover, Kent, England');
      onDocumentEscape.mockClear();

      await user.keyboard('{Escape}');

      expect(screen.queryByText('Dover, Kent, England')).toBeNull();
      expect(onDocumentEscape).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', onDocumentEscape);
    }
  });

  it('cannot be re-picked while a write is in flight', async () => {
    const user = userEvent.setup();
    fetchCandidates.mockResolvedValue([candidate('Dover, Kent, England')]);
    render(<PlaceRematch placeName="Dover" onPick={() => {}} busy />);

    expect(screen.getByRole('button', { name: /rematch/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /rematch/ }));
    expect(fetchCandidates).not.toHaveBeenCalled();
  });
});
