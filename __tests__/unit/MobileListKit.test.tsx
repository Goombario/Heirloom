/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React, { useState } from 'react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));

import {
  MobileListHeader, MobileListFilters, MobileListChip, MobileListMeta, MobileListDivider, MobileListPager, SortSheet, ChoiceSheet,
} from '@/app/components/ui';

const scrollTo = (y: number) => act(() => {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  window.dispatchEvent(new Event('scroll'));
});

beforeEach(() => { scrollTo(0); });

describe('MobileListHeader (#1058)', () => {
  it('hides the app top bar while mounted and opens the menu and global search', () => {
    const menu = vi.fn();
    const search = vi.fn();
    document.addEventListener('open-app-menu', menu);
    document.addEventListener('open-global-search', search);
    const { unmount } = render(<MobileListHeader title="People" />);
    expect(screen.getByRole('heading', { name: 'People' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('data-own-header');
    fireEvent.click(screen.getByRole('button', { name: 'toggle_menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'search_people_and_families' }));
    expect(menu).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledOnce();
    unmount();
    expect(document.documentElement).not.toHaveAttribute('data-own-header');
    document.removeEventListener('open-app-menu', menu);
    document.removeEventListener('open-global-search', search);
  });
});

describe('MobileListFilters (#1058)', () => {
  function Filters() {
    const [q, setQ] = useState('');
    return (
      <MobileListFilters value={q} onChange={setQ} placeholder="Filter by name or place">
        <MobileListChip active dismissible onDismiss={vi.fn()} dismissLabel="Clear surname">Surname: Moe</MobileListChip>
        <MobileListChip>Sex</MobileListChip>
      </MobileListFilters>
    );
  }

  it('slides away on scroll down, returns on a flick up, and stays while the field has focus', () => {
    const { container } = render(<Filters />);
    const bar = container.firstElementChild as HTMLElement;
    scrollTo(100);
    scrollTo(300);
    expect(bar).toHaveAttribute('data-hidden', 'true');
    scrollTo(280);
    expect(bar).not.toHaveAttribute('data-hidden');
    fireEvent.focus(screen.getByRole('searchbox', { name: 'Filter by name or place' }));
    scrollTo(600);
    expect(bar).not.toHaveAttribute('data-hidden');
  });

  it('clears the field from its ✕ and puts ✕ only on the active chip', async () => {
    const user = userEvent.setup();
    render(<Filters />);
    await user.type(screen.getByRole('searchbox'), 'halv');
    await user.click(screen.getByRole('button', { name: 'clear_search' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getAllByRole('button', { name: 'Clear surname' })).toHaveLength(1);
  });
});

describe('MobileListMeta and pager (#1058)', () => {
  it('opens the sort sheet from the current sort and pages with Previous / Next', () => {
    const onSort = vi.fn();
    const onPage = vi.fn();
    render(<>
      <MobileListMeta count="64 total" sortLabel="Name · A→Z" onSort={onSort} />
      <MobileListDivider>H</MobileListDivider>
      <MobileListPager page={1} pages={2} onPage={onPage} />
    </>);
    expect(screen.getByText('H')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Name · A→Z' }));
    expect(onSort).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'previous' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});

describe('SortSheet (#1058)', () => {
  const columns = [
    { key: 'name', label: 'Name', hint: 'Surname, then birth', orders: ['A→Z', 'Z→A'] as [string, string] },
    { key: 'born', label: 'Born', orders: ['Oldest first', 'Newest first'] as [string, string] },
  ];

  it('applies a column at once, starting ascending, and flips the order in the column’s words', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SortSheet open onClose={vi.fn()} title="Sort by" columns={columns} column="name" ascending={false} onChange={onChange} />);
    expect(screen.getByRole('radio', { name: /Name/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /Born/ }));
    expect(onChange).toHaveBeenLastCalledWith('born', true);
    rerender(<SortSheet open onClose={vi.fn()} title="Sort by" columns={columns} column="born" ascending onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Newest first' }));
    expect(onChange).toHaveBeenLastCalledWith('born', false);
  });
});

describe('ChoiceSheet (#1058)', () => {
  it('searches its options, ignoring accents, and picks one', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <ChoiceSheet
        open onClose={vi.fn()} title="Surname" searchPlaceholder="Find a surname" heading="Most common first"
        emptyLabel="No surnames match."
        options={[{ value: 'Halvorsen', label: 'Halvorsen', count: 12 }, { value: 'Sjöberg', label: 'Sjöberg', count: 3 }]}
        onPick={onPick}
      />,
    );
    expect(screen.getByText('Most common first')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Find a surname' }), 'sjob');
    expect(screen.queryByRole('button', { name: /Halvorsen/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Sjöberg/ }));
    expect(onPick).toHaveBeenCalledWith('Sjöberg');
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No surnames match.')).toBeInTheDocument();
  });
});
