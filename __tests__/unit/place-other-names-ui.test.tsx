/** @vitest-environment happy-dom */
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import type { PlaceGazetteerNode, PlaceOtherName, PlaceSummary } from '@/lib/data/types';

vi.mock('next-intl', () => {
  const t = (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key);
  t.rich = (key: string, values?: Record<string, unknown>) => {
    const plain = Object.fromEntries(Object.entries(values ?? {}).filter(([, v]) => typeof v !== 'function'));
    return `${key} ${JSON.stringify(plain)}`;
  };
  return { useTranslations: () => t };
});

import { buildPlaceNameIndex, checkOtherName, sortOtherNames } from '@/lib/places/other-names';
import { OtherNamesCard, OtherNamesEditor, RenameChoices, draftsBlocked, draftsChanged, draftsFor, draftsToSave, type NameDraft, type RenameChoice } from '@/app/places/view/OtherNames';
import { recordedAs } from '@/app/places/view/recordedAs';

/**
 * A place's other names on the place page (#1185): the order they list in, the
 * checks a new name goes through, and the editor's remove, Keep it and warnings.
 */

const name = (over: Partial<PlaceOtherName>): PlaceOtherName =>
  ({ id: 1, name: 'Lemberg', language: null, fromDate: null, toDate: null, records: 0, ...over });

const LVIV_NAMES = [
  name({ id: 4, name: 'Leopolis', language: 'Latin' }),
  name({ id: 2, name: 'Lwów', language: 'Polish', fromDate: '1918', toDate: '1939', records: 1 }),
  name({ id: 1, name: 'Lemberg', language: 'German', toDate: '1918', records: 4 }),
  name({ id: 3, name: 'Львів', language: 'Ukrainian' }),
];

const node = (id: number, n: string, otherNames?: string[]): PlaceGazetteerNode =>
  ({ id, name: n, parentId: null, latitude: null, longitude: null, displayName: null, pinSuppressed: false, ...(otherNames ? { otherNames } : {}) });
const summary = (id: number, n: string, count: number): PlaceSummary =>
  ({ id, name: n, count, parentId: null, peopleCount: count, faces: [] });

const INDEX = buildPlaceNameIndex({
  places: [summary(1, 'Lviv', 8), summary(2, 'Lwow', 2)],
  gazetteer: [node(1, 'Lviv', ['Lemberg']), node(2, 'Lwow'), node(3, 'Kraków', ['Krakau', 'Cracovia']), node(4, 'Ukraine')],
}, 1);

describe('other names model (#1185)', () => {
  it('lists dated names by year, then undated ones A to Z', () => {
    expect(sortOtherNames(LVIV_NAMES).map((n) => n.name)).toEqual(['Lemberg', 'Lwów', 'Leopolis', 'Львів']);
  });

  it('checks a name the way the server does, without case', () => {
    expect(checkOtherName('lviv', 'Lviv', [], INDEX)).toEqual({ kind: 'own' });
    expect(checkOtherName('lemberg ', 'Lviv', ['Lemberg'], INDEX)).toEqual({ kind: 'repeat', name: 'Lemberg' });
    expect(checkOtherName('KRAKAU', 'Lviv', [], INDEX)).toEqual({ kind: 'taken', name: 'Krakau', place: 'Kraków' });
    expect(checkOtherName('Lwow', 'Lviv', [], INDEX)).toEqual({ kind: 'merge', name: 'Lwow', id: 2, records: 2 });
    expect(checkOtherName('Ukraine', 'Lviv', [], INDEX)).toEqual({ kind: 'empty_place', name: 'Ukraine' });
    // The place's own names are not "another place's".
    expect(checkOtherName('Lemberg', 'Lviv', [], INDEX)).toBeNull();
    expect(checkOtherName('Leopolis', 'Lviv', [], null)).toBeNull();
  });

  it('saves kept and typed names, and leaves an untouched list unchanged', () => {
    const drafts = draftsFor(LVIV_NAMES);
    expect(draftsChanged(drafts, LVIV_NAMES)).toBe(false);
    const next: NameDraft[] = [...drafts.map((d) => (d.id === 4 ? { ...d, gone: true } : d)),
      { key: 'n', id: null, name: ' Lwiw ', language: '', fromDate: '', toDate: '', saved: null, records: 0, gone: false },
      { key: 'b', id: null, name: '', language: '', fromDate: '', toDate: '', saved: null, records: 0, gone: false }];
    expect(draftsChanged(next, LVIV_NAMES)).toBe(true);
    expect(draftsToSave(next).map((d) => [d.id, d.name])).toEqual([[1, 'Lemberg'], [2, 'Lwów'], [3, 'Львів'], [null, 'Lwiw']]);
    expect(draftsBlocked(next, 'Lviv', INDEX)).toBe(false);
    expect(draftsBlocked([...next, { ...next[4], key: 'x', name: 'Krakau' }], 'Lviv', INDEX)).toBe(true);
  });

  it('says a record was written under another name only for this very place', () => {
    const detail = { id: 1, name: 'Lviv' };
    expect(recordedAs({ placeId: 1, placeName: 'Lemberg' }, detail)).toBe('Lemberg');
    expect(recordedAs({ placeId: 1, placeName: 'Lviv' }, detail)).toBeNull();
    expect(recordedAs({ placeId: 9, placeName: 'Sykhiv' }, detail)).toBeNull();
  });
});

