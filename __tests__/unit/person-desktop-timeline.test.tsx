/**
 * @vitest-environment happy-dom
 *
 * The desktop person timeline (#49, part 2): relatives' read-only rows, and
 * deletes that act at once with Undo when the page passes `run`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import en from '@/messages/en.json';
import type { PersonWithRelations } from '@/lib/db/schema';

const remove = vi.fn(async () => ({ auditIds: [3] }));
const update = vi.fn(async () => ({ auditIds: [4] }));
vi.mock('@/lib/data', () => ({
    getDataClient: () => Promise.resolve({
        notes: { listForOwner: vi.fn().mockResolvedValue([]) },
        places: { pinChains: vi.fn().mockResolvedValue({}) },
        events: { remove },
        people: { update },
    }),
}));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 99, activePermission: 'owner' }) }));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }) }));
vi.mock('@/app/components/media/OwnerMediaCard', () => ({ OwnerMediaCard: () => null }));
vi.mock('@/app/components/GuardedLink', () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

import { LifeEventsPanel } from '@/app/people/view/LifeEventsPanel';

const kid = (Id: number, FirstName: string, BirthDate: string, link: string) =>
    ({ Id, FirstName, LastName: 'Owner', BirthDate, BirthPlace: 'Deptford', Partner1Relationship: link, Partner2Relationship: 'Birth' });

const person = {
    Id: 7, UserId: 1, TreeId: 99, FirstName: 'Alice', LastName: 'Owner', IsDeceased: 1,
    BirthDate: '1900', BirthPlace: null, DeathDate: '1970', DeathPlace: 'Lyon', DeathCause: null,
    events: [{ Id: 42, UserId: 1, TreeId: 99, Type: 'PROB', Date: '1971', Place: 'Deptford', Description: null, PersonId: 7, FamilyId: null, media: [], noteCount: 0 }],
    spouses: [{
        family: { Id: 300, Partner1Id: 7, Partner2Id: 8, MarriageDate: '1925', MarriagePlace: 'Deptford', Type: 'Marriage' },
        person: { Id: 8, FirstName: 'Bob', LastName: 'Owner' },
        children: [kid(20, 'Cara', '1927', 'Birth'), kid(21, 'Dan', '1930', 'Adoption'), kid(22, 'Eve', '1931', 'Step')],
    }],
} as unknown as PersonWithRelations;

function renderPanel(run?: (write: () => Promise<{ auditIds: number[] }>, toast: { message: string }) => Promise<boolean>) {
    return render(
        <NextIntlClientProvider locale="en" messages={en}>
            <LifeEventsPanel
                person={person}
                language="en"
                renderCitePin={() => null}
                tTypes={((k: string) => ({ PROB: 'Probate', BIRT: 'Birth', DEAT: 'Death' } as Record<string, string>)[k] ?? k) as never}
               
                canEdit
                canDelete
                onChanged={() => {}}
                personNotes={[]}
                run={run as never}
            />
        </NextIntlClientProvider>,
    );
}

const deleteName = (event: string) => en.eventEdit.delete_event_named.replace('{event}', event);
const editName = (event: string) => en.eventEdit.edit_event_named.replace('{event}', event);

describe('desktop person timeline (#49)', () => {
    it('opens a row\'s editor from anywhere on the row, with no hover Edit or Delete', async () => {
        const user = userEvent.setup();
        renderPanel();
        expect(screen.queryByRole('button', { name: deleteName('Probate') })).toBeNull();
        await user.click(screen.getByTestId('timeline-event-42').querySelector('.ledger__body') as HTMLElement);
        expect(screen.getByRole('heading', { name: 'Edit probate' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: en.common.save_changes })).toBeInTheDocument();
    });

    it('shows the marriage and the births of own and adopted children, read-only, never a step-child', () => {
        renderPanel();
        expect(screen.getByRole('link', { name: /Marriage to Bob Owner/ })).toHaveAttribute('href', '/families/view?id=300');
        expect(screen.getByRole('link', { name: /Birth of Cara Owner/ })).toHaveAttribute('href', '/people/view?id=20');
        expect(screen.getByRole('link', { name: /Birth of Dan Owner/ })).toBeInTheDocument();
        expect(screen.queryByText(/Birth of Eve/)).toBeNull();
        // Read-only: only the person's own rows carry a delete.
        expect(screen.queryByRole('button', { name: new RegExp(`^${deleteName('')}.*Marriage`, 'i') })).toBeNull();
    });

    it('deletes an event at once through run, with no confirm', async () => {
        const user = userEvent.setup();
        const run = vi.fn(async (write: () => Promise<{ auditIds: number[] }>, _toast: { message: string }) => { void _toast; await write(); return true; });
        renderPanel(run);
        // The row opens its editor, where Delete lives (locked person board).
        await user.click(await screen.findByRole('button', { name: editName('Probate') }));
        await user.click(screen.getByRole('button', { name: en.eventEdit.delete_event }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(remove).toHaveBeenCalledWith(42, 99);
        expect(run.mock.calls[0][1]).toMatchObject({ message: 'Probate deleted' });
    });

    it('deleting the death sets the status to unknown, and the toast says so', async () => {
        const user = userEvent.setup();
        const run = vi.fn(async (write: () => Promise<{ auditIds: number[] }>, _toast: { message: string }) => { void _toast; await write(); return true; });
        renderPanel(run);
        await user.click(await screen.findByRole('button', { name: editName('Death') }));
        await user.click(screen.getByRole('button', { name: en.eventEdit.delete_event }));
        expect(update).toHaveBeenCalledWith(7, expect.objectContaining({ DeathDate: null, IsDeceased: null }), 99);
        expect(run.mock.calls[0][1]).toMatchObject({ message: 'Death deleted · status unknown' });
    });
});
