/**
 * @vitest-environment happy-dom
 *
 * The event notes rail (#545). GEDCOM import writes NoteLink(OwnerTable='Events')
 * rows; before this mount no screen showed them. What these tests protect:
 *   - a reader WITHOUT edit permission can open and read an event's notes;
 *   - opening costs one fetch, and only for the row opened — the counts that decide
 *     which rows offer the affordance ride in with the person payload;
 *   - the rail is never confused with the editor's "Note" box, which writes
 *     Events."Description" — a different field.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import type { PersonWithRelations } from '@/lib/db/schema';

const listForOwner = vi.fn();
const removeNote = vi.fn();
const pinChains = vi.fn();

vi.mock('@/lib/data', () => ({
    getDataClient: () => Promise.resolve({
        notes: { listForOwner, create: vi.fn(), update: vi.fn(), setPrimary: vi.fn(), remove: removeNote },
        places: { pinChains },
        events: { remove: vi.fn() },
        people: { update: vi.fn() },
    }),
}));

vi.mock('@/app/contexts/TreeContext', () => ({
    useTree: () => ({ activeTreeId: 99 }),
}));

// Heavy leaves of the inline editor — not under test here.
vi.mock('@/app/components/media/OwnerMediaCard', () => ({
    OwnerMediaCard: () => null,
}));
vi.mock('@/app/components/LocationField', () => ({
    __esModule: true,
    default: ({ value }: { value: string }) => <input readOnly placeholder="place" value={value} />,
}));
vi.mock('@/app/components/DateInput', () => ({
    __esModule: true,
    default: ({ value }: { value: string }) => <input readOnly placeholder="date" value={value} />,
}));

import { LifeEventsPanel } from '@/app/people/view/LifeEventsPanel';

const EVENT_ID = 42;

const NOTE = {
    Id: 5, OwnerId: 1, TreeId: 99, Text: 'Imported from the family GEDCOM.',
    GedcomXref: '@N1@', BackfilledFromPersonId: null, CreatedAt: '', IsPrimary: 0,
};

/** A person with one custom event, carrying the note count the payload supplies. */
function makePerson(noteCount: number, extraEvents: { Id: number; noteCount: number }[] = []): PersonWithRelations {
    const event = (Id: number, count: number) => ({
        Id, UserId: 1, TreeId: 99, Type: 'RESI', Date: '1911',
        Place: 'Deptford', Description: 'Lodging with his brother.',
        PersonId: 7, FamilyId: null, media: [], noteCount: count,
    });
    return {
        Id: 7, UserId: 1, TreeId: 99, FirstName: 'Alice', LastName: 'Owner',
        BirthDate: null, BirthPlace: null, DeathDate: null, DeathPlace: null, DeathCause: null,
        events: [event(EVENT_ID, noteCount), ...extraEvents.map((e) => event(e.Id, e.noteCount))],
    } as unknown as PersonWithRelations;
}

function renderPanel(person: PersonWithRelations, canEdit: boolean, personNotes: unknown[] = [], canDelete = canEdit) {
    return render(
        <NextIntlClientProvider locale="en" messages={en}>
            <LifeEventsPanel
                person={person}
                language="en"
                renderCitePin={() => null}
                tTypes={((k: string) => k) as never}
                placeCoords={{}}
                canEdit={canEdit}
                canDelete={canDelete}
                onChanged={() => {}}
                personNotes={personNotes as never}
            />
        </NextIntlClientProvider>,
    );
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
    const editPrefix = en.eventEdit.edit_event_named.replace('{event}', '').trim();
    await user.click(await screen.findByRole('button', { name: new RegExp(`^${editPrefix} `) }));
}

/** The row's "Show notes (n)" disclosure. */
function showNotesButton(count: number) {
    return screen.getAllByRole('button', { name: en.personDetail.event_notes_show.replace('{count}', String(count)) });
}

