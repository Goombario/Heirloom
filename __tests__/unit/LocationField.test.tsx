/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import LocationField from '@/app/components/LocationField';

// The tree's places for the picker (#1186) are their own suite
// (place-picker.test.tsx); here the field has none, so only the map is asked.
vi.mock('@/app/components/useTreePlaceOptions', () => ({ useTreePlaceOptions: () => undefined }));

vi.mock('@/lib/geocode/prefs', () => ({
  isGeocodingEnabled: () => true,
  getGeocodingChoice: () => 'on',
  subscribeGeocodingChoice: () => () => {},
  setGeocodingEnabled: vi.fn(),
}));

// Mock next-intl — not testing translations here. Interpolates {placeholders}
// the way real next-intl does so "Map pinned to {place}" resolves.
const translations: Record<string, string> = {
  map_pinned_to: 'Map pinned to {place}',
  edit: 'Edit',
  set_map_pin: 'Set a map pin',
  search_placeholder: 'Search for a different place…',
  enter_coords_link: 'Enter coordinates',
  coords_label: 'Coordinates',
  invalid_coords: 'Invalid coordinates',
  remove_pin_link: 'Remove pin',
  back_to_search: 'Back to search',
  coords_placeholder: 'e.g. 40.6782, -73.9442',
  save: 'Save',
};
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    let out = translations[key] ?? key;
    if (values) {
      for (const [k, v] of Object.entries(values)) out = out.replace(`{${k}}`, String(v));
    }
    return out;
  },
}));

function mockPhotonOnce(features: unknown[]) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => ({ type: 'FeatureCollection', features }) });
}

function mockPickerFetch(features: unknown[]) {
  return vi.fn().mockImplementation(async (input: unknown) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url;
    if (url.startsWith('/api/places/geocode/dependents')) {
      return { ok: true, json: async () => ({ count: 0 }) };
    }
    if (url.startsWith('https://photon.komoot.io/api/')) {
      return { ok: true, json: async () => ({ type: 'FeatureCollection', features }) };
    }
    throw new Error(`Unexpected test request: ${url}`);
  });
}

async function flushDebouncedSearch() {
  await act(async () => { await vi.runOnlyPendingTimersAsync(); });
}

