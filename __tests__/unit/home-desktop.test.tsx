/** @vitest-environment happy-dom */

import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import type { DashboardData, ResumedPerson } from '@/lib/data/types';
import { DesktopHome } from '@/app/components/home/DesktopHome';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/app/hooks/useActiveTreeName', () => ({ useActiveTreeName: () => 'Lindqvist family' }));
vi.mock('@/app/hooks/useTimestamp', () => ({ useTimestamp: () => ({ timestamp: (v: string) => v, activityTime: () => '2 hours ago' }) }));
vi.mock('@/app/components/GuardedLink', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/app/components/ProfileImage', () => ({ default: () => <img alt="" /> }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => <span /> }));

const change = { Action: 'update', Changes: { fields: {} }, CreatedAt: '2026-11-12T10:00:00Z' };
const anna: ResumedPerson = {
  Id: 1, FirstName: 'Anna', LastName: 'Lindqvist', EffectiveFirstName: 'Anna', Nickname: null, Sex: 'F',
  BirthDate: '1868', BirthPlace: null, DeathDate: '1931', DeathPlace: null, IsDeceased: 1, PrimaryMediaId: null,
  FocalX: null, FocalY: null, FocalRadius: null, partnershipCount: 1, childrenCount: 2, totalFacts: 3, sourcedFacts: 1,
  nextSteps: {
    total: 5,
    steps: [
      { kind: 'death_place' },
      { kind: 'source', fact: 'event', eventId: 44, eventType: 'OCCU', year: 1891 },
      { kind: 'grandparents', parentId: 9, parentSex: 'F', parentName: 'Kristina' },
    ],
  },
  lastChange: { ...change, EntityLabel: 'Anna Lindqvist' },
};

const data: DashboardData = {
  stats: { people: 412, families: 96, events: 900, sources: 40, casesInProgress: 2 },
  openCases: [{ Id: 3, Title: 'Where did Anna live before 1891?', Status: 'in_progress', Tags: [], UpdatedAt: '2026-11-11', LastComment: 'Found her in the 1900 census.', LastCommentAt: '2026-11-12', LastCommentUserId: 1, LastCommentAuthor: 'Sam Archivist' }],
  recentActivity: [],
  places: [{ place_id: 5, place_name: 'Duluth, Minnesota, USA', person_count: '12', own_count: '12', country: 'USA' }],
  placeTotals: { places: 30, countries: 4 },
  yearSpan: { first: 1702, last: 1998 },
  resumedPerson: anna,
  recentPeople: [{ Id: 2, FirstName: 'Johan', LastName: 'Lindqvist', EffectiveFirstName: 'Johan', Nickname: null, Sex: 'M', PrimaryMediaId: null, FocalX: null, FocalY: null, FocalRadius: null, lastChange: change }],
};

const wrap = (ui: ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

describe('DesktopHome (#53)', () => {
  it('names the tree with its counts and years in the band', () => {
    wrap(<DesktopHome data={data} phase="ready" datesToCheck={7} duplicates={3} canEdit treeId={1} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Lindqvist family' })).toBeInTheDocument();
    expect(screen.getByText(/412 people · 96 families/)).toHaveTextContent('1702–1998');
  });

  it('shows Next steps for editors, each leaving for the person page', () => {
    wrap(<DesktopHome data={data} phase="ready" datesToCheck={7} duplicates={3} canEdit treeId={1} />);
    const next = screen.getByRole('heading', { name: 'Next for Anna' }).closest('div')!.parentElement!;
    expect(within(next).getByText('5 open')).toBeInTheDocument();
    expect(within(next).getByRole('link', { name: /Death place/ })).toHaveAttribute('href', '/people/view?id=1#death');
    expect(within(next).getByRole('link', { name: /Source for Occupation, 1891/ })).toHaveAttribute('href', '/people/view?id=1#event-44');
    expect(within(next).getByRole('link', { name: /Mother’s parents/ })).toHaveAttribute('href', '/people/view?id=9#parents');
    expect(screen.getByRole('link', { name: /Open in tree/ })).toHaveAttribute('href', '/tree?rootId=1');
  });

  it('gives a viewer Last updated, no Next steps, no Quick add and no data-check rows', () => {
    wrap(<DesktopHome data={data} phase="ready" datesToCheck={7} duplicates={3} canEdit={false} treeId={1} />);
    expect(screen.getByText('Last updated')).toBeInTheDocument();
    expect(screen.queryByText('Next for Anna')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Quick add' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Dates to check/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Cases in progress/ })).toBeInTheDocument();
  });

  it('lists recent people with the time at the right, and cases with their last comment', () => {
    wrap(<DesktopHome data={data} phase="ready" datesToCheck={7} duplicates={3} canEdit treeId={1} />);
    const johan = screen.getByRole('link', { name: /Johan Lindqvist/ });
    expect(johan).toHaveTextContent('2 hours ago');
    const kase = screen.getByRole('link', { name: /Where did Anna live/ });
    expect(kase).toHaveTextContent('Sam Archivist · 2 hours ago');
    expect(kase).toHaveTextContent('“Found her in the 1900 census.”');
    expect(screen.getByRole('link', { name: /Full history/ })).toHaveAttribute('href', '/audit');
  });

  it('shows each place with its country and the rail foot line', () => {
    wrap(<DesktopHome data={data} phase="ready" datesToCheck={7} duplicates={3} canEdit treeId={1} />);
    expect(screen.getByRole('link', { name: /Duluth · USA/ })).toHaveTextContent('12 records');
    expect(screen.getByText(/30 places in 4 countries/)).toBeInTheDocument();
  });
});