beforeEach(() => {
    vi.clearAllMocks();
    listForOwner.mockResolvedValue([]);
    removeNote.mockResolvedValue(undefined);
    pinChains.mockResolvedValue({});
});

describe('event notes rail — read-only reader', () => {
    it('lets a view-only reader open and read an event\'s notes', async () => {
        const user = userEvent.setup();
        listForOwner.mockResolvedValue([NOTE]);
        renderPanel(makePerson(1), false);

        // The count came with the person payload — nothing fetched yet.
        expect(listForOwner).not.toHaveBeenCalled();
        const toggle = showNotesButton(1)[0];
        expect(toggle).toHaveAttribute('aria-expanded', 'false');

        await user.click(toggle);
        await waitFor(() => expect(listForOwner).toHaveBeenCalledWith('Events', EVENT_ID, 99));
        expect(await screen.findByText(NOTE.Text)).toBeInTheDocument();
        expect(screen.getByText(en.personDetail.event_notes_title)).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: en.personDetail.event_notes_hide.replace('{count}', '1') }),
        ).toHaveAttribute('aria-expanded', 'true');
    });

    /**
     * `aria-expanded` says something opened; `aria-controls` says what. Without the
     * pair a screen-reader user is told "expanded" and left to hunt for the region.
     */
    it('points the disclosure at the region it reveals', async () => {
        const user = userEvent.setup();
        listForOwner.mockResolvedValue([NOTE]);
        renderPanel(makePerson(1), false);

        const toggle = showNotesButton(1)[0];
        const controls = toggle.getAttribute('aria-controls');
        expect(controls).toBeTruthy();
        // Closed: nothing claims the id yet, which is what `aria-expanded=false` means.
        expect(document.getElementById(controls!)).toBeNull();

        await user.click(toggle);
        await screen.findByText(NOTE.Text);
        const region = document.getElementById(controls!);
        expect(region).not.toBeNull();
        expect(within(region!).getByText(NOTE.Text)).toBeInTheDocument();
    });

    it('gives a view-only reader no add, edit or delete affordance', async () => {
        const user = userEvent.setup();
        listForOwner.mockResolvedValue([NOTE]);
        renderPanel(makePerson(1), false);
        await user.click(showNotesButton(1)[0]);

        const row = await screen.findByTestId('note-row');
        // Matched on the prefix of the Edit action's accessible name, which carries an
        // excerpt of the row's own note. An exact-name query would pass vacuously.
        const editPrefix = en.notes.edit_for.split('{')[0];
        expect(within(row).queryByRole('button', { name: new RegExp(`^${editPrefix}`) })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: en.notes.add_button })).not.toBeInTheDocument();
        // …and no route into the editor either, so the "Note" description box is
        // not reachable for them at all.
        expect(screen.queryByDisplayValue('Lodging with his brother.')).not.toBeInTheDocument();
    });

    it('offers no disclosure on an event with no notes', () => {
        renderPanel(makePerson(0), false);
        expect(screen.queryByRole('button', { name: /notes/i })).not.toBeInTheDocument();
        expect(listForOwner).not.toHaveBeenCalled();
    });

    it('fetches notes for the opened row only — never one request per row', async () => {
        const user = userEvent.setup();
        listForOwner.mockResolvedValue([NOTE]);
        renderPanel(makePerson(1, [{ Id: 43, noteCount: 2 }, { Id: 44, noteCount: 3 }]), false);

        // Three rows advertise notes; none of them has cost a request.
        expect(listForOwner).not.toHaveBeenCalled();
        await user.click(showNotesButton(1)[0]);
        await waitFor(() => expect(listForOwner).toHaveBeenCalledTimes(1));
        expect(listForOwner).toHaveBeenCalledWith('Events', EVENT_ID, 99);
    });
});