describe('LocationField', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('never overwrites the typed text, even on a confident resolve', async () => {
    vi.stubGlobal('fetch', mockPhotonOnce([{
      geometry: { type: 'Point', coordinates: [1.2416, 51.1048] },
      properties: { housenumber: '67', street: 'Folkestone Road', city: 'Dover', county: 'Kent', state: 'England', country: 'United Kingdom' },
    }]));
    const user = userEvent.setup();
    const onChange = vi.fn();
    // A real controlled input needs its `value` fed back from `onChange`, or React
    // resets the DOM to the (unchanged) prop value after every keystroke — this
    // wrapper mirrors how every real caller (Tasks 11-13) will wire the field.
    function Wrapper() {
      const [value, setValue] = useState('');
      return (
        <LocationField
          value={value}
          onChange={(v) => { setValue(v); onChange(v); }}
        />
      );
    }
    render(<Wrapper />);
    const input = screen.getByRole('combobox');
    await user.type(input, '67 Folkestone Road, Dover, Kent, England');
    // onChange is called once per keystroke with the literal typed value — never
    // with anything derived from a geocode result.
    for (const call of onChange.mock.calls) {
      expect(call[0].startsWith('6')).toBe(true); // every call is a prefix of what was typed
    }
    expect(onChange).toHaveBeenLastCalledWith('67 Folkestone Road, Dover, Kent, England');
  });

  it('shows a "Map pinned to" badge naming the resolved ancestor after typing triggers a fallback resolve', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) }) // full string fails
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [{ geometry: { type: 'Point', coordinates: [1.2416, 51.1048] }, properties: { city: 'Dover', county: 'Kent', state: 'England', country: 'United Kingdom' } }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const onResolve = vi.fn();
    function Wrapper() {
      const [value, setValue] = useState('');
      return <LocationField value={value} onChange={setValue} onResolve={onResolve} />;
    }
    render(<Wrapper />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '67 Folkestone Road, Dover, Kent, England' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); }); // past DEBOUNCE_MS
    await waitFor(() => expect(screen.getByText(/Map pinned to/)).toBeInTheDocument());
    // Badge now names the geocoder's canonical name (displayName), which omits the
    // county — not the raw typed text or the hierarchy node's bare name.
    expect(screen.getByText(/Dover, England, United Kingdom/)).toBeInTheDocument();
    expect(onResolve).toHaveBeenCalled();
  });

  it('mounting with a pre-populated value does not trigger a live resolve — only typing does', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<LocationField value="Dover, Kent, England" onChange={() => {}} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Map pinned to/)).not.toBeInTheDocument();
  });

  it('shows no badge when nothing resolves', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) }));
    function Wrapper() {
      const [value, setValue] = useState('');
      return <LocationField value={value} onChange={setValue} />;
    }
    render(<Wrapper />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Nowhere Real, Nonexistentshire' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await waitFor(() => expect(screen.queryByText(/Map pinned to/)).not.toBeInTheDocument());
  });

  it('Edit opens a picker; selecting a result sets the leaf\'s own pin and never touches the typed text', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockPickerFetch([
      { geometry: { type: 'Point', coordinates: [1.1838, 51.0835] }, properties: { name: 'Foord', locality: 'Foord', city: 'Folkestone', county: 'Kent', state: 'England', country: 'United Kingdom' } },
    ]));
    const onChange = vi.fn();
    const onResolve = vi.fn();
    render(<LocationField value="Dover, Kent, England" onChange={onChange} onResolve={onResolve} treeId={1} />);
    fireEvent.click(screen.getByRole('button', { name: /edit|set a map pin/i }));
    const search = screen.getByPlaceholderText(/search for a different place/i);
    fireEvent.change(search, { target: { value: 'Foord, Folkestone' } });
    await flushDebouncedSearch();
    expect(screen.getByText(/Foord/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Foord/));
    expect(onChange).not.toHaveBeenCalled(); // the typed field text is never touched by a pick
    const lastChain = onResolve.mock.calls[onResolve.mock.calls.length - 1][0] as { name: string; latitude: number | null }[];
    expect(lastChain[lastChain.length - 1]).toMatchObject({ name: 'Dover, Kent, England', latitude: 51.0835 });
  });

  it('clears a picked pin as soon as the place text changes', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockPickerFetch([
      { geometry: { type: 'Point', coordinates: [-78.9, 43.9] }, properties: { name: 'Oshawa', city: 'Oshawa', state: 'Ontario', country: 'Canada' } },
    ]));
    const onResolve = vi.fn();
    function Wrapper() {
      const [value, setValue] = useState('Oshawa');
      return <LocationField value={value} onChange={setValue} onResolve={onResolve} />;
    }
    render(<Wrapper />);
    fireEvent.click(screen.getByRole('button', { name: /edit|set a map pin/i }));
    fireEvent.change(screen.getByPlaceholderText(/search for a different place/i), { target: { value: 'Oshawa' } });
    await flushDebouncedSearch();
    fireEvent.click(screen.getByText(/Oshawa, Ontario, Canada/));
    expect(screen.getByText(/Map pinned to Oshawa/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Lakeridge Health, Oshawa' } });
    expect(screen.queryByText(/Map pinned to/)).not.toBeInTheDocument();
    expect(onResolve).toHaveBeenLastCalledWith(undefined);
  });

  it('Remove pin clears an existing badge and queues a suppression, distinct from a pick', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockPickerFetch([
      { geometry: { type: 'Point', coordinates: [1.1838, 51.0835] }, properties: { name: 'Foord', city: 'Folkestone', county: 'Kent', state: 'England', country: 'United Kingdom' } },
    ]));
    const onRemove = vi.fn();
    const onChange = vi.fn();
    render(<LocationField value="Dover, Kent, England" onChange={onChange} onRemove={onRemove} treeId={1} />);
    // Give it a pin first via a pick, so there's something for Remove to clear.
    fireEvent.click(screen.getByRole('button', { name: /edit|set a map pin/i }));
    fireEvent.change(screen.getByPlaceholderText(/search for a different place/i), { target: { value: 'Foord' } });
    await flushDebouncedSearch();
    expect(screen.getByText(/Foord/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Foord/));
    expect(screen.getByText(/Map pinned to/)).toBeInTheDocument();
    // An explicit pick always becomes the leaf's own pin — solid dot, not the
    // dashed-diamond "inherited" shape (covered by the shape-differentiation test below).
    expect(document.querySelector('[data-pin-kind]')).toHaveAttribute('data-pin-kind', 'own');
    // Now remove it.
    fireEvent.click(screen.getByRole('button', { name: /edit|set a map pin/i }));
    fireEvent.click(screen.getByText(/Remove pin/i));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled(); // Remove pin never touches the typed text either
    expect(screen.queryByText(/Map pinned to/)).not.toBeInTheDocument();
  });

  it('treats a value too short to resolve as "no pending change" (undefined), not an explicit removal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) }));
    const onResolve = vi.fn();
    function Wrapper() {
      const [value, setValue] = useState('');
      return <LocationField value={value} onChange={setValue} onResolve={onResolve} />;
    }
    render(<Wrapper />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ab' } }); // < 3 chars, never queries Photon
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(onResolve).toHaveBeenLastCalledWith(undefined);
  });

  it('treats a transient resolve failure as "no pending change" (undefined), not an explicit removal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const onResolve = vi.fn();
    function Wrapper() {
      const [value, setValue] = useState('');
      return <LocationField value={value} onChange={setValue} onResolve={onResolve} />;
    }
    render(<Wrapper />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Dover, Kent, England' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(onResolve).toHaveBeenLastCalledWith(undefined);
  });

  it('marks an own pin (solid dot) differently from an inherited pin (dashed diamond) — shape, not color, per the colorblind requirement', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Inherited: full-string match fails, falls back to the county/country level.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [{ geometry: { type: 'Point', coordinates: [1.2416, 51.1048] }, properties: { city: 'Dover', county: 'Kent', state: 'England', country: 'United Kingdom' } }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    function Wrapper() {
      const [value, setValue] = useState('');
      return <LocationField value={value} onChange={setValue} />;
    }
    render(<Wrapper />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '67 Folkestone Road, Dover, Kent, England' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await waitFor(() => expect(screen.getByText(/Map pinned to/)).toBeInTheDocument());
    const marker = document.querySelector('[data-pin-kind]');
    expect(marker).toHaveAttribute('data-pin-kind', 'inherited');
  });

  it('shows the badge immediately when mounted with an already-saved initialChain whose leaf owns the pin — no Photon fetch, canonical displayName, own marker', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <LocationField
        value="Dover, Kent, England"
        onChange={() => {}}
        initialChain={[
          { name: 'United Kingdom', latitude: null, longitude: null, pinSuppressed: false },
          { name: 'England', latitude: null, longitude: null, pinSuppressed: false },
          { name: 'Dover, Kent, England, United Kingdom', latitude: 51.1048, longitude: 1.2416, pinSuppressed: false, displayName: 'Dover, England, United Kingdom' },
        ]}
      />
    );
    await waitFor(() => expect(screen.getByText(/Map pinned to/)).toBeInTheDocument());
    // Badge names the leaf's canonical displayName, flowing through the SAME
    // resolvePin the live path uses — not the raw typed value.
    expect(screen.getByText(/Map pinned to Dover, England, United Kingdom/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-pin-kind]')).toHaveAttribute('data-pin-kind', 'own');
  });

  it('mounted with an initialChain whose leaf has null coords badges the ancestor that owns the pin, as inherited', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <LocationField
        value="67 Folkestone Road, Dover, Kent, England"
        onChange={() => {}}
        initialChain={[
          { name: 'United Kingdom', latitude: null, longitude: null, pinSuppressed: false },
          { name: 'Kent', latitude: 51.2, longitude: 0.5, pinSuppressed: false, displayName: 'Kent, England, United Kingdom' },
          { name: '67 Folkestone Road, Dover', latitude: null, longitude: null, pinSuppressed: false },
        ]}
      />
    );
    await waitFor(() => expect(screen.getByText(/Map pinned to/)).toBeInTheDocument());
    // The leaf owns no coordinate; resolvePin walks up to Kent, so the badge names
    // the ANCESTOR's displayName and the marker is the inherited (dashed-diamond) shape.
    expect(screen.getByText(/Map pinned to Kent, England, United Kingdom/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-pin-kind]')).toHaveAttribute('data-pin-kind', 'inherited');
  });

  it('an own pin whose canonical displayName differs from the typed value still renders data-pin-kind="own" (marker decoupled from the badge string)', async () => {
    // Regression guard for the old `pin.source === value.trim()` derivation: with a
    // canonical displayName in the badge, that string-compare is false for a genuine
    // own pin and would silently flip the marker to "inherited" — a colorblind
    // accessibility regression (shape, not color, conveys own-vs-inherited).
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <LocationField
        value="London"
        onChange={() => {}}
        initialChain={[
          { name: 'London', latitude: 51.5074, longitude: -0.1278, pinSuppressed: false, displayName: 'London, England, United Kingdom' },
        ]}
      />
    );
    await waitFor(() => expect(screen.getByText(/Map pinned to London, England, United Kingdom/)).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-pin-kind]')).toHaveAttribute('data-pin-kind', 'own');
  });

  it('typing after an initialChain-seeded badge triggers a live resolve that supersedes the seed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{
          geometry: { type: 'Point', coordinates: [1.1838, 51.0835] },
          properties: { housenumber: '1', street: 'High Street', city: 'Folkestone', county: 'Kent', state: 'England', country: 'United Kingdom' },
        }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    function Wrapper() {
      const [value, setValue] = useState('Dover, Kent, England');
      return (
        <LocationField
          value={value}
          onChange={setValue}
          initialChain={[
            { name: 'Dover, Kent, England, United Kingdom', latitude: 51.1048, longitude: 1.2416, pinSuppressed: false, displayName: 'Dover, England, United Kingdom' },
          ]}
        />
      );
    }
    render(<Wrapper />);
    await waitFor(() => expect(screen.getByText(/Map pinned to Dover, England, United Kingdom/)).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1 High Street, Folkestone, Kent, England' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    // The live resolve supersedes the seed: the badge now names the resolved place
    // (Folkestone) and the seed (Dover) is gone.
    await waitFor(() => expect(screen.getByText(/Map pinned to .*Folkestone/)).toBeInTheDocument());
    expect(screen.queryByText(/Dover/)).not.toBeInTheDocument();
  });

  it('typing then clearing back below the resolve threshold does not resurrect the initialChain-seeded badge', async () => {
    function Wrapper() {
      const [value, setValue] = useState('Dover, Kent, England');
      return (
        <LocationField
          value={value}
          onChange={setValue}
          initialChain={[
            { name: 'Dover, Kent, England, United Kingdom', latitude: 51.1048, longitude: 1.2416, pinSuppressed: false, displayName: 'Dover, England, United Kingdom' },
          ]}
        />
      );
    }
    render(<Wrapper />);
    await waitFor(() => expect(screen.getByText(/Map pinned to Dover, England, United Kingdom/)).toBeInTheDocument());
    // < 3 chars short-circuits handleChange before any resolve — this is the one
    // path where `userTouched` alone (not a fresh `levels` value) must suppress
    // the seed, since the `initialChain` prop is still present and unchanged.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Do' } });
    await waitFor(() => expect(screen.queryByText(/Map pinned to/)).not.toBeInTheDocument());
  });

  it('Escape closes the Edit popover', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 0 }) }));
    render(<LocationField value="Dover, Kent, England" onChange={() => {}} treeId={1} />);
    await user.click(screen.getByRole('button', { name: /edit|set a map pin/i }));
    expect(screen.getByPlaceholderText(/search for a different place/i)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByPlaceholderText(/search for a different place/i)).not.toBeInTheDocument());
  });

  it('a click outside closes the Edit popover, but a click on the trigger does not reopen-then-close it', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 0 }) }));
    render(
      <div>
        <span data-testid="outside">elsewhere</span>
        <LocationField value="Dover, Kent, England" onChange={() => {}} treeId={1} />
      </div>
    );
    await user.click(screen.getByRole('button', { name: /edit|set a map pin/i }));
    expect(screen.getByPlaceholderText(/search for a different place/i)).toBeInTheDocument();
    await user.click(screen.getByTestId('outside'));
    await waitFor(() => expect(screen.queryByPlaceholderText(/search for a different place/i)).not.toBeInTheDocument());
    // Trigger still toggles cleanly after an outside-close.
    await user.click(screen.getByRole('button', { name: /edit|set a map pin/i }));
    expect(screen.getByPlaceholderText(/search for a different place/i)).toBeInTheDocument();
  });

  it('the popover shows no title, no reassurance line and no Close link — just search + two footer actions', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 0 }) }));
    render(<LocationField value="Dover, Kent, England" onChange={() => {}} treeId={1} />);
    await user.click(screen.getByRole('button', { name: /edit|set a map pin/i }));
    expect(screen.getByPlaceholderText(/search for a different place/i)).toBeInTheDocument();
    expect(screen.getByText('Enter coordinates')).toBeInTheDocument();
    expect(screen.getByText('Remove pin')).toBeInTheDocument();
    expect(screen.queryByText(/Where should this pin go/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/place name is not affected/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Close$/i })).not.toBeInTheDocument();
  });

  it('the badge stays visible while the popover is open, so the current pin is never hidden', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 0 }) }));
    render(
      <LocationField
        value="Dover, Kent, England"
        onChange={() => {}}
        treeId={1}
        initialChain={[{ name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2, pinSuppressed: false, displayName: 'Dover, England, United Kingdom' }]}
      />
    );
    await waitFor(() => expect(screen.getByText(/Map pinned to Dover, England, United Kingdom/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /edit|set a map pin/i }));
    expect(screen.getByPlaceholderText(/search for a different place/i)).toBeInTheDocument();
    expect(screen.getByText(/Map pinned to Dover, England, United Kingdom/)).toBeInTheDocument();
  });

  it('shows no pin chrome until something is pinned — a bare "Set a map pin" link, not an EDIT badge', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) }));
    function Wrapper() {
      const [value, setValue] = useState('');
      return <LocationField value={value} onChange={setValue} />;
    }
    render(<Wrapper />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Nowhere Real, Nonexistentshire' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await waitFor(() => expect(screen.queryByText(/Map pinned to/)).not.toBeInTheDocument());
    // No badge, and no bare EDIT beside nothing — but the popover stays reachable,
    // because manual lat/lng is the only recourse for a place Photon can't resolve.
    expect(screen.getByText('Set a map pin')).toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });

  it('gives the Set a map pin trigger a 44px coarse-pointer hit area', () => {
    render(<LocationField value="Dover, Kent, England" onChange={() => {}} />);

    expect(screen.getByRole('button', { name: 'Set a map pin' })).toHaveClass(
      '[@media(pointer:coarse)]:min-h-[44px]',
    );
  });

  it('a candidate is selectable with the keyboard, not just the mouse', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockPickerFetch([
      { geometry: { type: 'Point', coordinates: [1.1838, 51.0835] }, properties: { name: 'Foord', city: 'Folkestone', county: 'Kent', state: 'England', country: 'United Kingdom' } },
    ]));
    const onResolve = vi.fn();
    render(<LocationField value="Dover, Kent, England" onChange={() => {}} onResolve={onResolve} treeId={1} />);
    fireEvent.click(screen.getByRole('button', { name: /edit|set a map pin/i }));
    fireEvent.change(screen.getByPlaceholderText(/search for a different place/i), { target: { value: 'Foord' } });
    await flushDebouncedSearch();
    expect(screen.getByRole('button', { name: /Foord/ })).toBeInTheDocument();
    vi.useRealTimers();
    const user = userEvent.setup();
    // Focus the candidate and activate it the way a keyboard user would. This fails
    // if the row is wired to onMouseDown, which a keyboard Enter never fires.
    screen.getByRole('button', { name: /Foord/ }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onResolve).toHaveBeenCalled());
    const lastChain = onResolve.mock.calls[onResolve.mock.calls.length - 1][0] as { name: string; latitude: number | null }[];
    expect(lastChain[lastChain.length - 1]).toMatchObject({ name: 'Dover, Kent, England', latitude: 51.0835 });
  });
});
