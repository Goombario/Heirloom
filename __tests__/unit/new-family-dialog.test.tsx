/** @vitest-environment happy-dom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));
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

const clara = { Id: 40, FirstName: 'Clara', LastName: 'Smith', Sex: 'F', BirthDate: '1899', DeathDate: '1978', DeathPlace: 'Brighton', PartnershipCount: 0 };
const client = vi.hoisted(() => ({
  people: { create: vi.fn(), search: vi.fn(), list: vi.fn(), get: vi.fn() },
  families: { create: vi.fn(), addChild: vi.fn() },
  events: { create: vi.fn() },
  audit: { revert: vi.fn() },
  places: { geocodeUpsert: vi.fn(), geocodeUpsertHierarchy: vi.fn() },
}));
vi.mock('@/lib/data', async (orig) => ({ ...(await orig<typeof import('@/lib/data')>()), getDataClient: async () => client }));

import { NewFamilyDialog } from '@/app/families/NewFamilyDialog';
import { dataCache } from '@/lib/data/cache';

beforeEach(() => {
  vi.clearAllMocks();
  dataCache.clear();
  client.people.list.mockResolvedValue({ people: [clara], count: 1 });
  client.people.search.mockResolvedValue([clara]);
  client.people.create.mockResolvedValue({ Id: 100, auditIds: [7] });
  client.families.create.mockResolvedValue({ Id: 60, MarriagePlaceId: null });
});

const wrap = (ui: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

describe('New family on desktop (#52)', () => {
  it('stages a found partner and a new one, ends with the death, and saves', async () => {
    const onCreated = vi.fn();
    wrap(<NewFamilyDialog open onClose={vi.fn()} onCreated={onCreated} />);
    const dlg = screen.getByRole('dialog', { name: 'New family' });
    const save = within(dlg).getByRole('button', { name: 'Save and open' });
    expect(save).toBeDisabled();

    fireEvent.click(within(dlg).getByRole('button', { name: /Add a partner/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Add a partner' }), { target: { value: 'Clara' } });
    fireEvent.click(await screen.findByRole('option', { name: /Clara Smith/ }, { timeout: 2000 }));
    expect(save).toBeEnabled();

    // Clara's death ends the family: Active is off and the ending comes from her page.
    await waitFor(() => expect(within(dlg).getByText(/Ended when Clara died, 1978, Brighton/)).toBeInTheDocument());

    fireEvent.click(within(dlg).getByRole('button', { name: /Add the other partner/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Add the other partner' }), { target: { value: 'Ada Lovell' } });
    fireEvent.click(screen.getByRole('option', { name: /Create “Ada Lovell”/ }));
    expect(within(dlg).getByText('Ada Lovell')).toBeInTheDocument();

    await act(async () => { fireEvent.click(save); });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(60));
    expect(client.people.create).toHaveBeenCalledWith({ FirstName: 'Ada', LastName: 'Lovell', Sex: null, BirthDate: null }, { treeId: 9 });
    expect(client.families.create).toHaveBeenCalledWith(expect.objectContaining({ Partner1Id: 40, Partner2Id: 100, Type: 'Marriage' }), 9);
    // A death ending writes no event.
    expect(client.events.create).not.toHaveBeenCalled();
  });
});