describe('other names on the page (#1185)', () => {
  it('lists each name with its meta and records, and gives editors an Add a name row (#1215)', async () => {
    const { rerender } = render(<OtherNamesCard names={LVIV_NAMES} canEdit={false} onAdd={() => {}} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.firstChild?.textContent)).toEqual(['Lemberg', 'Lwów', 'Leopolis', 'Львів']);
    expect(rows[0]).toHaveTextContent('German · other_name_until {"date":"1918"}');
    expect(rows[2]).toHaveTextContent('—');

    rerender(<OtherNamesCard names={[]} canEdit={false} onAdd={() => {}} />);
    expect(screen.queryByTestId('other-names-card')).toBeNull();
    const onAdd = vi.fn();
    rerender(<OtherNamesCard names={[]} canEdit onAdd={onAdd} />);
    expect(screen.queryByText('other_names_empty')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'add_a_name' }));
    expect(onAdd).toHaveBeenCalled();
    // Editors keep the row once names exist; viewers never see it.
    rerender(<OtherNamesCard names={LVIV_NAMES} canEdit onAdd={onAdd} />);
    expect(screen.getByRole('button', { name: 'add_a_name' })).toBeInTheDocument();
    rerender(<OtherNamesCard names={LVIV_NAMES} canEdit={false} onAdd={onAdd} />);
    expect(screen.queryByRole('button', { name: 'add_a_name' })).toBeNull();
  });

  function Editor({ initial }: { initial: PlaceOtherName[] }) {
    const [drafts, setDrafts] = useState(draftsFor(initial));
    return <OtherNamesEditor drafts={drafts} onChange={setDrafts} placeName="Lviv" index={INDEX} />;
  }

  it('marks a removed name with Keep it, and says what happens to its records', async () => {
    const user = userEvent.setup();
    render(<Editor initial={[name({ id: 1, name: 'Lemberg', records: 4 }), name({ id: 4, name: 'Leopolis' })]} />);
    expect(screen.getByText('other_name_used {"count":4,"name":"Lemberg"}')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'other_name_remove {"name":"Lemberg"}' }));
    expect(screen.getByText('Lemberg').tagName).toBe('S');
    expect(screen.getByText('other_name_removed_used {"count":4,"name":"Lemberg"}')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'other_name_remove {"name":"Leopolis"}' }));
    expect(screen.getByText('other_name_removed_unused')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'other_name_keep' })[0]);
    expect(screen.getByDisplayValue('Lemberg')).toBeInTheDocument();
  });

  it('warns that a respelt name leaves its records their spelling, and flags a name another place has', async () => {
    const user = userEvent.setup();
    render(<Editor initial={[name({ id: 1, name: 'Lemberg', records: 4 })]} />);
    const field = screen.getByDisplayValue('Lemberg');
    await user.clear(field);
    await user.type(field, 'Lemburg');
    expect(screen.getByText('other_name_respelt_used {"count":4,"name":"Lemberg"}')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'add_another_name' }));
    const added = screen.getAllByLabelText('other_name_field').at(-1)!;
    expect(added).toHaveFocus();
    await user.type(added, 'Krakau');
    expect(screen.getByRole('alert')).toHaveTextContent('check_taken {"name":"Krakau","place":"Kraków"}');
    await user.clear(added);
    await user.type(added, 'Lwow');
    const link = screen.getByRole('link', { name: 'check_merge_link {"name":"Lwow","place":"Lviv"}' });
    expect(link).toHaveAttribute('href', '/places/view?id=2&rename=Lviv&keep=1');
    expect(link.closest('[role="status"]')).toHaveTextContent('check_merge {"name":"Lwow","place":"Lviv","count":2}');
  });
});

describe('rename choices (#1185)', () => {
  function Choices({ target }: { target: string | null }) {
    const [choice, setChoice] = useState<RenameChoice>({ keepOld: false, separate: false });
    return <RenameChoices from="Lviv" to="Lvov" target={target} records={3} choice={choice} onChoice={setChoice} />;
  }

  it('assumes a misspelling, and the box keeps the old name', async () => {
    const user = userEvent.setup();
    render(<Choices target={null} />);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText('keep_old_hint_moved {"count":3,"name":"Lviv","to":"Lvov"}')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /keep_old_name/ }));
    expect(screen.getByText('keep_old_hint_kept {"count":3,"name":"Lviv"}')).toBeInTheDocument();
  });

  it('offers merge (the default) or two separate places when the name is taken', async () => {
    const user = userEvent.setup();
    render(<Choices target="Lvov" />);
    const [merge, separate] = screen.getAllByRole('radio');
    expect(merge).toBeChecked();
    await user.click(separate);
    expect(separate).toBeChecked();
  });
});
