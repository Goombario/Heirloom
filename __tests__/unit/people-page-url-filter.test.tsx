/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ReactNode } from 'react';

const noParentsPerson = {
  Id: 1, FirstName: 'Ada', LastName: 'Byron', Sex: 'F', IsDeceased: 0,
  BirthDate: null, BirthPlace: null, DeathDate: null, DeathPlace: null,
  FatherFirstName: null, FatherLastName: null, MotherFirstName: null, MotherLastName: null,
};
const hasParentsPerson = {
  ...noParentsPerson,
  Id: 2,
  FirstName: 'Charles',
  FatherFirstName: 'John',
};

const url = vi.hoisted(() => ({ filter: 'duplicates', replace: vi.fn() }));
// The server's review order for ?filter=duplicates (#794).
const flaggedGroups = [[2]];

vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: url.replace }),
  useSearchParams: () => new URLSearchParams(`filter=${url.filter}`),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key, useLocale: () => 'en' }));
vi.mock('@/app/contexts/TreeContext', () => ({
  useTree: () => ({ activeTreeId: null, activePermission: 'edit', currentUserId: 1 }),
}));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/components/date-input/aliases', () => ({ useDateQualifierWords: () => ({}) }));
vi.mock('@/app/components/useCachedResource', () => ({
  useCachedResource: (key: string | null) => key?.startsWith('people:flagged:')
    ? { data: flaggedGroups, loading: false, error: null, retry: vi.fn() }
    : { data: { people: [noParentsPerson, hasParentsPerson] }, loading: false, error: null, retry: vi.fn() },
}));
vi.mock('@/app/components/useLoadPhase', () => ({ useLoadPhase: () => 'ready' }));
vi.mock('@/lib/data', () => ({ getDataClient: vi.fn() }));
vi.mock('@/app/people/view/personCache', () => ({ cachePersonSummaries: vi.fn(), prefetchPerson: vi.fn() }));
vi.mock('@/lib/utils/data-error', () => ({ errorToastKey: vi.fn().mockReturnValue('error_generic') }));
vi.mock('@/app/components/useErrorToast', () => ({ useErrorToast: () => ({ redirectIfUnauthorized: vi.fn() }) }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => null }));
vi.mock('@/app/components/SkeletonLoader', () => ({ SkeletonList: () => null, Skeleton: () => null }));
vi.mock('@/app/components/ui', async () => ({
  ...(await vi.importActual<typeof import('@/app/components/ui')>('@/app/components/ui')),
  Button: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  EmptyState: () => null,
  FilterChip: ({ label, onDismiss }: { label: ReactNode; onDismiss?: () => void }) => (
    <button type="button" onClick={onDismiss}>{label}</button>
  ),
  Pagination: () => null,
}));

import PeoplePageClient from '@/app/people/PeoplePageClient';

describe('PeoplePageClient removed suggestion URLs (#834)', () => {
  it.each(['no_parents', 'no_events'])('ignores ?filter=%s and lists everyone', (filter) => {
    url.filter = filter;
    render(<PeoplePageClient initialPeople={null} />);

    const table = screen.getByRole('table');
    expect(within(table).getByRole('cell', { name: /Byron\s*,\s*Ada/ })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: /Byron\s*,\s*Charles/ })).toBeInTheDocument();
  });
});

describe.each(['duplicates'])('PeoplePageClient ?filter=%s (#794)', (filter) => {
  it('lists only the people the server flagged, under a clearable chip', () => {
    url.filter = filter;
    url.replace.mockClear();
    render(<PeoplePageClient initialPeople={null} />);

    const table = screen.getByRole('table');
    expect(within(table).getByRole('cell', { name: /Byron\s*,\s*Charles/ })).toBeInTheDocument();
    expect(within(table).queryByRole('cell', { name: /Byron\s*,\s*Ada/ })).not.toBeInTheDocument();

    // The phone chips and the desktop chips both clear it; take the first.
    fireEvent.click(screen.getAllByRole('button', { name: 'filter_duplicates' })[0]);
    expect(within(screen.getByRole('table')).getByRole('cell', { name: /Byron\s*,\s*Ada/ })).toBeInTheDocument();
    expect(url.replace).toHaveBeenCalledWith('/people', { scroll: false });
  });
});
