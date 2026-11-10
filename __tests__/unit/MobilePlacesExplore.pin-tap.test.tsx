/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import '@testing-library/jest-dom';
import en from '@/messages/en.json';
import type { PlaceTreeNode } from '@/lib/places/hierarchy';
import type { MapMarker } from '@/app/components/LocationMap';

// The phone Explore strip (the owner's phone review of #1117): the first tap on a pin names
// it, a second tap on the same pin does what its row does.
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: null }) }));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/lib/places/prefetch', () => ({ usePrefetchPlaceDetail: () => () => {} }));
vi.mock('@/app/hooks/useElementWidth', () => ({ useElementWidth: () => [() => {}, 390] }));
// The map as one button per pin, with the highlighted (named) pins marked.
vi.mock('@/app/components/LocationMap', () => ({
  default: ({ markers, onMarkerClick, highlightedIds = [], gestures }: {
    markers: MapMarker[]; onMarkerClick: (id: number) => void; highlightedIds?: number[]; gestures?: boolean;
  }) => (
    <div data-testid="map" data-gestures={String(!!gestures)}>
      {markers.map((m) => (
        <button key={m.id} type="button" data-named={String(highlightedIds.includes(m.id!))} onClick={() => onMarkerClick(m.id!)}>pin {m.label}</button>
      ))}
    </div>
  ),
}));

import { MobilePlacesExplore } from '@/app/places/explore/MobilePlacesExplore';

function node(name: string, over: Partial<PlaceTreeNode> = {}): PlaceTreeNode {
  return {
    id: null, name, parentId: null, ownCount: 1, rolledCount: 1, peopleCount: 1,
    faces: [], latitude: null, longitude: null, pinSuppressed: false,
    pinState: 'none', children: [], ...over,
  };
}

function roots(): PlaceTreeNode[] {
  const dover = node('Dover, Kent, England', { id: 3, latitude: 51.1, longitude: 1.3, pinState: 'own' });
  const kent = node('Kent, England', { id: 2, latitude: 51.2, longitude: 0.7, pinState: 'own', children: [dover] });
  const york = node('York, England', { id: 4, latitude: 53.9, longitude: -1.1, pinState: 'own' });
  return [node('England', { id: 1, children: [kent, york] })];
}

function renderExplore() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <MobilePlacesExplore roots={roots()} />
    </NextIntlClientProvider>,
  );
}

describe('MobilePlacesExplore pin taps', () => {
  beforeEach(() => push.mockClear());

  it('lets the strip pan and zoom', () => {
    renderExplore();
    expect(screen.getByTestId('map')).toHaveAttribute('data-gestures', 'true');
  });

  it('names a leaf on the first tap and opens it on the second', () => {
    renderExplore();
    const york = screen.getByRole('button', { name: 'pin York' });
    fireEvent.click(york);
    expect(push).not.toHaveBeenCalled();
    expect(york).toHaveAttribute('data-named', 'true');
    expect(screen.getByText('Tap York again to open it')).toBeInTheDocument();
    fireEvent.click(york);
    expect(push).toHaveBeenCalledWith('/places/view?id=4');
  });

  it('a tap on another pin moves the name there instead of acting', () => {
    renderExplore();
    fireEvent.click(screen.getByRole('button', { name: 'pin York' }));
    fireEvent.click(screen.getByRole('button', { name: 'pin Kent' }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'pin Kent' })).toHaveAttribute('data-named', 'true');
    expect(screen.getByRole('button', { name: 'pin York' })).toHaveAttribute('data-named', 'false');
    expect(screen.getByText('Tap Kent again for the places in it')).toBeInTheDocument();
  });

  it('drills into a parent on the second tap', () => {
    renderExplore();
    fireEvent.click(screen.getByRole('button', { name: 'pin Kent' }));
    fireEvent.click(screen.getByRole('button', { name: 'pin Kent' }));
    expect(push).not.toHaveBeenCalled();
    // Inside Kent the map shows Dover, nothing is named yet, and the trail ends at Kent.
    expect(screen.getByRole('button', { name: 'pin Dover' })).toHaveAttribute('data-named', 'false');
    expect(screen.getByRole('button', { name: 'Kent' })).toHaveAttribute('aria-current', 'location');
  });
});
