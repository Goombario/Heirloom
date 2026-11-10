/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';
import type { PersonResult } from '@/lib/db/schema';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => <span data-testid="avatar" /> }));
const search = vi.hoisted(() => vi.fn());
vi.mock('@/lib/data', () => ({ getDataClient: async () => ({ people: { search } }) }));

import { PersonPickerSheet } from '@/app/components/PersonPickerSheet';

const person = (Id: number, FirstName: string, LastName: string, BirthDate: string | null = null) =>
  ({ Id, FirstName, LastName, BirthDate, DeathDate: null, Sex: 'M' }) as unknown as PersonResult;

const karl = person(20, 'Karl', 'Halvorsen', '1913');
const arne = person(22, 'Arne', 'Halvorsen', '1919');
const olav = person(3, 'Olav', 'Halvorsen', '1890');

beforeEach(() => {
  search.mockReset();
  search.mockResolvedValue([karl, arne, olav]);
});

describe('PersonPickerSheet (#1059)', () => {
  it('shows suggestions first, searches the tree, and picks with one tap', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<PersonPickerSheet open onClose={vi.fn()} title="Add partner" excludeIds={[3]}
      suggested={{ label: 'Suggested', people: [arne] }} onPick={onPick} />);
    expect(screen.getByText('Suggested')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Arne Halvorsen/ })).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'halv');
    await waitFor(() => expect(screen.getByRole('button', { name: /Karl Halvorsen/ })).toBeInTheDocument());
    expect(search).toHaveBeenLastCalledWith('halv', undefined, 20);
    expect(screen.queryByText('Suggested')).toBeNull();
    // Excluded people never show.
    expect(screen.queryByRole('button', { name: /Olav/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Karl Halvorsen/ }));
    expect(onPick).toHaveBeenCalledWith([{ kind: 'existing', person: karl }]);
  });

  it('picks several with checkboxes and adds them from the header pill', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<PersonPickerSheet open onClose={vi.fn()} title="Add children" multiple onPick={onPick} />);
    await user.type(screen.getByRole('searchbox'), 'halv');
    await user.click(await screen.findByRole('checkbox', { name: /Karl/ }));
    await user.click(screen.getByRole('checkbox', { name: /Arne/ }));
    expect(screen.getByRole('checkbox', { name: /Karl/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'add_n:2' }));
    expect(onPick).toHaveBeenCalledWith([{ kind: 'existing', person: karl }, { kind: 'existing', person: arne }]);
  });

  it('creates someone from the typed name in the short form, with Back to the search', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<PersonPickerSheet open onClose={vi.fn()} title="Add child" allowCreate defaultLastName="Halvorsen" onPick={onPick} />);
    expect(screen.getByRole('button', { name: 'create_new' })).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'Hilda');
    await user.click(screen.getByRole('button', { name: 'create_named:Hilda' }));

    expect(screen.getByRole('dialog', { name: 'new_person' })).toBeInTheDocument();
    expect(screen.getByLabelText('first_name')).toHaveValue('Hilda');
    expect(screen.getByLabelText('last_name')).toHaveValue('Halvorsen');

    // A typed form asks before going Back.
    await user.click(screen.getByRole('button', { name: 'back' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'keep_editing' }));

    await user.click(screen.getByRole('radio', { name: 'sex_female' }));
    await user.type(screen.getByLabelText('born'), 'sometime');
    await user.click(screen.getByRole('button', { name: 'add' }));
    expect(screen.getByText('born_invalid')).toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('born'));
    await user.type(screen.getByLabelText('born'), '1896');
    await user.click(screen.getByRole('button', { name: 'add' }));
    expect(onPick).toHaveBeenCalledWith([{ kind: 'new', draft: { firstName: 'Hilda', lastName: 'Halvorsen', sex: 'F', birthDate: '1896' } }]);
  });

  it('stages a created person among the picks in multi-select', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<PersonPickerSheet open onClose={vi.fn()} title="Add children" multiple allowCreate onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: 'create_new' }));
    await user.type(screen.getByLabelText('first_name'), 'Nils');
    await user.click(screen.getByRole('button', { name: 'add' }));
    expect(screen.getByRole('checkbox', { name: /Nils/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'add' }));
    expect(onPick).toHaveBeenCalledWith([{ kind: 'new', draft: { firstName: 'Nils', lastName: '', sex: null, birthDate: null } }]);
  });
});
