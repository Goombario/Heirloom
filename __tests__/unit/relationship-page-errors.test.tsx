/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const h = vi.hoisted(() => ({
  activeTreeId: 1 as number | null,
  peopleList: vi.fn(),
  relationshipGet: vi.fn(),
  redirectIfUnauthorized: vi.fn().mockReturnValue(false),
  relationshipT: (key: string) => `relationship.${key}`,
  commonT: (key: string) => `common.${key}`,
  peopleT: (key: string) => `people.${key}`,
}));

vi.mock('@/app/contexts/TreeContext', () => ({
  useTree: () => ({ activeTreeId: h.activeTreeId }),
}));
vi.mock('@/app/components/useErrorToast', () => ({
  useErrorToast: () => ({ redirectIfUnauthorized: h.redirectIfUnauthorized }),
}));
vi.mock('@/lib/data', () => ({
  getDataClient: async () => ({
    people: { list: h.peopleList },
    relationship: { get: h.relationshipGet },
  }),
}));
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => namespace === 'relationship'
    ? h.relationshipT
    : namespace === 'people' ? h.peopleT : h.commonT,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a>,
}));

import RelationshipPage from '@/app/relationship/page';

const people = [
  { Id: 1, FirstName: 'Ada', LastName: 'Lovelace' },
  { Id: 2, FirstName: 'Grace', LastName: 'Hopper' },
];

describe('Relationship page read errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.activeTreeId = 1;
    h.peopleList.mockResolvedValue({ people });
    h.relationshipGet.mockResolvedValue({ relationship: 'friend', degree: 1, path: [] });
  });

  it('shows a translated retryable people-list error instead of a successful empty state', async () => {
    h.peopleList.mockRejectedValueOnce(new Error('private server message'));
    render(<RelationshipPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('common.error_generic');
    expect(alert).not.toHaveTextContent('private server message');

    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(h.peopleList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('drops an old-tree relationship result that resolves after a tree switch', async () => {
    let resolveOld!: (value: { relationship: string; degree: number; path: never[] }) => void;
    h.relationshipGet.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    const view = render(<RelationshipPage />);
    await waitFor(() => expect(h.peopleList).toHaveBeenCalledWith({ treeId: 1 }));

    const inputs = screen.getAllByPlaceholderText('common.search_for_person');
    fireEvent.change(inputs[0], { target: { value: 'Ada' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Ada Lovelace' }));
    fireEvent.change(inputs[1], { target: { value: 'Grace' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Grace Hopper' }));
    fireEvent.click(screen.getByRole('button', { name: 'relationship.find_relationship' }));
    await waitFor(() => expect(h.relationshipGet).toHaveBeenCalledWith(1, 2, 1));

    await act(async () => {
      h.activeTreeId = 2;
      view.rerender(<RelationshipPage />);
      resolveOld({ relationship: 'old tree secret', degree: 1, path: [] });
      await Promise.resolve();
    });
    expect(screen.queryByText('old tree secret')).not.toBeInTheDocument();
  });
});
