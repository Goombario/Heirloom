/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { FamilyWithSpouseNames } from '@/lib/db/queries/families';

// Keys come back with their values, so a test can tell "child_count:4" apart.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join('|')}` : key,
  useLocale: () => 'en',
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/families' }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => null }));

import { MobileFamiliesFilters, MobileFamiliesRows } from '@/app/families/MobileFamiliesList';
import { coupleName, searchFamilies, sortFamilies } from '@/app/families/familyList';

const base = {
  MarriageDate: null, MarriagePlace: null, EndedDate: null, EndedReason: null, Type: 'Marriage',
  husbandName: null, wifeName: null, partner1LastName: null, partner2LastName: null,
  partner1DeathDate: null, partner2DeathDate: null, partner1Sex: 'M', partner2Sex: 'F',
  husbandMediaId: null, wifeMediaId: null, husbandFocalX: null, husbandFocalY: null, husbandFocalRadius: null,
  wifeFocalX: null, wifeFocalY: null, wifeFocalRadius: null,
  childCount: 0, youngDeathCount: 0, TotalFacts: 0, SourcedFacts: 0,
};
const family = (f: Record<string, unknown>) => ({ ...base, ...f }) as unknown as FamilyWithSpouseNames;

const halvorsen = family({
  Id: 1, husbandName: 'Anders Halvorsen', partner1LastName: 'Halvorsen', wifeName: 'Greta Halvorsen', partner2LastName: 'Halvorsen',
  MarriageDate: '1893', partner1DeathDate: '1939', MarriagePlace: 'Duluth, Minnesota', childCount: 4, youngDeathCount: 1, TotalFacts: 6, SourcedFacts: 4,
});
const moe = family({
  Id: 2, husbandName: 'Olav Halvorsen', partner1LastName: 'Halvorsen', wifeName: 'Sigrid Moe', partner2LastName: 'Moe',
  MarriageDate: '1912', EndedDate: '1919', EndedReason: 'Divorce', childCount: 1,
});
const dahl = family({
  Id: 3, husbandName: 'Lars Dahl', partner1LastName: 'Dahl', wifeName: 'Marta Eklund', partner2LastName: 'Eklund',
  Type: 'Civil union', MarriageDate: '2004', childCount: 2,
});
const marsh = family({ Id: 4, husbandName: 'Thomas Marsh', partner1LastName: 'Marsh', Type: 'Unknown' });
const nobody = family({ Id: 5 });

function rows(props: Partial<React.ComponentProps<typeof MobileFamiliesRows>> = {}) {
  const onSort = vi.fn();
  render(
    <MobileFamiliesRows
      rows={[halvorsen, moe, dahl, marsh, nobody]}
      count="count_total:5"
      treeId={null}
      column="partner"
      ascending
      onSort={onSort}
      page={1}
      pages={1}
      onPage={vi.fn()}
      {...props}
    />,
  );
  return { onSort };
}

describe('couple name (#1064)', () => {
  it('shares a matching surname, keeps both otherwise, and stands alone for one partner', () => {
    expect(coupleName(halvorsen).text).toBe('Anders & Greta Halvorsen');
    expect(coupleName(moe).text).toBe('Olav Halvorsen & Sigrid Moe');
    expect(coupleName(marsh).text).toBe('Thomas Marsh');
    expect(coupleName(nobody).text).toBe('');
  });

  it('takes the first given name and skips an integrated nickname', () => {
    const f = family({ Id: 9, husbandName: 'Edwin “Ned” James Marsh', partner1LastName: 'Marsh', wifeName: 'Mary Ann Marsh', partner2LastName: 'Marsh' });
    expect(coupleName(f).text).toBe('Edwin & Mary Marsh');
  });

  it('shows the whole name when an older cached list has no surname field', () => {
    const f = family({ Id: 9, husbandName: 'Anders Halvorsen', partner1LastName: undefined, wifeName: null });
    expect(coupleName(f).text).toBe('Anders Halvorsen');
  });
});

