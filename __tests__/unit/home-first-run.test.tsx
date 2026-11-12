/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/hooks/useTimestamp', () => ({
  useTimestamp: () => ({ timestamp: (v: string) => String(v), activityTime: (v: string) => String(v) }),
}));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('next-intl', () => ({ useTranslations: () => Object.assign((key: string) => key, { rich: (key: string) => key }) }));
vi.mock('@/app/hooks/useActiveTreeName', () => ({ useActiveTreeName: () => 'Lindqvist family' }));
vi.mock('@/app/components/GuardedLink', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/app/contexts/TreeContext', () => ({
  useTree: () => ({ activeTreeId: 7, activePermission: 'edit', currentUserId: 1 }),
}));

let dashboard: unknown = null;
vi.mock('@/app/components/useCachedResource', () => ({
  useCachedResource: (key: string | null) => ({
    data: key?.startsWith('dashboard:get') ? dashboard : key?.startsWith('dataChecks:') ? null : [],
    loading: false,
  }),
}));
vi.mock('@/app/components/useLoadPhase', () => ({ useLoadPhase: () => 'ready' }));
vi.mock('@/lib/data', () => ({ getDataClient: vi.fn() }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => null }));
// The phone page has its own suite (home-mobile.test.tsx).
vi.mock('@/app/components/home/MobileHome', () => ({ MobileHome: () => null }));

import Home from '@/app/page';

function dashboardWith(people: number) {
  return {
    stats: { people, families: 0, events: 0, sources: 0, casesInProgress: 0 },
    openCases: [],
    recentActivity: [],
    places: [],
    placeTotals: { places: 0, countries: 0 },
    yearSpan: { first: null, last: null },
    resumedPerson: null,
    recentPeople: [],
  };
}

describe('home first run (FR-1)', () => {
  beforeEach(() => { push.mockClear(); });

  it('offers Import a GEDCOM on an empty tree and hides the empty sections', () => {
    dashboard = dashboardWith(0);
    render(<Home />);
    expect(screen.getByRole('heading', { level: 1, name: 'welcome_first_run' })).toBeInTheDocument();
    screen.getByRole('button', { name: 'import_gedcom' }).click();
    expect(push).toHaveBeenCalledWith('/import-export');
    expect(screen.queryByText('mobile_research')).toBeNull();
    expect(screen.queryByText('quick_add')).toBeNull();
  });

  it('shows the tree, Research and the rail once the tree has people', () => {
    dashboard = dashboardWith(3);
    render(<Home />);
    expect(screen.queryByRole('button', { name: 'import_gedcom' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Lindqvist family' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'mobile_research' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'quick_add' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /all_cases/ })).toHaveAttribute('href', '/cases');
  });
});
