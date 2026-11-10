/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const useIsMobile = vi.hoisted(() => vi.fn().mockReturnValue(false));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((key: string) => key, {
    rich: (key: string, args?: Record<string, unknown>) => `${key} ${args?.date ?? ''}`,
  }),
}));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/components/date-input/aliases', () => ({ useDateQualifierWords: () => ({}) }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile }));
vi.mock('@/app/components/ProfileImage', () => ({
  default: ({ thumbSize, loading }: { thumbSize?: number; loading?: string }) => (
    <span
      data-testid="profile-image"
      data-thumb-size={thumbSize ?? 'unset'}
      data-loading={loading ?? 'unset'}
    />
  ),
}));
vi.mock('@/app/people/view/heroParts', () => ({ HeroName: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/app/people/view/HeroIdentityEditor', () => ({ HeroIdentityEditor: () => null }));
vi.mock('@/app/components/MonogramPortrait', () => ({ default: () => null }));
vi.mock('@/app/components/StaticMapPreview', () => ({ default: () => <div data-testid="hero-map" /> }));

import { PersonHero } from '@/app/people/view/PersonHero';

/**
 * FR-8: the hero's map panel only appears when the last known place has
 * coordinates. Most GEDCOM imports have none, and an empty dark box pushed the
 * name into a narrow column (#741).
 */
const person = {
  Id: 7,
  FirstName: 'Ada',
  LastName: 'Lovelace',
  Sex: 'F',
  IsDeceased: 1,
  BirthDate: null,
  DeathDate: '1852',
  BirthPlace: null,
  DeathPlace: 'Marylebone, London',
  Nickname: null,
  spouses: [],
  familiesAsSpouse: [],
  children: [],
} as never;

function renderHero(props: { placeCoords: Record<string, { lat: number; lng: number }>; hasJourney: boolean; onShowJourney?: () => void }) {
  return render(
    <PersonHero
      person={person}
      media={[]}
      citationMap={{} as never}
      placeCoords={props.placeCoords}
      id="7"
      treeId={1}
      canEdit={false}
      canDelete={false}
      hasJourney={props.hasJourney}
      onShowJourney={props.onShowJourney ?? vi.fn()}
      onToggleDescendants={vi.fn()}
      onAddPhoto={vi.fn()}
      editing={false}
      savingIdentity={false}
      onStartEdit={vi.fn()}
      onSaveIdentity={vi.fn()}
      onCancelEdit={vi.fn()}
      onRequestDelete={vi.fn()}
    />,
  );
}

describe('PersonHero map panel (FR-8)', () => {
  it('draws no map panel when the last place has no coordinates', () => {
    const { container } = renderHero({ placeCoords: {}, hasJourney: false });
    expect(container.querySelector('.hero-geo')).toBeNull();
    expect(screen.queryByTestId('hero-map')).toBeNull();
    expect(screen.queryByRole('button', { name: 'view_journey' })).toBeNull();
  });

  it('keeps a way into the journey when only other places have coordinates', () => {
    const onShowJourney = vi.fn();
    renderHero({ placeCoords: {}, hasJourney: true, onShowJourney });
    fireEvent.click(screen.getByRole('button', { name: 'view_journey' }));
    expect(onShowJourney).toHaveBeenCalledTimes(1);
  });

  it('shows the mini-map and its place when the place has coordinates', () => {
    const { container } = renderHero({ placeCoords: { 'Marylebone, London': { lat: 51.52, lng: -0.15 } }, hasJourney: true });
    expect(container.querySelector('.hero-geo')).not.toBeNull();
    expect(screen.getByTestId('hero-map')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'view_journey' })).toBeNull();
  });
});
