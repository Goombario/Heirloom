/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/app/hooks/useTimestamp', () => ({
  useTimestamp: () => ({ timestamp: (v: string) => String(v), activityTime: (v: string) => String(v) }),
}));
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { AuditLogEntryWithUser } from '@/lib/db/schema';

const state = vi.hoisted(() => ({
  entries: [] as AuditLogEntryWithUser[],
  refs: { people: {} as Record<string, string>, families: {} as Record<string, string> },
  fail: false,
}));

vi.mock('@/app/contexts/TreeContext', () => ({
  useTree: () => ({ activeTreeId: 1, activePermission: 'owner', currentUserId: 1 }),
}));
vi.mock('@/app/components/useErrorToast', () => ({
  useErrorToast: () => ({ reportError: vi.fn(), redirectIfUnauthorized: vi.fn(() => false) }),
}));
vi.mock('@/lib/data', () => ({
  DATA_MODE: 'server',
  getDataClient: async () => ({
    audit: {
      list: async () => {
        if (state.fail) throw new Error('raw server secret');
        return { entries: state.entries, total: state.entries.length, refs: state.refs };
      },
      users: async () => ({ users: [] }),
      revert: vi.fn(),
    },
  }),
}));
vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign(
    (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
    { has: () => false },
  ),
  useLocale: () => 'en',
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import AuditPage from '@/app/audit/page';

function entry(changes: unknown): AuditLogEntryWithUser {
  return {
    Id: 1,
    TreeOwnerId: 1,
    UserId: 1,
    TreeId: 1,
    Action: 'update',
    EntityType: 'media',
    EntityId: 7,
    EntityLabel: 'Primary media for Person #3',
    Changes: changes as AuditLogEntryWithUser['Changes'],
    CreatedAt: '2026-08-23T00:00:00Z',
    UserName: 'Test',
    UserEmail: null,
  };
}

describe('audit page revert eligibility', () => {
  beforeEach(() => { state.entries = []; state.refs = { people: {}, families: {} }; state.fail = false; });

  it('renders a translated retryable error instead of an empty result on cold failure', async () => {
    state.fail = true;
    render(<AuditPage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('error_generic');
    expect(alert).not.toHaveTextContent('raw server secret');
    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument();

    state.fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('does not present canonical-primary media summaries as revertible or bulk-selectable', async () => {
    state.entries = [entry({
      summary: { kind: 'canonical_primary' },
      fields: { CanonicalPrimaryMediaId: { old: 4, new: 7 } },
    })];
    render(<AuditPage />);
    await screen.findAllByText('Primary media for Person #3');

    expect(screen.queryByRole('button', { name: 'revert' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'select_row' })).not.toBeInTheDocument();
  });

  it('does not present canonical-ownership media summaries as revertible or bulk-selectable', async () => {
    state.entries = [entry({
      summary: { kind: 'canonical_ownership' },
      fields: { CanonicalPeopleOwnerIds: { old: [3], new: [4] } },
    })];
    render(<AuditPage />);
    await screen.findAllByText('Primary media for Person #3');

    expect(screen.queryByRole('button', { name: 'revert' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'select_row' })).not.toBeInTheDocument();
  });

  // #551: change details name fields and people, never columns and ids.
  it('shows a partner swap by field label and person name, with a fallback for a deleted person', async () => {
    state.entries = [{
      ...entry({ fields: { Partner1Id: { old: 812, new: 907 }, MarriageDate: { old: '1901-06-03', new: null } } }),
      EntityType: 'family',
      EntityLabel: 'Tom Bracken & Mary Bracken',
    }];
    state.refs = { people: { 907: 'Ned Bracken' }, families: {} };
    render(<AuditPage />);
    await screen.findAllByText('Tom Bracken & Mary Bracken');

    expect(screen.getAllByText('field_partner1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ned Bracken').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ref_person_missing:{"id":"812"}').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Jun 3, 1901').length).toBeGreaterThan(0);
    expect(screen.queryByText('Partner1Id')).not.toBeInTheDocument();
    expect(screen.queryByText('MarriageDate')).not.toBeInTheDocument();
  });

  it('collapses a photo crop into one row and hides storage columns', async () => {
    state.entries = [entry({ fields: {
      FocalX: { old: 0.1, new: 0.2 }, FocalY: { old: 0.3, new: 0.4 }, ContentHash: { old: 'a', new: 'b' },
    } })];
    render(<AuditPage />);
    await screen.findAllByText('Primary media for Person #3');

    expect(screen.getAllByText('field_photo_focus')).toHaveLength(screen.getAllByText('value_changed').length);
    expect(screen.queryByText('FocalX')).not.toBeInTheDocument();
    expect(screen.queryByText('ContentHash')).not.toBeInTheDocument();
  });

  it('preserves revert and bulk-selection affordances for ordinary media updates', async () => {
    state.entries = [entry({ fields: { Title: { old: 'Before', new: 'After' } } })];
    render(<AuditPage />);
    await screen.findAllByText('Primary media for Person #3');

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'revert' }).length).toBeGreaterThan(0));
    expect(screen.getByRole('checkbox', { name: 'select_row' })).toBeInTheDocument();
  });
});