describe('event notes rail — editor', () => {
    it('keeps a contributor event editor free of destructive actions', async () => {
        const user = userEvent.setup();
        renderPanel(makePerson(0), true, [], false);

        const editPrefix = en.eventEdit.edit_event_named.replace('{event}', '').trim();
        await user.click(screen.getByRole('button', { name: new RegExp(`^${editPrefix} `) }));
        expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    });

    it('reads the open event\'s notes through Events + the event id', async () => {
        const user = userEvent.setup();
        listForOwner.mockResolvedValue([NOTE]);
        renderPanel(makePerson(0), true);

        expect(listForOwner).not.toHaveBeenCalled();
        await openEditor(user);
        await waitFor(() => expect(listForOwner).toHaveBeenCalledWith('Events', EVENT_ID, 99));
        expect(await screen.findByText(NOTE.Text)).toBeInTheDocument();
        // The counterpart of the view-only assertion above: an editor DOES get the
        // row's Edit, which proves that query finds a present button rather than
        // passing vacuously on a name nothing uses.
        const editPrefix = en.notes.edit_for.split('{')[0];
        expect(screen.getByRole('button', { name: new RegExp(`^${editPrefix}`) })).toBeInTheDocument();
    });

    it('can add a note to an event that has none (no disclosure to open)', async () => {
        const user = userEvent.setup();
        renderPanel(makePerson(0), true);
        expect(screen.queryByRole('button', { name: /notes/i })).not.toBeInTheDocument();

        await openEditor(user);
        expect(await screen.findByRole('button', { name: en.notes.add_button })).toBeInTheDocument();
    });

    /**
     * Deleting the LAST note through the read disclosure used to drop focus on
     * <body>: the row's affordance was gated on `noteTotal > 0`, so the reported
     * count of 0 unmounted the toggle, the region and the rail in the same commit
     * the card was trying to focus `[data-note-add]` in. The disclosure now also
     * stays mounted while it is OPEN, so the rail survives its own emptying.
     *
     * A standalone-card test cannot see this — the card is only unmounted by its
     * PARENT — which is why this one drives the whole panel.
     */
    it('keeps focus in the rail when the last note is deleted through the disclosure', async () => {
        const user = userEvent.setup();
        listForOwner.mockResolvedValue([NOTE]);
        // canEdit, but NOT editing: the row's own disclosure is the only mount.
        renderPanel(makePerson(1), true);

        await user.click(showNotesButton(1)[0]);
        const row = await screen.findByTestId('note-row');

        await user.click(within(row).getByTitle(en.common.delete));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: en.common.delete }));
        await waitFor(() => expect(removeNote).toHaveBeenCalledWith(NOTE.Id, 'Events', EVENT_ID, 99));

        // The rail is still mounted and empty, and focus landed on its add
        // affordance — the specific element, never a "not <body>" proxy.
        await waitFor(() =>
            expect(screen.getByRole('button', { name: en.notes.add_button })).toHaveFocus());
        expect(screen.getByText(en.notes.empty_edit)).toBeInTheDocument();
        // The toggle stayed too, now reading "Hide notes (0)", so the user can
        // close the rail they opened instead of being stranded in it.
        expect(
            screen.getByRole('button', { name: en.personDetail.event_notes_hide.replace('{count}', '0') }),
        ).toBeInTheDocument();
    });

    it('labels the rail so it is not the editor\'s Events."Description" box', async () => {
        const user = userEvent.setup();
        renderPanel(makePerson(0), true);
        await openEditor(user);

        // The rail's heading names what these are: notes on the event RECORD.
        expect(await screen.findByText(en.personDetail.event_notes_title)).toBeInTheDocument();
        // The description field is still its own separate control, holding the
        // event's Description — the two surfaces are never merged.
        expect(screen.getByDisplayValue('Lodging with his brother.')).toBeInTheDocument();
        expect(en.personDetail.event_notes_title).not.toBe(en.eventEdit.field_description);
    });

    /**
     * The field above the rail used to be labelled "Note", so the open editor showed
     * two things calling themselves notes. It is Events."Description" and now says so.
     */
    it('labels the description field Description, not Note', async () => {
        const user = userEvent.setup();
        renderPanel(makePerson(0), true);
        await openEditor(user);

        const field = await screen.findByLabelText(new RegExp(`^${en.eventEdit.field_description}`));
        expect(field).toHaveValue('Lodging with his brother.');
        expect(screen.queryByLabelText(/^Note ·/)).not.toBeInTheDocument();
    });
});

