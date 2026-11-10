/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { name: 'Owner', email: 'owner@example.test' } } }) }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 1, activeTreeName: 'Brackens', activeOwnerName: null }) }));
vi.mock('@/app/hooks/useMyTrees', () => ({ useMyTrees: () => ({ trees: [{ Id: 1, Name: 'Brackens' }], refresh: vi.fn() }) }));
vi.mock('@/app/hooks/useDesktopMode', () => ({ useDesktopMode: () => false }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import ShareTreeButton from '@/app/components/ShareTreeButton';

const fetchMock = vi.fn();
const list = {
  shares: [
    { Id: 3, OwnerId: 1, SharedWithId: 5, TreeId: 1, TreeName: 'Brackens', Permission: 'view', CreatedAt: '', sharedWithUser: { Id: 5, Email: 'cousin@example.test', Name: 'Cousin' } },
  ],
  pending: [{ Id: 3, TreeId: 1, Email: 'newcomer@example.test', Permission: 'contribute' }],
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(
      url.startsWith('/api/members/check') ? { member: true, canInvite: false }
        : init?.method === 'POST' ? { pending: { Id: 4, TreeId: 1, Email: 'aunt@example.test', Permission: 'view' } }
          : init?.method ? {} : list,
    ),
  }));
  vi.stubGlobal('fetch', fetchMock);
});

const open = () => render(
  <NextIntlClientProvider locale="en" messages={en}>
    <ShareTreeButton forceOpen />
  </NextIntlClientProvider>,
);

// #1228: an address with no account gets a pending share, shown as waiting.
describe('Share dialog pending shares (#1228)', () => {
  it('lists a pending share as waiting for a first sign-in beside a real share', async () => {
    open();
    expect(await screen.findByText('newcomer@example.test')).toBeInTheDocument();
    expect(screen.getByText(en.shareTree.pending_sub)).toBeInTheDocument();
    expect(screen.getByText('Cousin')).toBeInTheDocument();
    expect(screen.getByText('People with access (2)')).toBeInTheDocument();
  });

  it('says the share starts at their first sign-in when the server stores it as pending', async () => {
    open();
    await screen.findByText('newcomer@example.test');
    fireEvent.change(screen.getByRole('textbox', { name: en.shareTree.email_label }), { target: { value: 'aunt@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: en.shareTree.invite_button }));
    expect(await screen.findByText(en.shareTree.pending_hint.replace('{email}', 'aunt@example.test'))).toBeInTheDocument();
  });

  it('sends a pending share\'s role change to its own route, though its id matches a real share', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Permission for newcomer@example.test' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Edit/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sharing/pending/3', expect.objectContaining({ method: 'PUT' })));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/sharing/3', expect.anything());
  });
});
