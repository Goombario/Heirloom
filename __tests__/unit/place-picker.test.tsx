/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import LocationField from '@/app/components/LocationField';
import type { PlaceOption } from '@/lib/places/place-options';

/**
 * The place picker (#1186): the tree's places in the place field, nothing
 * preselected, and leaving the field keeps the typed text.
 */

const option = (o: Partial<PlaceOption> & Pick<PlaceOption, 'placeId' | 'text'>): PlaceOption => ({
  placeName: o.text, parentName: null, displayName: null, count: 1, pinned: false, isOtherName: false, ...o,
});
const OPTIONS: PlaceOption[] = [
  option({ placeId: 2, text: 'Paris', parentName: 'France', count: 4, pinned: true }),
  option({ placeId: 4, text: 'Paris', parentName: 'Ontario', count: 1 }),
  option({ placeId: 5, text: 'Lviv', count: 3, pinned: true }),
  option({ placeId: 5, text: 'Lemberg', placeName: 'Lviv', count: 3, pinned: true, isOtherName: true }),
];
vi.mock('@/app/components/useTreePlaceOptions', () => ({ useTreePlaceOptions: () => OPTIONS }));

// The phone sheet renders only on a phone.
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));

// No map lookups: the tree's own places are what is under test.
vi.mock('@/lib/geocode/prefs', () => ({
  isGeocodingEnabled: () => false,
  getGeocodingChoice: () => 'off',
  subscribeGeocodingChoice: () => () => {},
  setGeocodingEnabled: vi.fn(),
}));

function Field({ initial = '', initialId = null, onPlaceId = vi.fn(), onSubmit = vi.fn(), variant }: {
  initial?: string; initialId?: number | null; onPlaceId?: (id: number | null) => void; onSubmit?: () => void; variant?: 'inline' | 'sheet';
}) {
  function Wrapper() {
    const [value, setValue] = useState(initial);
    const [placeId, setPlaceId] = useState<number | null>(initialId);
    return (
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <LocationField
          value={value}
          onChange={setValue}
          placeId={placeId}
          onPlaceIdChange={(id) => { setPlaceId(id); onPlaceId(id); }}
          treeId={1}
          label="Birth place"
          placeholder="Place"
          variant={variant}
        />
        <button type="button">Next</button>
      </form>
    );
  }
  return render(<NextIntlClientProvider locale="en" messages={en}><Wrapper /></NextIntlClientProvider>);
}

describe('place picker', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('lists the tree’s places under "In your tree", with nothing selected', async () => {
    const user = userEvent.setup();
    Field({});
    const box = screen.getByRole('combobox', { name: 'Birth place' });
    await user.type(box, 'Par');
    const list = screen.getByRole('listbox');
    expect(within(list).getByText('In your tree')).toBeInTheDocument();
    const rows = within(list).getAllByRole('option');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Part of France');
    expect(rows[1]).toHaveTextContent('Part of Ontario');
    expect(rows.every((r) => r.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(box).not.toHaveAttribute('aria-activedescendant');
  });

  it('links an exact name to its most-used place on Tab, and offers the other one', async () => {
    const user = userEvent.setup();
    const onPlaceId = vi.fn();
    Field({ onPlaceId });
    await user.type(screen.getByRole('combobox'), 'Paris');
    await user.tab();
    expect(onPlaceId).toHaveBeenLastCalledWith(2);
    expect(screen.getByText('Paris, part of France')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Not this Paris?' }));
    const ontario = within(screen.getByRole('listbox')).getAllByRole('option')[1];
    await user.click(ontario);
    expect(onPlaceId).toHaveBeenLastCalledWith(4);
    expect(screen.getByText('Paris, part of Ontario')).toBeInTheDocument();
  });

  it('keeps any other text as a new place', async () => {
    const user = userEvent.setup();
    const onPlaceId = vi.fn();
    Field({ onPlaceId });
    await user.type(screen.getByRole('combobox'), 'Toulouse');
    expect(screen.getByText(/Nothing in your tree matches/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('combobox')).toHaveValue('Toulouse');
    expect(onPlaceId).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('New place')).toBeInTheDocument();
  });

  it('says which place another name counts for', async () => {
    const user = userEvent.setup();
    const onPlaceId = vi.fn();
    Field({ onPlaceId });
    await user.type(screen.getByRole('combobox'), 'Lemberg');
    expect(within(screen.getByRole('listbox')).getByRole('option')).toHaveTextContent('Other name of Lviv');
    await user.tab();
    expect(onPlaceId).toHaveBeenLastCalledWith(5);
    expect(screen.getByText('Written as Lemberg · counts for Lviv')).toBeInTheDocument();
  });

  it('picks a row with the arrow keys and Enter, and Enter never submits the form', async () => {
    const user = userEvent.setup();
    const onPlaceId = vi.fn();
    const onSubmit = vi.fn();
    Field({ onPlaceId, onSubmit });
    const box = screen.getByRole('combobox');
    await user.type(box, 'Paris');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const rows = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(box).toHaveAttribute('aria-activedescendant', rows[1].id);
    expect(rows[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(onPlaceId).toHaveBeenLastCalledWith(4);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.type(box, ', Texas{Enter}');
    expect(box).toHaveValue('Paris, Texas');
    expect(onPlaceId).toHaveBeenLastCalledWith(null);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('closes the list on Escape and keeps the text', async () => {
    const user = userEvent.setup();
    Field({});
    const box = screen.getByRole('combobox');
    await user.type(box, 'Lv');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(box).toHaveValue('Lv');
  });

  it('shows the held place, not the most-used one, for a saved fact', () => {
    Field({ initial: 'Paris', initialId: 4 });
    expect(screen.getByText('Paris, part of Ontario')).toBeInTheDocument();
  });

  it('on a phone, opens a sheet and Done keeps what was typed', () => {
    const onPlaceId = vi.fn();
    Field({ onPlaceId, variant: 'sheet' });
    fireEvent.click(screen.getByRole('button', { name: 'Place' }));
    const box = screen.getByRole('combobox', { name: 'Birth place' });
    fireEvent.change(box, { target: { value: 'Lviv' } });
    expect(within(screen.getByRole('listbox')).getByRole('option')).toHaveTextContent('Lviv');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    // The sheet animates away; the row behind it now names the place.
    expect(screen.getByRole('button', { name: 'Lviv', hidden: true })).toHaveAttribute('aria-haspopup', 'dialog');
    expect(onPlaceId).toHaveBeenLastCalledWith(5);
  });
});
