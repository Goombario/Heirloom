/** @vitest-environment happy-dom */

import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import type { EventWithMedia, GedcomEvent } from '@/lib/db/schema';

vi.mock('@/app/contexts/TreeContext', () => ({
    useTree: () => ({ activeTreeId: 99 }),
}));
vi.mock('@/app/components/LanguageProvider', () => ({
    useLanguage: () => ({ language: 'en' }),
}));
vi.mock('@/app/components/EventRowActions', () => ({
    EventRowActions: ({ onEdit, onDelete }: { onEdit: () => void; onDelete?: () => void }) => (
        <div>
            <button type="button" onClick={onEdit}>Edit event</button>
            {onDelete && <button type="button" onClick={onDelete}>Delete event</button>}
        </div>
    ),
}));
vi.mock('@/app/components/InlineEventEditor', () => ({
    default: ({ notesSlot, onDelete }: { notesSlot?: React.ReactNode; onDelete?: () => void }) => (
        <div data-testid="family-event-editor" data-has-delete={String(Boolean(onDelete))}>
            {notesSlot}
            {onDelete && <button type="button" onClick={onDelete}>Delete event</button>}
        </div>
    ),
}));
vi.mock('@/app/components/InlineMarriageEditor', () => ({ default: () => null }));
vi.mock('@/app/components/media/EventMediaStrip', () => ({ default: () => null }));
vi.mock('@/app/components/LocationMap', () => ({ default: () => null }));
vi.mock('@/app/components/Cite', () => ({
    default: ({ empty, more, factLabel, onClick }: { empty?: boolean; more?: boolean; factLabel?: string; onClick?: () => void }) =>
        (empty || more) && onClick ? <button type="button" onClick={() => onClick()}>{`${more ? 'Cite another' : 'Cite'} ${factLabel}`}</button> : null,
}));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => null }));
vi.mock('@/app/components/PersonPicker', () => ({ default: () => null }));
vi.mock('@/app/components/notes/OwnerNotesCard', () => ({
    OwnerNotesCard: ({ header, canEdit, canDelete, showPreferred, onNotesChange }: {
        header?: React.ReactNode;
        canEdit: boolean;
        canDelete: boolean;
        showPreferred?: boolean;
        onNotesChange?: (notes: Array<{ Id: number }>) => void;
    }) => (
        <div data-testid="notes-card" data-can-edit={String(canEdit)} data-can-delete={String(canDelete)} data-show-preferred={String(showPreferred)}>
            {header}
            <button type="button" data-testid="note-count-change" onClick={() => onNotesChange?.([{ Id: 1 }])}>Change notes</button>
        </div>
    ),
    NoteCount: ({ count }: { count: number }) => <span data-testid="note-count">{count}</span>,
}));
vi.mock('@/app/components/Timeline', () => ({
    Timeline: ({ items }: { items: Array<Record<string, React.ReactNode> & { key: string }> }) => (
        <div>
            {items.map((item) => (
                <div data-testid={`timeline-${item.key}`} key={item.key}>
                    {item.title}
                    {item.meta}
                    {item.citations}
                    {item.extra}
                    {item.actions}
                    {item.override}
                </div>
            ))}
        </div>
    ),
    TimelineWhenWhere: ({ date, place }: { date?: React.ReactNode; place?: React.ReactNode }) => <>{date}{place}</>,
}));
vi.mock('@/app/components/familyEventTypes', () => ({
    familyEventLabel: (type: string) => type,
}));

import { FamilyTimeline } from '@/app/families/view/sections';

const event = {
    Id: 17,
    UserId: 1,
    TreeId: 99,
    Type: 'DIV',
    Date: '1910',
    Place: null,
    Description: 'Divorce recorded',
    PersonId: null,
    FamilyId: 7,
    media: [],
    noteCount: 2,
} as unknown as EventWithMedia;

