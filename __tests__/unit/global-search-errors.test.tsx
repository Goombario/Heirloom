/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

const state = vi.hoisted(() => ({
  peopleSearch: vi.fn(),
  familySearch: vi.fn(),
  redirectIfUnauthorized: vi.fn(() => false),
}));

vi.mock('@/app/contexts/TreeContext', () => ({
  useTree: () => ({ activeTreeId: 1 }),
}));
vi.mock('@/app/components/useErrorToast', () => ({
  useErrorToast: () => ({ redirectIfUnauthorized: state.redirectIfUnauthorized }),
}));
vi.mock('@/lib/data', () => ({
  getDataClient: async () => ({
    people: { search: state.peopleSearch },
    families: { search: state.familySearch },
  }),
}));
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/app/hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}));
vi.mock('@/app/people/view/personCache', () => ({ prefetchPerson: vi.fn() }));
vi.mock('@/app/families/view/familyCache', () => ({ prefetchFamily: vi.fn() }));
vi.mock('@/app/components/PersonAvatar', () => ({
  default: () => <span aria-hidden="true" />,
}));

import GlobalSearch from '@/app/components/GlobalSearch';

function openSearch() {
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
}

describe('GlobalSearch read errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.peopleSearch.mockResolvedValue([]);
    state.familySearch.mockResolvedValue([]);
  });

  it('shows a translated retryable error when the current search fails', async () => {
    state.peopleSearch.mockRejectedValueOnce(new Error('server secret'));
    render(<GlobalSearch />);
    openSearch();
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'Ada' } });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('globalSearch.search_failed');
    expect(alert).not.toHaveTextContent('server secret');
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeInTheDocument();
  });

  it('keeps superseded request failures silent', async () => {
    let rejectOld!: (error: unknown) => void;
    state.peopleSearch.mockImplementation((query: string) => query === 'old'
      ? new Promise<never>((_, reject) => { rejectOld = reject; })
      : Promise.resolve([]));
    render(<GlobalSearch />);
    openSearch();
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'old' } });
    await waitFor(() => expect(state.peopleSearch).toHaveBeenCalledWith('old', 1));
    fireEvent.change(input, { target: { value: 'new' } });
    await waitFor(() => expect(state.peopleSearch).toHaveBeenCalledWith('new', 1));
    rejectOld(new Error('old server secret'));

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
