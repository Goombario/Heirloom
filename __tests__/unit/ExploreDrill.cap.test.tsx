/**
 * @vitest-environment happy-dom
 *
 * A big Explore level draws its first 200 rows, then "Show all N places" (#4).
 * Search results are never capped.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import '@testing-library/jest-dom';
import en from '@/messages/en.json';
import type { PlaceTreeNode } from '@/lib/places/hierarchy';
import type { ExploreState } from '@/app/places/explore/useExploreState';
import { DRILL_ROW_CAP, capDrillRows } from '@/app/places/explore/drillRows';

vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: null }) }));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/lib/places/prefetch', () => ({ usePrefetchPlaceDetail: () => () => {}, placeDetailKey: (n: string) => `place:${n}` }));

import { ExploreDrill } from '@/app/places/explore/ExploreDrill';

const node = (i: number): PlaceTreeNode => ({
  id: i, name: `Hamlet ${String(i).padStart(3, '0')}`, parentId: null, ownCount: 1, rolledCount: 1, peopleCount: 1,
  faces: [], latitude: null, longitude: null, pinSuppressed: false, pinState: 'none', children: [],
});
const roots = Array.from({ length: 250 }, (_, i) => node(i + 1));
const state: ExploreState = { currentNode: null, selected: null, crumbs: [], children: roots, roots, select: vi.fn(), goTo: vi.fn(), reveal: vi.fn() };

function renderDrill(search = '') {
  return render(<NextIntlClientProvider locale="en" messages={en}><ExploreDrill state={state} search={search} /></NextIntlClientProvider>);
}

describe('Explore drill render cap (#4)', () => {
  it('caps only an unfiltered level longer than the cap', () => {
    const rows = Array.from({ length: 250 }, (_, i) => i);
    expect(capDrillRows(rows, false, false)).toEqual({ shown: rows.slice(0, DRILL_ROW_CAP), hidden: 50 });
    expect(capDrillRows(rows, true, false).hidden).toBe(0);
    expect(capDrillRows(rows, false, true).hidden).toBe(0);
    expect(capDrillRows(rows.slice(0, 10), false, false).hidden).toBe(0);
  });

  it('draws 200 rows, then all of them after Show all', () => {
    renderDrill();
    expect(screen.getByText('Hamlet 200')).toBeInTheDocument();
    expect(screen.queryByText('Hamlet 201')).not.toBeInTheDocument();
    // The footer still counts the whole level.
    expect(screen.getByText(/250 places/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 250 places' }));
    expect(screen.getByText('Hamlet 250')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });

  it('never caps search results', () => {
    renderDrill('Hamlet');
    expect(screen.getByText('Hamlet 250')).toBeInTheDocument();
  });
});