function Harness({ canEdit, canDelete, initiallyOpen = false, childList = [], onCitationClick = () => {}, events = [event], citationMap = {}, childAdoptions }: {
    canEdit: boolean; canDelete: boolean; initiallyOpen?: boolean; events?: EventWithMedia[]; childAdoptions?: GedcomEvent[];
    citationMap?: React.ComponentProps<typeof FamilyTimeline>['citationMap'];
    childList?: React.ComponentProps<typeof FamilyTimeline>['childList'];
    onCitationClick?: React.ComponentProps<typeof FamilyTimeline>['onCitationClick'];
}) {
    const [open, setOpen] = useState(() => new Set(initiallyOpen ? ['notes-fevent-17'] : []));
    return (
        <NextIntlClientProvider locale="en" messages={en}>
            <FamilyTimeline
                family={{ Id: 7, MarriageDate: null, MarriagePlace: null, Type: 'Marriage', events, childAdoptions }}
                childList={childList}
                citationMap={citationMap}
                sourceNumbers={new Map()}
                canEdit={canEdit}
                canDelete={canDelete}
                
                isOpen={(key) => open.has(key)}
                toggle={(key) => setOpen((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key); else next.add(key);
                    return next;
                })}
                earlierPartner={null}
                onCitationClick={onCitationClick}
                onChanged={() => {}}
            />
        </NextIntlClientProvider>
    );
}

/** The row's own control: "Edit DIV" (the familyEventTypes mock returns the code). */
const editDiv = new RegExp(`^${en.eventEdit.edit_event_named.replace('{event}', '')}`);

