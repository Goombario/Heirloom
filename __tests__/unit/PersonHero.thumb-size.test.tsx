/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import '@testing-library/jest-dom';

const useIsMobile = vi.hoisted(() => vi.fn().mockReturnValue(true));

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
vi.mock('@/app/components/StaticMapPreview', () => ({ default: () => null }));

import { PersonHero } from '@/app/people/view/PersonHero';

describe('PersonHero profile image sizing', () => {
  it('requests a 2048px thumbnail for desktop framing but not the mobile avatar', () => {
    const person = {
      Id: 7,
      FirstName: 'Ada',
      LastName: 'Lovelace',
      Sex: 'F',
      IsDeceased: 1,
      BirthDate: null,
      DeathDate: null,
      BirthPlace: null,
      DeathPlace: null,
      Nickname: null,
      spouses: [],
      familiesAsSpouse: [],
      children: [],
    } as never;

    render(
      <PersonHero
        person={person}
        media={[{ Id: 42, IsPersonPrimary: true, FocalX: 50, FocalY: 50 } as never]}
        citationMap={{} as never}
        placeCoords={{}}
        id="7"
        treeId={1}
        canEdit={false}
        canDelete={false}
        hasJourney={false}
        onShowJourney={vi.fn()}
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

    expect(screen.getAllByTestId('profile-image')).toHaveLength(2);
    expect(screen.getAllByTestId('profile-image')[0]).toHaveAttribute('data-thumb-size', 'unset');
    expect(screen.getAllByTestId('profile-image')[0]).toHaveAttribute('data-loading', 'eager');
    expect(screen.getAllByTestId('profile-image')[1]).toHaveAttribute('data-thumb-size', '2048');
    expect(screen.getAllByTestId('profile-image')[1]).toHaveAttribute('data-loading', 'lazy');
  });

  it('keeps the desktop framed portrait eager on desktop viewports', () => {
    useIsMobile.mockReturnValue(false);

    render(
      <PersonHero
        person={{ Id: 7, FirstName: 'Ada', LastName: 'Lovelace', Sex: 'F', IsDeceased: 1, BirthDate: null, DeathDate: null, BirthPlace: null, DeathPlace: null, Nickname: null, spouses: [], familiesAsSpouse: [], children: [] } as never}
        media={[{ Id: 42, IsPersonPrimary: true, FocalX: 50, FocalY: 50 } as never]}
        citationMap={{} as never}
        placeCoords={{}}
        id="7"
        treeId={1}
        canEdit={false}
        canDelete={false}
        hasJourney={false}
        onShowJourney={vi.fn()}
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

    expect(screen.getAllByTestId('profile-image')[1]).toHaveAttribute('data-thumb-size', '2048');
    expect(screen.getAllByTestId('profile-image')[1]).toHaveAttribute('data-loading', 'eager');
  });

  it('does not server-render the desktop 2048px portrait as eager', () => {
    useIsMobile.mockReturnValue(false);

    const html = renderToString(
      <PersonHero
        person={{ Id: 7, FirstName: 'Ada', LastName: 'Lovelace', Sex: 'F', IsDeceased: 1, BirthDate: null, DeathDate: null, BirthPlace: null, DeathPlace: null, Nickname: null, spouses: [], familiesAsSpouse: [], children: [] } as never}
        media={[{ Id: 42, IsPersonPrimary: true, FocalX: 50, FocalY: 50 } as never]}
        citationMap={{} as never}
        placeCoords={{}}
        id="7"
        treeId={1}
        canEdit={false}
        canDelete={false}
        hasJourney={false}
        onShowJourney={vi.fn()}
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

    expect(html).toContain('data-thumb-size="2048" data-loading="lazy"');
  });
});
