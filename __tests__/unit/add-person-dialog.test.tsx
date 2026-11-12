/** @vitest-environment happy-dom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 9 }) }));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => <span /> }));
vi.mock('@/app/components/DateInput', () => ({
  default: ({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) =>
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock('@/app/components/LocationField', () => ({
  default: ({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) =>
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock('@/app/components/AttachSourceSidebar', () => ({ default: () => null }));

const client = vi.hoisted(() => ({
  people: { create: vi.fn(), search: vi.fn(), suggestFamily: vi.fn(), createNameVariant: vi.fn(), setPrimaryNameVariant: vi.fn(), list: vi.fn() },
  families: { create: vi.fn(), addChild: vi.fn(), search: vi.fn() },
  notes: { create: vi.fn() },
  places: { pinChains: vi.fn() },
}));
vi.mock('@/lib/data', async (orig) => ({ ...(await orig<typeof import('@/lib/data')>()), getDataClient: async () => client }));

import { AddPersonDialog } from '@/app/people/AddPersonDialog';

beforeEach(() => {
  vi.clearAllMocks();
  client.people.create.mockResolvedValue({ Id: 100, auditIds: [] });
  client.people.search.mockResolvedValue([]);
  client.people.suggestFamily.mockResolvedValue([]);
  client.people.list.mockResolvedValue({ people: [], count: 0 });
  client.families.search.mockResolvedValue([]);
});

const wrap = (ui: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

describe('Add person on desktop (#52)', () => {
  it('saves a named person and opens their page', async () => {
    wrap(<AddPersonDialog open onClose={vi.fn()} treeId={9} />);
    expect(screen.getByRole('dialog', { name: 'Add a person' })).toBeInTheDocument();
    const saveOpen = screen.getByRole('button', { name: 'Save and open' });
    expect(saveOpen).toBeDisabled();
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Nils' } });
    expect(saveOpen).toBeEnabled();
    await act(async () => { fireEvent.click(saveOpen); });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/people/view?id=100'));
    expect(client.people.create).toHaveBeenCalledWith(expect.objectContaining({ FirstName: 'Nils' }), { treeId: 9 });
  });

  it('renders nothing while closed', () => {
    wrap(<AddPersonDialog open={false} onClose={vi.fn()} treeId={9} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
