/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { PersonWithParentFamily } from '@/lib/db/queries/people';

// Keys come back with their values, so a test can tell "sourced_count:3|7" apart.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join('|')}` : key,
  useLocale: () => 'en',
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/people' }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => null }));

import { MobilePeopleFilters, MobilePeopleRows } from '@/app/people/MobilePeopleList';

const base = {
  Sex: 'M', IsDeceased: 0, BirthDate: null, BirthPlace: null, DeathDate: null, DeathPlace: null,
  FatherFirstName: null, FatherLastName: null, MotherFirstName: null, MotherLastName: null,
};
const person = (p: Record<string, unknown>) => ({ ...base, ...p }) as unknown as PersonWithParentFamily;

const johan = person({ Id: 1, FirstName: 'Johan', LastName: 'Halvorsen', BirthDate: '1896', DeathDate: '1918', BirthPlace: 'Duluth, Minnesota', TotalFacts: 7, SourcedFacts: 3, FatherFirstName: 'Anders', MotherFirstName: 'Greta' });
const greta = person({ Id: 2, FirstName: 'Greta', LastName: 'Halvorsen', Sex: 'F', BirthDate: '1990' });
const kari = person({ Id: 3, FirstName: 'Kari', LastName: 'Moe', Sex: 'F', BirthDate: '1843', DeathDate: '1910' });
const nameless = person({ Id: 4, FirstName: null, LastName: null, IsDeceased: 1 });

function rows(props: Partial<React.ComponentProps<typeof MobilePeopleRows>> = {}) {
  const onSort = vi.fn();
  const onPage = vi.fn();
  render(
    <MobilePeopleRows
      rows={[johan, greta, kari, nameless]}
      count="count_total:4"
      treeId={null}
      column="name"
      ascending
      onSort={onSort}
      duplicates={false}
      page={1}
      pages={1}
      onPage={onPage}
      {...props}
    />,
  );
  return { onSort, onPage };
}

describe('phone people rows (#1063)', () => {
  it('opens the person in one tap, with lifespan and birth town on the second line', () => {
    rows();
    const link = screen.getByRole('link', { name: /Johan Halvorsen/ });
    expect(link).toHaveAttribute('href', '/people/view?id=1');
    expect(link).toHaveTextContent('1896 – 1918 · Duluth');
    expect(link).not.toHaveTextContent('Minnesota');
  });

  it('marks living people with the word, and says when there are no dates', () => {
    rows();
    expect(screen.getByRole('link', { name: /Greta Halvorsen/ })).toHaveTextContent(/born_year:1990 · .*living/);
    expect(screen.getByRole('link', { name: /unnamed/ })).toHaveTextContent('no_dates');
  });

  it('puts letter dividers between surnames when sorted by name', () => {
    rows();
    expect(screen.getByText('H')).toBeInTheDocument();
    expect(screen.getByText('M')).toBeInTheDocument();
    expect(screen.getByText('div_no_surname')).toBeInTheDocument();
  });

  it('follows the sort: decades for Born, the sourced count for Facts sourced', () => {
    rows({ column: 'birth' });
    expect(screen.getByText('div_decade:1890')).toBeInTheDocument();
    expect(screen.getByText('div_no_birth')).toBeInTheDocument();
  });

  it('shows the sourced count under Facts sourced, with no dividers', () => {
    rows({ column: 'sources' });
    expect(screen.getByRole('link', { name: /Johan/ })).toHaveTextContent('sourced_count:3|7');
    expect(screen.queryByText('H')).not.toBeInTheDocument();
  });

  it('shows parents and groups by name in Likely duplicates, without a sort button', () => {
    rows({ duplicates: true, rows: [johan, person({ ...johan, Id: 9 }), kari] });
    expect(screen.getAllByRole('link', { name: /Johan/ })[0]).toHaveTextContent('dup_parents:Anders & Greta');
    expect(screen.getByRole('link', { name: /Kari/ })).toHaveTextContent('filter_no_parents');
    expect(screen.getAllByText('Johan Halvorsen')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /sort_meta/ })).not.toBeInTheDocument();
  });

  it('keeps a respelled match under its group’s divider (#822)', () => {
    const johann = person({ ...johan, Id: 9, FirstName: 'Johann' });
    rows({ duplicates: true, rows: [johan, johann, kari], duplicateGroup: new Map([[1, 0], [9, 0], [3, 1]]) });
    expect(screen.getAllByText('Johan Halvorsen')).toHaveLength(1);
    expect(screen.queryByText('Johann Halvorsen')).not.toBeInTheDocument();
    expect(screen.getByText('Kari Moe')).toBeInTheDocument();
  });

  it('opens the Sort by sheet, and Recently updated starts newest first', () => {
    const { onSort } = rows();
    fireEvent.click(screen.getByRole('button', { name: 'sort_meta:col_name_label|order_az' }));
    const sheet = screen.getByRole('dialog');
    fireEvent.click(within(sheet).getByRole('radio', { name: /sort_recently_updated/ }));
    expect(onSort).toHaveBeenLastCalledWith('updated', false);
    fireEvent.click(within(sheet).getByRole('radio', { name: /col_born/ }));
    expect(onSort).toHaveBeenLastCalledWith('birth', true);
  });
});

describe('phone people chips (#1063)', () => {
  function filters(over: Partial<React.ComponentProps<typeof MobilePeopleFilters>> = {}) {
    const props = {
      query: '', onQuery: vi.fn(), duplicates: false, onClearDuplicates: vi.fn(),
      surname: null, onSurname: vi.fn(), surnames: [['Halvorsen', 2], ['Moe', 1]] as [string, number][],
      sexLabel: null, sexAvailable: true, onCycleSex: vi.fn(), onClearSex: vi.fn(),
      tri: [{ state: 'off' as const, onChange: vi.fn(), yes: 'filter_has_parents', no: 'filter_no_parents' }],
      anyFilter: false, onClearAll: vi.fn(), ...over,
    };
    render(<MobilePeopleFilters {...props} />);
    return props;
  }

  it('uses plain words, and the Surname chip opens a sheet with counts', () => {
    const p = filters();
    expect(screen.getByPlaceholderText('filter_placeholder')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'clear_all' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'filter_surname' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('button', { name: /Halvorsen\s*2/ })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: /Moe/ }));
    expect(p.onSurname).toHaveBeenCalledWith('Moe');
  });

  it('cycles a tri-state chip, and an active surname chip clears on tap', () => {
    const p = filters({ surname: 'Moe', anyFilter: true });
    fireEvent.click(screen.getByRole('button', { name: 'filter_has_parents' }));
    expect(p.tri[0].onChange).toHaveBeenCalledWith('yes');
    fireEvent.click(screen.getByRole('button', { name: 'filter_surname_active:Moe' }));
    expect(p.onSurname).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: 'clear_all' }));
    expect(p.onClearAll).toHaveBeenCalled();
  });
});