describe('FamilyTimeline event notes rail', () => {
    it('lazily discloses persisted family-event notes with an accessible region', async () => {
        const user = userEvent.setup();
        render(<Harness canEdit canDelete={false} />);

        const show = screen.getByRole('button', { name: '2 notes' });
        expect(show).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByTestId('notes-card')).not.toBeInTheDocument();

        await user.click(show);
        expect(screen.getByRole('button', { name: en.personDesktop.hide_notes })).toHaveAttribute('aria-controls', 'family-event-notes-17');
        expect(document.getElementById('family-event-notes-17')).toContainElement(screen.getByTestId('notes-card'));
        expect(screen.getByTestId('notes-card')).toHaveAttribute('data-can-edit', 'true');
        expect(screen.getByTestId('notes-card')).toHaveAttribute('data-can-delete', 'false');
        expect(screen.getByTestId('notes-card')).toHaveAttribute('data-show-preferred', 'false');
    });

    it('updates the disclosure count immediately after the rail reports a mutation', async () => {
        const user = userEvent.setup();
        render(<Harness canEdit canDelete={false} initiallyOpen />);

        expect(screen.getByTestId('note-count')).toHaveTextContent('2');
        await user.click(screen.getByTestId('note-count-change'));
        expect(screen.getByTestId('note-count')).toHaveTextContent('1');
        expect(screen.getByRole('button', { name: en.personDesktop.hide_notes })).toBeInTheDocument();
    });

    it('keeps contributors on edit-only actions while owners receive delete', async () => {
        const user = userEvent.setup();
        const { unmount } = render(<Harness canEdit canDelete={false} />);
        const eventRow = screen.getByTestId('timeline-fevent-17');
        // The row opens its editor (locked board); Edit and Delete are not hover actions.
        expect(within(eventRow).queryByRole('button', { name: 'Delete event' })).not.toBeInTheDocument();
        await user.click(within(eventRow).getByRole('button', { name: editDiv }));
        expect(screen.getByTestId('family-event-editor')).toHaveAttribute('data-has-delete', 'false');

        unmount();
        render(<Harness canEdit canDelete />);
        await user.click(within(screen.getByTestId('timeline-fevent-17')).getByRole('button', { name: editDiv }));
        expect(screen.getByTestId('family-event-editor')).toHaveAttribute('data-has-delete', 'true');
    });

    it('names the event in the delete confirm with its date as the row shows it (#901)', async () => {
        const user = userEvent.setup();
        render(<Harness canEdit canDelete events={[{ ...event, Date: 'ABT 1910', Place: 'Deptford' } as EventWithMedia]} />);
        await user.click(within(screen.getByTestId('timeline-fevent-17')).getByRole('button', { name: editDiv }));
        await user.click(screen.getByRole('button', { name: 'Delete event' }));
        expect(await screen.findByText('DIV · About 1910 · Deptford')).toBeInTheDocument();
    });

    it("cites a child's recorded birth in place, and offers no pin for an unrecorded one (#799)", async () => {
        const onCitationClick = vi.fn();
        const child = (Id: number, FirstName: string, BirthDate: string | null) =>
            ({ Id, FirstName, LastName: 'Bracken', BirthDate, BirthPlace: null, DeathDate: null, DeathPlace: null, Sex: 'F' }) as unknown as React.ComponentProps<typeof FamilyTimeline>['childList'][number];
        render(<Harness canEdit canDelete childList={[child(21, 'Ann', '1885'), child(22, 'Bea', null)]} onCitationClick={onCitationClick} />);

        await userEvent.click(screen.getByRole('button', { name: 'Cite Birth · Ann' }));
        expect(onCitationClick).toHaveBeenCalledWith('PersonBirth', 21, 'Birth · Ann', null);
        // Bea's row opens read-only in place, but carries no citation pin.
        expect(screen.queryByRole('button', { name: /Cite.*Bea/ })).not.toBeInTheDocument();
    });

    it("gives every child's recorded death a row, not only one under 18, so its citations have a pin", () => {
        const child = (Id: number, FirstName: string, BirthDate: string | null, DeathDate: string | null, DeathPlace: string | null = null) =>
            ({ Id, FirstName, LastName: 'Bracken', BirthDate, BirthPlace: null, DeathDate, DeathPlace, Sex: 'F' }) as unknown as React.ComponentProps<typeof FamilyTimeline>['childList'][number];
        render(<Harness canEdit canDelete childList={[
            child(31, 'Ann', '1762', '1786'),
            child(32, 'Bea', null, null, 'Evenmere'),
            child(33, 'Cora', '1770', null),
        ]} />);
        // Long timelines fold after five rows (the v1.1 ledger): open them all.
        const fold = screen.queryByRole('button', { name: /more event/ });
        if (fold) fireEvent.click(fold);

        const adult = screen.getByTestId('timeline-cdeath-31');
        expect(adult).toHaveTextContent('Death of Ann');
        expect(adult).toHaveTextContent('age 24');
        expect(within(adult).getByRole('button', { name: 'Cite Death of Ann' })).toBeInTheDocument();
        // A place-only death has no age to show, but still gets its row.
        expect(screen.getByTestId('timeline-cdeath-32')).toHaveTextContent('Death of Bea');
        expect(screen.getByTestId('timeline-cdeath-32')).not.toHaveTextContent('age');
        expect(screen.queryByTestId('timeline-cdeath-33')).not.toBeInTheDocument();
    });
});

// Task audit ED-6 / §11 (#826): Mary Ellen Byrne died in 1814, before a
// partnership estimated 1842. The timeline must not print "Partnership ended,
// Jan 27, 1814" above "Started, Estimated 1842".
describe('FamilyTimeline derived partnership end', () => {
    const renderTimeline = (marriageDate: string, deathDate: string) => render(
        <NextIntlClientProvider locale="en" messages={en}>
            <FamilyTimeline
                family={{ Id: 7, MarriageDate: marriageDate, MarriagePlace: null, Type: 'Marriage', events: [] }}
                childList={[]}
                citationMap={{}}
                sourceNumbers={new Map()}
                canEdit={false}
                canDelete={false}
                
                isOpen={() => false}
                toggle={() => {}}
                earlierPartner={{ Id: 3, FirstName: 'Mary Ellen', LastName: 'Byrne', BirthDate: '1813', DeathDate: deathDate, DeathPlace: null } as unknown as React.ComponentProps<typeof FamilyTimeline>['earlierPartner']}
                onCitationClick={() => {}}
                onChanged={() => {}}
            />
        </NextIntlClientProvider>,
    );

    it('omits the derived end row when the death falls before the start', () => {
        renderTimeline('EST 1842', '27 JAN 1814');
        expect(screen.queryByTestId('timeline-ended')).not.toBeInTheDocument();
    });

    it('keeps the derived end row for a death after the start', () => {
        renderTimeline('1842', '1871');
        expect(within(screen.getByTestId('timeline-ended')).getByText(en.families.partnership_ended, { exact: false })).toBeInTheDocument();
    });
});

