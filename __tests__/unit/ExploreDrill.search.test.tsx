/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import '@testing-library/jest-dom';
import en from '@/messages/en.json';
import type { PlaceTreeNode } from '@/lib/places/hierarchy';
import type { ExploreState } from '@/app/places/explore/useExploreState';

// Real messages, like ExploreDetail.person-groups: the behaviour under test is what
// the rail SAYS while searching ("searching every place", "N matches across all
// places"), so asserting rendered English is what would catch it regressing.
// Face stacks read the active tree for their photos (#929).
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: null }) }));
vi.mock('@/app/components/LanguageProvider', () => ({
  useLanguage: () => ({ language: 'en' }),
}));
vi.mock('@/lib/places/prefetch', () => ({
  usePrefetchPlaceDetail: () => () => {},
  placeDetailKey: (name: string) => `place:${name}`,
}));

import { ExploreDrill } from '@/app/places/explore/ExploreDrill';

function node(name: string, over: Partial<PlaceTreeNode> = {}): PlaceTreeNode {
  return {
    id: null, name, parentId: null, ownCount: 1, rolledCount: 1, peopleCount: 1,
    faces: [], latitude: null, longitude: null, pinSuppressed: false,
    pinState: 'none', children: [], ...over,
  };
}

/** Standing inside "United Kingdom", with "Cannington, Somerset" in another branch. */
function state(): ExploreState {
  const dover = node('Dover, Kent, England', { id: 3 });
  const uk = node('United Kingdom', { id: 1, children: [dover] });
  const cannington = node('Cannington, Somerset, England', { id: 5 });
  const canada = node('Canada', { id: 4, children: [cannington] });
  return {
    currentNode: uk,
    selected: null,
    crumbs: [uk],
    children: uk.children,
    roots: [uk, canada],
    select: vi.fn(),
    goTo: vi.fn(),
  };
}

function renderDrill(search: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ExploreDrill state={state()} search={search} />
    </NextIntlClientProvider>,
  );
}

describe('ExploreDrill search', () => {
  it('lists only the current jurisdiction\'s children when not searching', () => {
    renderDrill('');

    expect(screen.getByText('Dover')).toBeInTheDocument();
    expect(screen.queryByText('Cannington')).not.toBeInTheDocument();
    expect(screen.getByText('1 place in United Kingdom')).toBeInTheDocument();
  });

  it('matches a place in a DIFFERENT branch, which is the point of a global search', () => {
    // Standing in United Kingdom; Cannington lives under Canada. Before this it was
    // unreachable without navigating up first.
    renderDrill('Cann');

    expect(screen.getByText('Cannington')).toBeInTheDocument();
    expect(screen.queryByText('Dover')).not.toBeInTheDocument();
  });

  it('collapses the breadcrumb and counts matches while searching', () => {
    renderDrill('Cann');

    // The label renders as "· searching every place" — the separator is markup.
    expect(screen.getByText(/searching every place/)).toBeInTheDocument();
    expect(screen.getByText('1 match across all places')).toBeInTheDocument();
    // The jurisdiction crumb is replaced, not appended to.
    expect(screen.queryByRole('button', { name: 'United Kingdom' })).not.toBeInTheDocument();
  });

  it('says so when a query matches nothing, rather than rendering an empty rail', () => {
    renderDrill('zzz');

    expect(screen.getByText(en.places.no_results)).toBeInTheDocument();
    expect(screen.getByText('0 matches across all places')).toBeInTheDocument();
  });
});
