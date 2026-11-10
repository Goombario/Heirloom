/**
 * @vitest-environment happy-dom
 *
 * The delete-event confirm names the event the way its timeline row reads it:
 * a formatted date ("About 1955"), not the stored GEDCOM value ("ABT 1955") (#901).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import type { PersonWithRelations } from '@/lib/db/schema';

vi.mock('@/lib/data', () => ({
    getDataClient: () => Promise.resolve({
        notes: { listForOwner: vi.fn().mockResolvedValue([]) },
        places: { pinChains: vi.fn().mockResolvedValue({}) },
        events: { remove: vi.fn() },
        people: { update: vi.fn() },
    }),
}));
vi.mock('@/app/contexts/TreeContext', () => ({
    useTree: () => ({ activeTreeId: 99 }),
}));
vi.mock('@/app/components/media/OwnerMediaCard', () => ({
    OwnerMediaCard: () => null,
}));

import { LifeEventsPanel } from '@/app/people/view/LifeEventsPanel';

const person = {
    Id: 7, UserId: 1, TreeId: 99, FirstName: 'Alice', LastName: 'Owner',
    BirthDate: 'BEF 1900', BirthPlace: null, DeathDate: null, DeathPlace: null, DeathCause: null,
    events: [{
        Id: 42, UserId: 1, TreeId: 99, Type: 'PROB', Date: 'ABT 1955', Place: 'Deptford',
        Description: null, PersonId: 7, FamilyId: null, media: [], noteCount: 0,
    }],
} as unknown as PersonWithRelations;

function renderPanel() {
    return render(
        <NextIntlClientProvider locale="en" messages={en}>
            <LifeEventsPanel
                person={person}
                language="en"
                renderCitePin={() => null}
                tTypes={((k: string) => ({ PROB: 'Probate', BIRT: 'Birth' } as Record<string, string>)[k] ?? k) as never}
                placeCoords={{}}
                canEdit
                canDelete
                onChanged={() => {}}
                personNotes={[]}
            />
        </NextIntlClientProvider>,
    );
}

const deleteName = (event: string) => en.eventEdit.delete_event_named.replace('{event}', event);

describe('delete-event confirm label (#901)', () => {
    it('shows a custom event\'s date formatted, with the translated type', async () => {
        const user = userEvent.setup();
        renderPanel();
        await user.click(await screen.findByRole('button', { name: new RegExp(`^${deleteName('')}.*Probate`, 'i') }));
        expect(await screen.findByText('Probate · About 1955 · Deptford')).toBeInTheDocument();
        expect(screen.queryByText(/ABT 1955/)).not.toBeInTheDocument();
    });

    it('shows a vital\'s date formatted', async () => {
        const user = userEvent.setup();
        renderPanel();
        await user.click(await screen.findByRole('button', { name: new RegExp(`^${deleteName('')}.*Birth`, 'i') }));
        expect(await screen.findByText('Birth · Before 1900')).toBeInTheDocument();
    });
});