// #900: a cited fact takes another source from a "+" after its chips, for editors only.
describe('FamilyTimeline add-another-source pin', () => {
    const cite = (Id: number, SourceId: number) => ({ Id, SourceId }) as never;

    it('offers an editor one "+" after a cited event that opens the add flow', async () => {
        const user = userEvent.setup();
        const onCitationClick = vi.fn();
        render(<Harness canEdit canDelete={false} onCitationClick={onCitationClick} citationMap={{ 'Events:17': [cite(1, 5)] }} />);

        const row = screen.getByTestId('timeline-fevent-17');
        await user.click(within(row).getByRole('button', { name: /^Cite another / }));
        expect(onCitationClick).toHaveBeenCalledWith('Events', 17, expect.any(String), null);
    });

    it('shows a viewer no "+" after cited chips', () => {
        render(<Harness canEdit={false} canDelete={false} citationMap={{ 'Events:17': [cite(1, 5)] }} />);
        expect(screen.queryByRole('button', { name: /^Cite another / })).not.toBeInTheDocument();
    });

    it('puts one "+" on a start row whose family and imported marriage are both cited', async () => {
        const user = userEvent.setup();
        const onCitationClick = vi.fn();
        render(<Harness canEdit canDelete={false} events={[]} onCitationClick={onCitationClick}
            citationMap={{ 'Families:7': [cite(1, 5)], 'FamilyMarriage:7': [cite(2, 6)] }} />);

        const more = screen.getAllByRole('button', { name: /^Cite another / });
        expect(more).toHaveLength(1);
        await user.click(more[0]);
        expect(onCitationClick).toHaveBeenCalledWith('Families', 7, expect.any(String), null);
    });
});

describe('FamilyTimeline child adoptions (#485)', () => {
    const child = { Id: 3, FirstName: 'Hazel', LastName: 'Bracken', BirthDate: '1930', BirthPlace: null } as unknown as React.ComponentProps<typeof FamilyTimeline>['childList'][number];
    const adoption = { Id: 40, Type: 'ADOP', Date: '1931', Place: 'Duluth', PersonId: 3, Description: null } as unknown as GedcomEvent;

    it('puts a child\'s ADOP event on the timeline, citable as that event', async () => {
        const user = userEvent.setup();
        const onCitationClick = vi.fn();
        render(<Harness canEdit canDelete={false} events={[]} childList={[child]} childAdoptions={[adoption]} onCitationClick={onCitationClick} />);
        const row = screen.getByTestId('timeline-adop-40');
        expect(row).toHaveTextContent('ADOP · Hazel');
        expect(row).toHaveTextContent('Duluth');
        await user.click(within(row).getByRole('button', { name: 'Cite ADOP · Hazel' }));
        expect(onCitationClick).toHaveBeenCalledWith('Events', 40, 'ADOP · Hazel', null);
    });

    it('shows nothing for an adoption whose person is not a child here', () => {
        render(<Harness canEdit canDelete={false} events={[]} childList={[child]} childAdoptions={[{ ...adoption, Id: 41, PersonId: 99 } as GedcomEvent]} />);
        expect(screen.queryByTestId('timeline-adop-41')).toBeNull();
    });
});
