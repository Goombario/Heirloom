/** @vitest-environment happy-dom */
// #448 — clicking a place with sub-places drills into it, so the clicked place stops
// being a row and nothing in the list reads as selected. It IS the deepest crumb, but
// it used to render identically to its ancestors. These assert the distinction, and
// that it is carried by something other than colour.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import '@testing-library/jest-dom';
import en from '@/messages/en.json';
import type { PlaceTreeNode } from '@/lib/places/hierarchy';
import type { ExploreState } from '@/app/places/explore/useExploreState';

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

const buckland = node('Buckland Cemetary, Dover', { id: 5 });
const dover = node('Dover', { id: 3, pinState: 'own', children: [buckland] });
const uk = node('United Kingdom', { id: 1, children: [dover] });

/** Standing inside Dover, which is itself inside United Kingdom. */
function state(over: Partial<ExploreState> = {}): ExploreState {
  return {
    currentNode: dover,
    selected: dover,
    crumbs: [uk, dover],
    children: dover.children,
    roots: [uk],
    select: vi.fn(),
    goTo: vi.fn(),
    ...over,
  };
}

function renderDrill(s: ExploreState, search = '') {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ExploreDrill state={s} search={search} />
    </NextIntlClientProvider>,
  );
}

describe('ExploreDrill breadcrumb — current node', () => {
  it('marks the deepest crumb as the current page', () => {
    renderDrill(state());

    const nav = screen.getByRole('navigation', { name: en.places.breadcrumb });
    const current = nav.querySelector('[aria-current="page"]');

    expect(current).toHaveTextContent('Dover');
  });

  it('marks exactly one crumb, so "you are here" is unambiguous', () => {
    renderDrill(state());

    const nav = screen.getByRole('navigation', { name: en.places.breadcrumb });

    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('leaves ancestors as navigable buttons', () => {
    renderDrill(state());

    expect(screen.getByRole('button', { name: 'United Kingdom' })).toBeInTheDocument();
  });

  it('keeps the tail crumb clickable — it is the way back to the level\'s own detail', () => {
    // `currentNode` and `selected` diverge once a leaf child is picked: the level
    // stays on Dover while the detail pane moves to the leaf. Clicking the tail is
    // how you get Dover's own people back. Making it inert forced a trip up to
    // United Kingdom and back down.
    const s = state();
    renderDrill(s);

    screen.getByRole('button', { name: 'Dover' }).click();

    expect(s.goTo).toHaveBeenCalledWith(3);
  });

  it('drops aria-current when the detail pane is showing a leaf, not the level', () => {
    // Standing in Dover, but Buckland Cemetary is what is displayed — so the tail
    // is still "where you are browsing" and is still marked visually, but it is
    // not what the page is showing.
    renderDrill(state({ selected: buckland }));

    const nav = screen.getByRole('navigation', { name: en.places.breadcrumb });

    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Dover' })).toBeInTheDocument();
  });

  it('does not rely on colour alone — the current crumb carries its pin mark', () => {
    renderDrill(state());

    const nav = screen.getByRole('navigation', { name: en.places.breadcrumb });
    const current = nav.querySelector('[aria-current="page"]');

    // PinMark renders an svg/span sibling of the label inside the current crumb.
    expect(current?.querySelector('svg, span')).toBeTruthy();
  });

  it('treats "All places" as the current location at the root, still clickable', () => {
    renderDrill(state({ currentNode: null, selected: null, crumbs: [], children: [uk] }));

    const root = screen.getByRole('button', { name: en.places.explore_all_places });

    expect(root).toHaveAttribute('aria-current', 'page');
  });

  it('marks nothing while searching, where there is no current node', () => {
    renderDrill(state(), 'buck');

    const nav = screen.getByRole('navigation', { name: en.places.breadcrumb });

    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
    // "All places" stays a live escape hatch out of the search results.
    expect(screen.getByRole('button', { name: en.places.explore_all_places })).toBeInTheDocument();
  });
});

describe('ExploreDrill search rows — region text', () => {
  it('shows the gazetteer ancestry, not a re-parse of the place string', () => {
    renderDrill(state(), 'buckland');

    // "Buckland Cemetary, Dover" sits under Dover under United Kingdom.
    expect(screen.getByText('Dover, United Kingdom')).toBeInTheDocument();
  });
});
