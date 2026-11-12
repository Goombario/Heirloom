/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { DashboardData, RecentPerson, ResumedPerson } from '@/lib/data/types';

vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((key: string) => key, {
    rich: (key: string) => key,
  }),
}));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/app/components/GuardedLink', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => null }));
vi.mock('@/app/hooks/useActiveTreeName', () => ({ useActiveTreeName: () => 'Lindqvist tree' }));
vi.mock('@/app/hooks/useTimestamp', () => ({ useTimestamp: () => ({ activityTime: (v: string) => v }) }));

import { MobileHome } from '@/app/components/home/MobileHome';

const change = { Action: 'update', Changes: { fields: {} }, CreatedAt: '2026-10-15' };
const resumed = {
  Id: 1, FirstName: 'Greta', LastName: 'Lindqvist', EffectiveFirstName: 'Greta', Nickname: null, Sex: 'F',
  BirthDate: '1871', BirthPlace: null, DeathDate: '1948', DeathPlace: null, IsDeceased: 1, PrimaryMediaId: null,
  FocalX: null, FocalY: null, FocalRadius: null, partnershipCount: 0, childrenCount: 0, totalFacts: 0, sourcedFacts: 0,
  nextSteps: { steps: [], total: 0 },
  lastChange: { ...change, EntityLabel: 'Greta Lindqvist' },
} satisfies ResumedPerson;
const recent = (Id: number, FirstName: string): RecentPerson => ({
  Id, FirstName, LastName: 'Halvorsen', EffectiveFirstName: FirstName, Nickname: null, Sex: 'M',
  PrimaryMediaId: null, FocalX: null, FocalY: null, FocalRadius: null, lastChange: change,
});

function dashboard(people: number): DashboardData {
  return {
    stats: { people, families: 4, events: 0, sources: 0, casesInProgress: 2 },
    openCases: [], recentActivity: [], places: [],
    placeTotals: { places: 0, countries: 0 }, yearSpan: { first: null, last: null },
    resumedPerson: people ? resumed : null,
    recentPeople: people ? [recent(2, 'Anders'), recent(3, 'Ingrid'), recent(4, 'Nils'), recent(5, 'Elsa')] : [],
  };
}

function renderHome(props: Partial<React.ComponentProps<typeof MobileHome>> = {}) {
  return render(
    <MobileHome data={dashboard(12)} phase="ready" datesToCheck={7} duplicates={3} canEdit treeId={1} {...props} />,
  );
}

describe('MobileHome (#1061)', () => {
  beforeEach(() => {
    router.push.mockClear();
    document.documentElement.removeAttribute('data-own-header');
  });

  it('hides the app top bar while mounted', () => {
    const { unmount } = renderHome();
    expect(document.documentElement).toHaveAttribute('data-own-header');
    unmount();
    expect(document.documentElement).not.toHaveAttribute('data-own-header');
  });

  it('shows the band, the pick-up person, three recent people and the attention rows for editors', () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1, name: 'Lindqvist tree' })).toBeInTheDocument();
    expect(screen.getByText('mobile_counts')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'tree' })).toHaveAttribute('href', '/tree');
    expect(screen.getByText('mobile_pick_up')).toBeInTheDocument();
    expect(screen.getByText('Greta Lindqvist').closest('a')).toHaveAttribute('href', '/people/view?id=1');
    // The pick-up person isn't repeated, and only three recent rows show.
    expect(screen.getByText('Anders Halvorsen')).toBeInTheDocument();
    expect(screen.getByText('Nils Halvorsen')).toBeInTheDocument();
    expect(screen.queryByText('Elsa Halvorsen')).toBeNull();
    expect(screen.getByText('mobile_full_history').closest('a')).toHaveAttribute('href', '/audit');
    expect(screen.getByText('mobile_needs_attention')).toBeInTheDocument();
    expect(screen.getByText('mobile_dates_to_check').closest('a')).toHaveAttribute('href', '/data-checks');
    expect(screen.getByText('mobile_possible_duplicates').closest('a')).toHaveAttribute('href', '/people?filter=duplicates');
    expect(screen.getByText('cases_in_progress_title').closest('a')).toHaveTextContent('2');
    screen.getByRole('button', { name: 'add_person_short' }).click();
    expect(router.push).toHaveBeenCalledWith('/people?add=1');
    expect(screen.getByText('mobile_signoff')).toBeInTheDocument();
  });

  it('drops data-check rows that reached zero', () => {
    renderHome({ datesToCheck: 0, duplicates: 0 });
    expect(screen.queryByText('mobile_dates_to_check')).toBeNull();
    expect(screen.queryByText('mobile_possible_duplicates')).toBeNull();
    expect(screen.getByText('cases_in_progress_title')).toBeInTheDocument();
  });

  it('gives viewers no Add person and only cases under Research', () => {
    renderHome({ canEdit: false });
    expect(screen.queryByRole('button', { name: 'add_person_short' })).toBeNull();
    expect(screen.getByText('mobile_last_updated')).toBeInTheDocument();
    expect(screen.getByText('mobile_recently_updated')).toBeInTheDocument();
    expect(screen.getByText('mobile_research')).toBeInTheDocument();
    expect(screen.queryByText('mobile_dates_to_check')).toBeNull();
    expect(screen.queryByText('mobile_possible_duplicates')).toBeNull();
    expect(screen.getByText('cases_in_progress_title')).toBeInTheDocument();
  });

  it('welcomes a new tree without counts or the Tree button', () => {
    renderHome({ data: dashboard(0) });
    expect(screen.getByRole('heading', { level: 1, name: 'welcome_first_run' })).toBeInTheDocument();
    expect(screen.getByText('mobile_new_tree')).toBeInTheDocument();
    expect(screen.queryByText('mobile_counts')).toBeNull();
    expect(screen.queryByRole('link', { name: 'tree' })).toBeNull();
    screen.getByRole('button', { name: 'import_gedcom' }).click();
    expect(router.push).toHaveBeenCalledWith('/import-export');
    expect(screen.getByText('add_person_short').closest('a')).toHaveAttribute('href', '/people?add=1');
    expect(screen.queryByText('mobile_needs_attention')).toBeNull();
  });
});