describe('families list sort and search', () => {
  it('sorts Partner by surname, missing names last', () => {
    const ids = sortFamilies([marsh, nobody, dahl, moe, halvorsen], 'partner', true, 'en').map((f) => f.Id);
    expect(ids).toEqual([3, 1, 2, 4, 5]);
    expect(sortFamilies([marsh, nobody, dahl], 'partner', false, 'en').map((f) => f.Id)).toEqual([4, 3, 5]);
  });

  it('sorts Began by year, qualified dates with their year and blanks last', () => {
    const abt = family({ Id: 8, husbandName: 'A B', partner1LastName: 'B', MarriageDate: 'ABT 1900' });
    expect(sortFamilies([dahl, abt, nobody, halvorsen], 'began', true, 'en').map((f) => f.Id)).toEqual([1, 8, 3, 5]);
  });

  it('counts still-active partnerships as the newest ending', () => {
    expect(sortFamilies([dahl, moe, halvorsen], 'ended', true, 'en').map((f) => f.Id)).toEqual([2, 1, 3]);
  });

  it('searches partner names and places, accent-blind', () => {
    const f = family({ Id: 7, husbandName: 'Étienne Roy', MarriagePlace: 'Québec' });
    expect(searchFamilies([f, moe], 'etienne quebec').map((x) => x.Id)).toEqual([7]);
  });
});

describe('phone families rows (#1064)', () => {
  it('opens the family page in one tap, with years and children on the second line', () => {
    rows();
    const link = screen.getByRole('link', { name: /Anders & Greta Halvorsen/ });
    expect(link).toHaveAttribute('href', '/families/view?id=1');
    expect(link).toHaveTextContent('1893–1939 · child_count:4');
    expect(link).not.toHaveTextContent('died young');
  });

  it('names a divorce, marks an active partnership, and leads non-marriages with their type', () => {
    rows();
    expect(screen.getByRole('link', { name: /Olav Halvorsen & Sigrid Moe/ })).toHaveTextContent('1912–1919 · list_divorced · child_count:1');
    expect(screen.getByRole('link', { name: /Lars Dahl & Marta Eklund/ })).toHaveTextContent('ftype_civil_union · 2004 · active_pill · child_count:2');
    expect(screen.getByRole('link', { name: /Thomas Marsh/ })).toHaveTextContent(/subtitle_partnership · .*active_pill · list_no_children/);
    expect(screen.getByRole('link', { name: /partnership_fallback:5/ })).toBeInTheDocument();
  });

  it('puts letter dividers between surnames under the Partner sort', () => {
    rows();
    for (const letter of ['H', 'D', 'M']) expect(screen.getByText(letter)).toBeInTheDocument();
    expect(screen.getByText('div_no_surname')).toBeInTheDocument();
  });

  it('shows died young only under the Children sort', () => {
    rows({ column: 'children' });
    expect(screen.getByRole('link', { name: /Anders & Greta/ })).toHaveTextContent('list_children_died_young:child_count:4|1');
  });

  it('divides by decade under Ended, with still-active ones together', () => {
    rows({ rows: [moe, halvorsen, dahl], column: 'ended' });
    expect(screen.getByText('div_decade:1910')).toBeInTheDocument();
    expect(screen.getByText('div_decade:1930')).toBeInTheDocument();
    expect(screen.getByText('list_div_still_active')).toBeInTheDocument();
  });

  it('opens the Sort by sheet from the meta row', () => {
    rows();
    fireEvent.click(screen.getByRole('button', { name: 'sort_meta:list_sort_partner|order_az' }));
    expect(screen.getByText('list_sort_hint_ended')).toBeInTheDocument();
  });
});

describe('phone families chips (#1064)', () => {
  it('turns one chip on at a time, and off again', () => {
    const onFilter = vi.fn();
    const { rerender } = render(<MobileFamiliesFilters query="" onQuery={vi.fn()} filter={null} onFilter={onFilter} />);
    expect(screen.queryByText('filter_all')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'filter_active' }));
    expect(onFilter).toHaveBeenLastCalledWith('active');
    rerender(<MobileFamiliesFilters query="" onQuery={vi.fn()} filter="active" onFilter={onFilter} />);
    fireEvent.click(screen.getByRole('button', { name: 'filter_active' }));
    expect(onFilter).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: 'filter_marriages' }));
    expect(onFilter).toHaveBeenLastCalledWith('marriages');
  });
});
