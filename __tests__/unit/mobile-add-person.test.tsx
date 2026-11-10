/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// Stable translator: the form's load effects depend on `t`.
const stableT = Object.assign((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${Object.values(values).join(',')}` : key, { has: () => false, rich: (key: string) => key });
vi.mock('next-intl', () => ({ useTranslations: () => stableT }));
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 9 }) }));
vi.mock('@/app/components/ui/Sheet', () => ({
  Sheet: ({ open, title, children, onSave, onBack, dirty, saveWhenClean, saveDisabled, saveLabel }: {
    open: boolean; title: string; children: React.ReactNode; onSave?: () => void; onBack?: () => void;
    dirty?: boolean; saveWhenClean?: boolean; saveDisabled?: boolean; saveLabel?: string;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {onBack && <button type="button" onClick={onBack}>sheet-back</button>}
        {onSave && <button type="button" onClick={onSave} disabled={saveDisabled || !(dirty || saveWhenClean)}>{saveLabel ?? 'sheet-save'}</button>}
        {children}
      </div>
    ) : null,
  ConfirmSheet: ({ open, title, confirmLabel, onConfirm, onClose }: { open: boolean; title: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }) =>
    open ? (
      <div role="alertdialog" aria-label={title}>
        <button type="button" onClick={onConfirm}>{confirmLabel}</button>
        <button type="button" onClick={onClose}>keep</button>
      </div>
    ) : null,
}));
vi.mock('@/app/components/DateInput', () => ({
  default: ({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) =>
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock('@/app/components/LocationField', () => ({
  default: ({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) =>
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => <span /> }));
vi.mock('@/app/components/citations/CiteSheets', () => ({ CiteSheets: () => null }));
// The shared picker has its own suite; here it only hands back picks.
vi.mock('@/app/components/PersonPickerSheet', async (orig) => ({
  ...(await orig<typeof import('@/app/components/PersonPickerSheet')>()),
  PersonPickerSheet: (p: { open: boolean; title: string; multiple?: boolean; onPick: (x: unknown[]) => void; suggested?: { label: string; people: { Id: number }[] } }) =>
    p.open ? (
      <div role="dialog" aria-label={p.title}>
        {p.suggested && <p>{p.suggested.label}: {p.suggested.people.map((x) => x.Id).join(',')}</p>}
        <button type="button" onClick={() => p.onPick(p.multiple
          ? [{ kind: 'existing', person: { Id: 41, FirstName: 'Karin', LastName: 'Berg', BirthDate: '1896' } }, { kind: 'new', draft: { firstName: 'Erik', lastName: 'Berg', sex: null, birthDate: null } }]
          : [{ kind: 'new', draft: { firstName: 'Anders', lastName: 'Holm', sex: 'M', birthDate: null } }])}>pick</button>
      </div>
    ) : null,
}));

const client = vi.hoisted(() => ({
  people: {
    create: vi.fn(), search: vi.fn(), suggestFamily: vi.fn(), createNameVariant: vi.fn(), setPrimaryNameVariant: vi.fn(),
    list: vi.fn(),
  },
  families: { create: vi.fn(), addChild: vi.fn(), search: vi.fn() },
  notes: { create: vi.fn() },
  places: { pinChains: vi.fn() },
}));
vi.mock('@/lib/data', async (orig) => ({ ...(await orig<typeof import('@/lib/data')>()), getDataClient: async () => client }));

import { AddPersonSheet } from '@/app/people/AddPersonSheet';
import { dataCache } from '@/lib/data/cache';

const people = [
  { Id: 40, FirstName: 'Karin', LastName: 'Berg', Sex: 'F', BirthDate: '1896', DeathDate: null, FatherName: null, MotherName: null },
  { Id: 42, FirstName: 'Old', LastName: 'Berg', Sex: 'M', BirthDate: '1820', DeathDate: null, FatherName: null, MotherName: null },
  { Id: 43, FirstName: 'Lisa', LastName: 'Holm', Sex: 'F', BirthDate: '1899', DeathDate: null, FatherName: null, MotherName: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  dataCache.clear();
  Object.defineProperty(window, 'matchMedia', {
    writable: true, configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })),
  });
  client.people.create.mockImplementation(async (p: { FirstName: string }) => ({ Id: p.FirstName === 'Nils' ? 100 : 200 + client.people.create.mock.calls.length, auditIds: [] }));
  client.people.search.mockResolvedValue([]);
  client.people.suggestFamily.mockResolvedValue([]);
  client.people.list.mockResolvedValue({ people, count: people.length });
  client.families.create.mockResolvedValue({ Id: 60 });
  client.families.addChild.mockResolvedValue({});
  client.families.search.mockResolvedValue([]);
});

const field = (name: string) => screen.getByLabelText(name);
const save = () => screen.getByRole('button', { name: 'sheet-save' });

describe('Add person on the phone (#1065)', () => {
  it('keeps Save dim until a name is typed, and saves to the new person’s page', async () => {
    render(<AddPersonSheet open onClose={vi.fn()} treeId={9} />);
    expect(save()).toBeDisabled();
    fireEvent.change(field('first_name'), { target: { value: 'Nils' } });
    expect(save()).toBeEnabled();
    await act(async () => { fireEvent.click(save()); });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/people/view?id=100'));
    expect(client.people.create).toHaveBeenCalledWith(expect.objectContaining({ FirstName: 'Nils' }), { treeId: 9 });
  });

  it('shows the death only for someone deceased, and asks before clearing it', () => {
    render(<AddPersonSheet open onClose={vi.fn()} treeId={9} />);
    expect(screen.queryByText('group_died')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'status_deceased' }));
    expect(screen.getByText('group_died')).toBeInTheDocument();
    const died = screen.getByText('group_died').closest('section')!;
    fireEvent.change(within(died).getByLabelText('date'), { target: { value: '1950' } });

    fireEvent.click(screen.getByRole('radio', { name: 'status_living' }));
    const ask = screen.getByRole('alertdialog', { name: 'clear_death_title:living' });
    fireEvent.click(within(ask).getByText('keep'));
    expect(screen.getByText('group_died')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'status_living' }));
    fireEvent.click(screen.getByText('clear_death_confirm'));
    expect(screen.queryByText('group_died')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'status_living' })).toHaveAttribute('aria-checked', 'true');
  });

  it('takes a likely family in one tap and moves it under Parents', async () => {
    client.people.suggestFamily.mockResolvedValue([
      { role: 'child', score: 1, familyId: 7, husbandName: 'Anders Berg', wifeName: 'Greta Berg', marriageDate: '1893', childCount: 6, personFirstName: null, personLastName: null, personName: null, personBirthDate: null },
    ]);
    render(<AddPersonSheet open onClose={vi.fn()} treeId={9} />);
    fireEvent.change(field('last_name'), { target: { value: 'Berg' } });
    const born = screen.getByText('group_born').closest('section')!;
    fireEvent.change(within(born).getByLabelText('date'), { target: { value: '1896' } });
    const row = await screen.findByRole('button', { name: /child_of:Anders Berg & Greta Berg/ }, { timeout: 2000 });
    fireEvent.click(row);
    expect(screen.queryByRole('button', { name: /child_of:/ })).not.toBeInTheDocument();
    expect(screen.getByText('Anders Berg & Greta Berg')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'relationship' })).toBeInTheDocument();
  });

  it('stages a new partner and children, then saves them into one family', async () => {
    render(<AddPersonSheet open onClose={vi.fn()} treeId={9} />);
    fireEvent.change(field('first_name'), { target: { value: 'Nils' } });
    fireEvent.change(field('last_name'), { target: { value: 'Berg' } });
    const born = screen.getByText('group_born').closest('section')!;
    fireEvent.change(within(born).getByLabelText('date'), { target: { value: '1870' } });

    fireEvent.click(screen.getByRole('button', { name: 'find_partner' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'partner' })).getByText('pick'));
    expect(screen.getByText('Anders Holm')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'add_children' }));
    const picker = screen.getByRole('dialog', { name: 'add_children' });
    // Same surname, born 16 to 50 years after 1870: Karin, not Old Berg or Lisa Holm.
    await waitFor(() => expect(within(picker).getByText(/suggested_window/)).toHaveTextContent(': 40'));
    fireEvent.click(within(picker).getByText('pick'));
    expect(screen.getByText('children_n:2')).toBeInTheDocument();

    await act(async () => { fireEvent.click(save()); });
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(client.families.create).toHaveBeenCalledTimes(1);
    expect(client.families.create).toHaveBeenCalledWith(expect.objectContaining({ Partner1Id: 100 }), 9);
    expect(client.families.addChild).toHaveBeenCalledWith(60, 41, 'Birth', 9);
    expect(client.families.addChild).toHaveBeenCalledTimes(2);
  });
});
