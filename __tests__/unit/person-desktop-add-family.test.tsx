/** @vitest-environment happy-dom */

import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import type { PersonWithRelations } from '@/lib/db/schema';
import { AddFamilyPanel } from '@/app/people/view/desktop/AddFamilyPanel';

const carl = { Id: 3, FirstName: 'Carl', LastName: 'Berg', Sex: 'M', BirthDate: '1865', DeathDate: null };
const create = vi.fn(async () => ({ Id: 300, auditIds: [31] }));
vi.mock('@/lib/data', () => ({
  getDataClient: async () => ({
    people: { list: async () => ({ people: [] }), search: async () => [carl] },
    families: { create },
  }),
}));

vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => <span /> }));

const anna = { Id: 10, FirstName: 'Anna', LastName: 'Lind', Sex: 'F', BirthDate: '1868', parents: [], spouses: [] } as unknown as PersonWithRelations;
const wrap = (ui: ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

describe('desktop Add family (#49)', () => {
  it('finds a partner, says what happens, and writes the phone’s link plan', async () => {
    const run = vi.fn(async (w: () => Promise<unknown>, _toast: { message: string }) => { await w(); return true; });
    const onClose = vi.fn();
    wrap(<AddFamilyPanel person={anna} treeId={1} canUndo run={run} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Partner' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Add partner' }), { target: { value: 'Carl' } });
    fireEvent.click(await screen.findByRole('option', { name: /Carl Berg/ }, { timeout: 2000 }));

    const panel = screen.getByRole('group', { name: 'Add partner' });
    expect(panel).toHaveTextContent('Carl Berg (b. 1865) becomes Anna’s husband.');
    fireEvent.click(within(panel).getByRole('button', { name: 'Add' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith({ Partner1Id: 10, Partner2Id: 3, Type: 'Marriage' }, 1);
    expect(run.mock.calls[0][1]).toEqual({ message: 'Carl Berg added as Anna’s husband' });
  });
});
