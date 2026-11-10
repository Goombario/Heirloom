/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';

const tree = vi.hoisted(() => ({ activeTreeId: 1 as number | null, activeTreeName: 'Brackens' as string | null, activeOwnerName: null as string | null }));
const mine = vi.hoisted(() => ({ trees: [{ Id: 1, Name: 'Brackens' }, { Id: 2, Name: 'Underhays' }] }));

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { name: 'Owner', email: 'owner@example.test' } } }) }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => tree }));
vi.mock('@/app/hooks/useMyTrees', () => ({ useMyTrees: () => ({ trees: mine.trees, refresh: vi.fn() }) }));
vi.mock('@/app/hooks/useDesktopMode', () => ({ useDesktopMode: () => false }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import ShareTreeButton from '@/app/components/ShareTreeButton';

const fetchMock = vi.fn();

beforeEach(() => {
  tree.activeTreeId = 1; tree.activeTreeName = 'Brackens'; tree.activeOwnerName = null;
  mine.trees = [{ Id: 1, Name: 'Brackens' }, { Id: 2, Name: 'Underhays' }];
  fetchMock.mockReset();
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(init?.method === 'POST' ? {} : {
      shares: [
        { Id: 9, OwnerId: 1, SharedWithId: 5, TreeId: 2, TreeName: 'Underhays', Permission: 'view', CreatedAt: '', sharedWithUser: { Id: 5, Email: 'cousin@example.test', Name: 'Cousin' } },
      ],
    }),
  }));
  vi.stubGlobal('fetch', fetchMock);
});

const open = () => render(
  <NextIntlClientProvider locale="en" messages={en}>
    <ShareTreeButton forceOpen />
  </NextIntlClientProvider>,
);

// #932: the tree being shared must be obvious, switchable, and explained.
describe('Share dialog tree choice (#932)', () => {
  it('names the tree being shared in the title', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Share Brackens' })).toBeInTheDocument();
  });

  it('switches the shared tree, its access list and the invite target from the picker', async () => {
    open();
    await screen.findByRole('heading', { name: 'Share Brackens' });
    expect(screen.queryByText('Cousin')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Tree/ }));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Underhays' }));
    expect(screen.getByRole('heading', { name: 'Share Underhays' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Cousin')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox', { name: en.shareTree.email_label }), { target: { value: 'aunt@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: en.shareTree.invite_button }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sharing', expect.objectContaining({ method: 'POST' })));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toMatchObject({ treeId: 2 });
  });

  it('hides the picker when the user owns one tree', async () => {
    mine.trees = [{ Id: 1, Name: 'Brackens' }];
    open();
    await screen.findByRole('heading', { name: 'Share Brackens' });
    expect(screen.queryByRole('button', { name: /^Tree/ })).toBeNull();
  });

  it('explains the fallback when opened from a tree shared with the user', async () => {
    tree.activeTreeId = 7; tree.activeTreeName = 'Cousins'; tree.activeOwnerName = 'Dana';
    open();
    expect(await screen.findByRole('heading', { name: 'Share Brackens' })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('You can’t share Cousins because it belongs to Dana.');
  });

  it('says nothing extra on the user\'s own tree', async () => {
    open();
    await screen.findByRole('heading', { name: 'Share Brackens' });
    expect(screen.queryByRole('note')).toBeNull();
  });
});