/**
 * Birth and Death notes (NoteLink."OwnerFact") belong to the PERSON, and used to sit in
 * the person's notes rail behind a small scope label. They now read on the timeline row
 * they describe.
 */
describe('vital notes rail — Birth and Death rows', () => {
    const BIRTH_NOTE = { ...NOTE, Id: 8, Text: 'Registered a week late.', OwnerFact: 'Birth' };
    const DEATH_NOTE = { ...NOTE, Id: 9, Text: 'Death certificate lists pneumonia.', OwnerFact: 'Death' };

    /** A person with intrinsic Birth and Death rows and no custom events. */
    function personWithVitals(): PersonWithRelations {
        return {
            Id: 7, UserId: 1, TreeId: 99, FirstName: 'Alice', LastName: 'Owner',
            BirthDate: '1901', BirthPlace: 'Deptford',
            DeathDate: '1975', DeathPlace: 'Kent', DeathCause: null,
            events: [],
        } as unknown as PersonWithRelations;
    }

    it('offers the disclosure on the birth row, seeded from the page\'s note list', async () => {
        const user = userEvent.setup();
        listForOwner.mockResolvedValue([BIRTH_NOTE, DEATH_NOTE]);
        renderPanel(personWithVitals(), false, [BIRTH_NOTE, DEATH_NOTE]);

        // Two rows each advertise one note, and neither has cost a request: the counts
        // came from the list the page's rail already fetched.
        expect(listForOwner).not.toHaveBeenCalled();
        expect(showNotesButton(1)).toHaveLength(2);

        await user.click(showNotesButton(1)[0]);
        // The owner is the PERSON — there is no Events row behind an intrinsic vital.
        await waitFor(() => expect(listForOwner).toHaveBeenCalledWith('People', 7, 99));
        expect(await screen.findByText(en.personDetail.birth_notes_title)).toBeInTheDocument();
    });

    it('shows each vital only its own notes', async () => {
        const user = userEvent.setup();
        listForOwner.mockResolvedValue([BIRTH_NOTE, DEATH_NOTE]);
        renderPanel(personWithVitals(), false, [BIRTH_NOTE, DEATH_NOTE]);

        await user.click(showNotesButton(1)[0]);
        expect(await screen.findByText(BIRTH_NOTE.Text)).toBeInTheDocument();
        // The death note came back in the same fetch — the card filters it out rather
        // than listing every note the person has under the birth heading.
        expect(screen.queryByText(DEATH_NOTE.Text)).not.toBeInTheDocument();
    });

    it('leaves an unscoped note off the vital rails entirely', async () => {
        const user = userEvent.setup();
        const general = { ...NOTE, Id: 10, Text: 'Kept bees for forty years.', OwnerFact: null };
        listForOwner.mockResolvedValue([BIRTH_NOTE, general]);
        renderPanel(personWithVitals(), false, [BIRTH_NOTE, general]);

        // Only Birth advertises a note; the general one belongs to the person's rail.
        expect(showNotesButton(1)).toHaveLength(1);
        await user.click(showNotesButton(1)[0]);
        expect(await screen.findByText(BIRTH_NOTE.Text)).toBeInTheDocument();
        expect(screen.queryByText(general.Text)).not.toBeInTheDocument();
    });

    /**
     * The disclosure only appears once a note exists, so the vital editor's rail is the
     * only way to write the first one. It replaced #545's write-only "Note" box, which
     * saved a note and then pointed the user at a rail that no longer lists it.
     */
    it('is the way to add the first birth note, from the vital editor', async () => {
        const user = userEvent.setup();
        renderPanel(personWithVitals(), true);
        expect(screen.queryByRole('button', { name: /notes/i })).not.toBeInTheDocument();

        const editPrefix = en.eventEdit.edit_event_named.replace('{event}', '').trim();
        await user.click(screen.getAllByRole('button', { name: new RegExp(`^${editPrefix} `) })[0]);

        expect(await screen.findByText(en.personDetail.birth_notes_title)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: en.notes.add_button })).toBeInTheDocument();
        // #545's composer and its "read it in their notes" hint are gone.
        expect(screen.queryByText(/Read and edit it in their notes/)).not.toBeInTheDocument();
    });

    /**
     * A GEDCOM `1 BIRT` with a `2 NOTE` and no DATE or PLAC promotes to empty Birth
     * columns, so the intrinsic row's normal guard (`shouldRenderColumnBirth`) says no.
     * The note is readable ONLY on that row now, so the row has to appear for it —
     * otherwise the import lands a note that is visible nowhere in the app.
     */
    it('renders a dateless birth row when it is the only home for a note', async () => {
        const user = userEvent.setup();
        const dateless = {
            Id: 7, UserId: 1, TreeId: 99, FirstName: 'Alice', LastName: 'Owner',
            BirthDate: null, BirthPlace: null, DeathDate: null, DeathPlace: null, DeathCause: null,
            events: [],
        } as unknown as PersonWithRelations;
        listForOwner.mockResolvedValue([BIRTH_NOTE]);
        renderPanel(dateless, false, [BIRTH_NOTE]);

        // Death has no note and no columns, so it stays absent — the row appears for
        // the note, not for every vital.
        expect(showNotesButton(1)).toHaveLength(1);
        await user.click(showNotesButton(1)[0]);
        expect(await screen.findByText(BIRTH_NOTE.Text)).toBeInTheDocument();
    });

    it('shows nothing at all for a person with neither vitals nor notes', () => {
        const bare = {
            Id: 7, UserId: 1, TreeId: 99, FirstName: 'Alice', LastName: 'Owner',
            BirthDate: null, BirthPlace: null, DeathDate: null, DeathPlace: null, DeathCause: null,
            events: [],
        } as unknown as PersonWithRelations;
        renderPanel(bare, false, []);
        expect(screen.getByText(en.personDetail.no_events_title)).toBeInTheDocument();
    });

    it('does not cancel the editor when Escape dismisses the delete confirm', async () => {
        const user = userEvent.setup();
        listForOwner.mockResolvedValue([BIRTH_NOTE]);
        renderPanel(personWithVitals(), true, [BIRTH_NOTE]);

        const editPrefix = en.eventEdit.edit_event_named.replace('{event}', '').trim();
        await user.click(screen.getAllByRole('button', { name: new RegExp(`^${editPrefix} `) })[0]);
        const row = await screen.findByTestId('note-row');
        await user.click(within(row).getByTitle(en.common.delete));
        expect(await screen.findByRole('dialog')).toBeInTheDocument();

        await user.keyboard('{Escape}');

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByRole('group', { name: en.eventEdit.editing_event })).toBeInTheDocument();
        expect(removeNote).not.toHaveBeenCalled();
    });

    it('offers no preferred affordance on a vital rail', async () => {
        const user = userEvent.setup();
        listForOwner.mockResolvedValue([BIRTH_NOTE]);
        renderPanel(personWithVitals(), true, [BIRTH_NOTE]);

        await user.click(showNotesButton(1)[0]);
        const row = await screen.findByTestId('note-row');

        // Edit and Delete are there; nothing offers to promote a birth note.
        expect(within(row).getByTitle(en.common.edit)).toBeInTheDocument();
        expect(within(row).queryByTitle(en.notes.make_primary)).not.toBeInTheDocument();
        expect(within(row).queryByTitle(en.notes.clear_primary)).not.toBeInTheDocument();
    });
});
