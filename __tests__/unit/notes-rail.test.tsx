/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import type { Note } from '@/lib/data/types';

const listForOwner = vi.fn();
const create = vi.fn();
const update = vi.fn();
const setPrimary = vi.fn();
const remove = vi.fn();

vi.mock('@/lib/data', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/data')>()),
    getDataClient: async () => ({ notes: { listForOwner, create, update, setPrimary, remove } }) as unknown as Awaited<
        ReturnType<typeof import('@/lib/data').getDataClient>
    >,
}));

import { OwnerNotesCard, NoteCount, biographyNote } from '@/app/components/notes/OwnerNotesCard';

/**
 * The Direction C notes rail. What these tests protect is presentation and
 * interaction: the preferred note must be identifiable from POSITION and LABEL
 * alone — never from colour — so every assertion here reads roles and text and
 * none of them reads a class name. A test that asserted on a class would pass
 * against a colour-only implementation, which is exactly the thing the design
 * forbids.
 */
const n = (over: Partial<Note> & { Id: number; Text: string }): Note => ({
    OwnerId: 1, TreeId: 1, GedcomXref: null, BackfilledFromPersonId: null,
    CreatedAt: '', IsPrimary: 0, ...over,
});

function renderCard(notes: Note[], canEdit = true, extra: Record<string, unknown> = {}) {
    listForOwner.mockResolvedValue(notes);
    return render(
        <NextIntlClientProvider locale="en" messages={en}>
            <OwnerNotesCard ownerTable="People" ownerId={7} treeId={1} canEdit={canEdit} canDelete={canEdit} {...extra} />
        </NextIntlClientProvider>,
    );
}

/** Opens the composer through the add affordance at the foot of the card. */
async function openComposer(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: en.notes.add_button }));
}

/**
 * A row's actions (#760) are named after its OWN note — five rows must not present
 * five identically-named buttons — so tests find them by their visible label, which
 * each action carries as its `title`, inside the row being worked on.
 */
const EDIT_PREFIX = en.notes.edit_for.split('{')[0];
let currentRow: HTMLElement | null = null;

/** The action focus returns to on a row: its first (Make preferred, else Edit). */
function triggerFor(row: HTMLElement): HTMLButtonElement {
    const trigger = row.querySelector<HTMLButtonElement>('.ev-act');
    if (!trigger) throw new Error('no row actions on that row');
    return trigger;
}

/** Selects the row whose text matches as the one `rowAction` looks in, and returns it. */
async function openMenu(_user: ReturnType<typeof userEvent.setup>, text: string) {
    const rows = await screen.findAllByTestId('note-row');
    const row = rows.find((r) => r.textContent?.includes(text));
    if (!row) throw new Error(`no note row containing "${text}"`);
    currentRow = row;
    return row;
}

const rowAction = (label: string) => within(currentRow!).getByTitle(label);
const queryRowAction = (label: string) => within(currentRow!).queryByTitle(label);

beforeEach(() => {
    vi.clearAllMocks();
    create.mockImplementation(async (_t, _o, text: string) => n({ Id: 99, Text: text }));
    update.mockImplementation(async (id: number, _t, _o, text: string) => n({ Id: id, Text: text }));
    setPrimary.mockResolvedValue(undefined);
    remove.mockResolvedValue(undefined);
});

it('discards an open composer draft when the owner scope changes', async () => {
    const user = userEvent.setup();
    listForOwner.mockResolvedValue([]);
    const view = render(
        <NextIntlClientProvider locale="en" messages={en}>
            <OwnerNotesCard ownerTable="People" ownerId={7} treeId={1} canEdit canDelete />
        </NextIntlClientProvider>,
    );
    await openComposer(user);
    await user.type(screen.getByRole('textbox', { name: en.notes.new_note }), 'belongs to owner seven');

    view.rerender(
        <NextIntlClientProvider locale="en" messages={en}>
            <OwnerNotesCard ownerTable="People" ownerId={8} treeId={1} canEdit canDelete />
        </NextIntlClientProvider>,
    );

    expect(screen.queryByDisplayValue('belongs to owner seven')).not.toBeInTheDocument();
    await waitFor(() => expect(listForOwner).toHaveBeenCalledWith('People', 8, 1));
    expect(create).not.toHaveBeenCalled();
});

it('ignores a note mutation that finishes after the owner scope changes', async () => {
    const user = userEvent.setup();
    let resolveCreate!: (note: Note) => void;
    create.mockImplementationOnce(() => new Promise(resolve => { resolveCreate = resolve; }));
    listForOwner.mockResolvedValue([]);
    const oldOwnerChanged = vi.fn();
    const newOwnerChanged = vi.fn();
    const view = render(
        <NextIntlClientProvider locale="en" messages={en}>
            <OwnerNotesCard ownerTable="People" ownerId={7} treeId={1} canEdit canDelete onNotesChange={oldOwnerChanged} />
        </NextIntlClientProvider>,
    );
    await screen.findByText(en.notes.empty_edit);
    await openComposer(user);
    await user.type(screen.getByRole('textbox', { name: en.notes.new_note }), 'owner seven only');
    await user.click(screen.getByRole('button', { name: en.notes.add_button }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('People', 7, 'owner seven only', 1, undefined));

    view.rerender(
        <NextIntlClientProvider locale="en" messages={en}>
            <OwnerNotesCard ownerTable="People" ownerId={8} treeId={1} canEdit canDelete onNotesChange={newOwnerChanged} />
        </NextIntlClientProvider>,
    );
    await waitFor(() => expect(listForOwner).toHaveBeenCalledWith('People', 8, 1));
    await screen.findByText(en.notes.empty_edit);
    const oldCalls = oldOwnerChanged.mock.calls.length;
    const newCalls = newOwnerChanged.mock.calls.length;

    await act(async () => {
        resolveCreate(n({ Id: 99, Text: 'owner seven only' }));
        await Promise.resolve();
    });

    expect(oldOwnerChanged).toHaveBeenCalledTimes(oldCalls);
    expect(newOwnerChanged).toHaveBeenCalledTimes(newCalls);
    expect(screen.queryByText('owner seven only')).not.toBeInTheDocument();
});

/**
 * The count lives in each surface's OWN heading, not in the card: four of the six
 * mounts already print "Notes" immediately above the card, so a built-in title
 * would say it twice. `NoteCount` is the single place the count is formatted, and
 * the card feeds it through `onNotesChange`.
 */
describe('notes rail — the count', () => {
    const renderCount = (count: number) => render(
        <NextIntlClientProvider locale="en" messages={en}>
            <h3>Notes <NoteCount count={count} /></h3>
        </NextIntlClientProvider>,
    );

    it('renders the count beside a surface heading', () => {
        renderCount(2);
        expect(screen.getByRole('heading')).toHaveTextContent('Notes (2)');
    });

    it('omits the count when there are none', () => {
        renderCount(0);
        expect(screen.getByRole('heading')).toHaveTextContent('Notes');
        expect(screen.queryByText(en.notes.count.replace('{count}', '0'))).not.toBeInTheDocument();
    });

    it('reports the list to the surface so it can be counted', async () => {
        const onNotesChange = vi.fn();
        renderCard([n({ Id: 1, Text: 'One' }), n({ Id: 2, Text: 'Two' })], true, { onNotesChange });
        await waitFor(() => expect(onNotesChange).toHaveBeenCalled());
        expect(onNotesChange.mock.calls.at(-1)![0]).toHaveLength(2);
    });

    it('draws no title of its own, so a labelled surface never says "Notes" twice', async () => {
        renderCard([n({ Id: 1, Text: 'One' })]);
        await screen.findByText('One');
        expect(screen.queryByRole('heading')).not.toBeInTheDocument();
        expect(screen.queryByText(en.notes.section_title)).not.toBeInTheDocument();
    });
});

describe('notes rail — failed reads', () => {
    it('shows a translated retryable error and keeps the empty state hidden until retry succeeds', async () => {
        listForOwner.mockRejectedValueOnce(new Error('private server text')).mockResolvedValueOnce([]);
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <OwnerNotesCard ownerTable="People" ownerId={7} treeId={1} canEdit canDelete />
            </NextIntlClientProvider>,
        );

        expect(await screen.findByText(en.common.error_generic)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: en.common.retry })).toBeInTheDocument();
        expect(screen.queryByText(en.notes.empty_edit)).not.toBeInTheDocument();

        await userEvent.setup().click(screen.getByRole('button', { name: en.common.retry }));
        await waitFor(() => expect(screen.getByText(en.notes.empty_edit)).toBeInTheDocument());
        expect(screen.queryByText('private server text')).not.toBeInTheDocument();
    });
});

describe('notes rail — preferred first', () => {
    it('shows the preferred note first, under its own label', async () => {
        renderCard([
            n({ Id: 1, Text: 'Second', IsPrimary: 0 }),
            n({ Id: 2, Text: 'The important one', IsPrimary: 1 }),
        ]);
        expect(await screen.findByText(en.notes.preferred_label)).toBeInTheDocument();
        const rows = screen.getAllByTestId('note-row');
        expect(rows[0]).toHaveTextContent('The important one');
    });

    it('files the rest under "Other notes"', async () => {
        renderCard([
            n({ Id: 1, Text: 'Second', IsPrimary: 0 }),
            n({ Id: 2, Text: 'The important one', IsPrimary: 1 }),
        ]);
        expect(await screen.findByText(en.notes.others_label)).toBeInTheDocument();
    });

    it('shows neither section label when nothing is preferred', async () => {
        renderCard([n({ Id: 1, Text: 'Only' })]);
        await screen.findByText('Only');
        expect(screen.queryByText(en.notes.preferred_label)).not.toBeInTheDocument();
        expect(screen.queryByText(en.notes.others_label)).not.toBeInTheDocument();
    });
});

describe('notes rail — the biography shown elsewhere (ED-3)', () => {
    it('leaves out the note the hero already shows, with no section labels', async () => {
        renderCard([
            n({ Id: 1, Text: 'Second', IsPrimary: 0 }),
            n({ Id: 2, Text: 'The biography', IsPrimary: 1 }),
        ], true, { shownElsewhereId: 2 });
        await screen.findByText('Second');
        expect(screen.queryByText('The biography')).not.toBeInTheDocument();
        expect(screen.queryByText(en.notes.preferred_label)).not.toBeInTheDocument();
        expect(screen.queryByText(en.notes.others_label)).not.toBeInTheDocument();
    });

    it('says "no other notes" when the biography is the only one', async () => {
        renderCard([n({ Id: 2, Text: 'The biography', IsPrimary: 1 })], true, { shownElsewhereId: 2 });
        expect(await screen.findByText(en.notes.empty_others_edit)).toBeInTheDocument();
        expect(screen.queryAllByTestId('note-row')).toHaveLength(0);
    });
});

describe('person biography rules (#902)', () => {
    it('falls back to the oldest imported or legacy note, never one written in the app', () => {
        const added = n({ Id: 1, Text: 'Typed in the rail', AddedInApp: 1 });
        const imported = n({ Id: 2, Text: 'From GEDCOM', AddedInApp: 0 });
        expect(biographyNote([added])).toBeNull();
        expect(biographyNote([added, imported])).toBe(imported);
        expect(biographyNote([n({ Id: 3, Text: 'Chosen', IsPrimary: 1, AddedInApp: 1 }), imported])?.Id).toBe(3);
    });

    it('labels the promote action "Use as the biography" and drops the composer\'s preferred box', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha', AddedInApp: 1 })], true, { shownElsewhereId: null, preferredIsBiography: true });
        await openMenu(user, 'Alpha');
        expect(rowAction(en.notes.use_as_biography)).toBeInTheDocument();
        expect(queryRowAction(en.notes.make_primary)).not.toBeInTheDocument();
        await openComposer(user);
        expect(screen.queryByLabelText(en.notes.set_preferred)).not.toBeInTheDocument();
    });

    it('"Use as the biography" sets the preferred note, replacing the current one', async () => {
        const user = userEvent.setup();
        const onNotesChange = vi.fn();
        renderCard([
            n({ Id: 1, Text: 'Alpha', AddedInApp: 1 }),
            n({ Id: 2, Text: 'Old biography', IsPrimary: 1 }),
        ], true, { shownElsewhereId: 2, preferredIsBiography: true, onNotesChange });
        await openMenu(user, 'Alpha');
        await user.click(rowAction(en.notes.use_as_biography));
        expect(setPrimary).toHaveBeenCalledWith(1, 'People', 7, true, 1);
        await waitFor(() => expect(onNotesChange).toHaveBeenLastCalledWith([
            expect.objectContaining({ Id: 1, IsPrimary: 1 }),
            expect.objectContaining({ Id: 2, IsPrimary: 0 }),
        ]));
    });
});

describe('notes rail — row actions', () => {
    it('offers make/unset preferred, edit and delete', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha' })]);
        await openMenu(user, 'Alpha');
        expect(rowAction(en.notes.make_primary)).toBeInTheDocument();
        expect(rowAction(en.common.edit)).toBeInTheDocument();
        expect(rowAction(en.common.delete)).toBeInTheDocument();
    });

    it('offers "unset preferred" on the preferred note', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha', IsPrimary: 1 })]);
        await openMenu(user, 'Alpha');
        expect(rowAction(en.notes.clear_primary)).toBeInTheDocument();
    });

});

/**
 * `role="menu"` is a promise about the keyboard, and these pin the promise. Task
 * 14 chose to IMPLEMENT the semantics rather than downgrade the role, so the
 * arrow keys must walk the items and every close must land focus somewhere a
 * keyboard user can carry on from — never on <body>.
 */
describe('notes rail — row action names and focus', () => {
    const row = async (text: string) =>
        (await screen.findAllByTestId('note-row')).find((r) => r.textContent?.includes(text))!;

    it('names each action after its own note, so a list of them is not five identical buttons', async () => {
        renderCard([n({ Id: 1, Text: 'Alpha' }), n({ Id: 2, Text: 'Beta' })]);
        await screen.findByText('Alpha');
        const a = triggerFor(await row('Alpha')).getAttribute('aria-label');
        const b = triggerFor(await row('Beta')).getAttribute('aria-label');
        expect(a).toContain('Alpha');
        expect(b).toContain('Beta');
        expect(a).not.toEqual(b);
    });

    it('shortens a long note in that name instead of reading the whole thing out', async () => {
        const long = 'Emigrated from Cork in the spring of 1867 aboard the Sirius, landing at Boston.';
        renderCard([n({ Id: 1, Text: long })]);
        await screen.findByText(long);
        const label = triggerFor(await row(long)).getAttribute('aria-label')!;
        expect(label.length).toBeLessThan(EDIT_PREFIX.length + 45);
        expect(label).toContain('Emigrated from Cork');
        expect(label.endsWith('…')).toBe(true);
    });

    it('returns focus to the ⋯ after promoting, which remounts the row', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha' }), n({ Id: 2, Text: 'Beta' })]);
        await openMenu(user, 'Beta');
        await user.click(rowAction(en.notes.make_primary));
        await waitFor(() => expect(setPrimary).toHaveBeenCalled());
        await waitFor(async () => expect(triggerFor(await row('Beta'))).toHaveFocus());
    });

    /**
     * The delete path hands focus back to the ⋯ BEFORE the dialog mounts, so the
     * dialog's own restore-on-close has a live element to return to rather than
     * the menu item it is about to unmount.
     */
    it('leaves focus on Delete after the delete dialog is dismissed', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha' })]);
        await openMenu(user, 'Alpha');
        await user.click(rowAction(en.common.delete));
        await user.click(screen.getByRole('button', { name: en.common.cancel }));
        await waitFor(() => expect(rowAction(en.common.delete)).toHaveFocus());
    });

    /**
     * A CONFIRMED delete takes the ⋯ away with the row, so there is nothing for the
     * dialog's own restore-on-close to return to — it aims at a detached node and
     * silently no-ops, dropping the user on <body>. The card has to name a live
     * destination itself.
     */
    it('moves focus to the row that takes the deleted one\'s place', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha' }), n({ Id: 2, Text: 'Beta' })]);
        await openMenu(user, 'Alpha');
        await user.click(rowAction(en.common.delete));
        await user.click(screen.getByRole('button', { name: en.common.delete }));

        await waitFor(() => expect(remove).toHaveBeenCalledWith(1, 'People', 7, 1));
        await waitFor(() => expect(screen.queryByText('Alpha')).not.toBeInTheDocument());
        await waitFor(async () => expect(triggerFor(await row('Beta'))).toHaveFocus());
    });

    it('falls back to the row above when the LAST row is deleted', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha' }), n({ Id: 2, Text: 'Beta' })]);
        await openMenu(user, 'Beta');
        await user.click(rowAction(en.common.delete));
        await user.click(screen.getByRole('button', { name: en.common.delete }));

        await waitFor(() => expect(screen.queryByText('Beta')).not.toBeInTheDocument());
        await waitFor(async () => expect(triggerFor(await row('Alpha'))).toHaveFocus());
    });

    it('moves focus to the add affordance when the last note is deleted', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha' })]);
        await openMenu(user, 'Alpha');
        await user.click(rowAction(en.common.delete));
        await user.click(screen.getByRole('button', { name: en.common.delete }));

        await waitFor(() => expect(screen.getByText(en.notes.empty_edit)).toBeInTheDocument());
        await waitFor(() => expect(screen.getByRole('button', { name: en.notes.add_button })).toHaveFocus());
    });

    /**
     * The same defect class on the error paths: the menu item the user activated is
     * unmounted before the request resolves, so a FAILURE has to hand focus back too.
     */
    it('returns focus to the ⋯ when a promote fails', async () => {
        const user = userEvent.setup();
        setPrimary.mockRejectedValue(new Error('nope'));
        renderCard([n({ Id: 1, Text: 'Alpha' }), n({ Id: 2, Text: 'Beta' })]);
        await openMenu(user, 'Beta');
        await user.click(rowAction(en.notes.make_primary));

        await waitFor(() => expect(setPrimary).toHaveBeenCalled());
        expect(screen.queryByText(en.notes.preferred_label)).not.toBeInTheDocument();
        await waitFor(async () => expect(triggerFor(await row('Beta'))).toHaveFocus());
    });

    /**
     * The delete FAILURE path is the one case that must NOT move focus: the dialog
     * stays open so the user can retry, and the Confirm they pressed is still there
     * holding focus. Pulling focus back to the rail behind an open modal would be a
     * worse bug than the one being fixed, so this pins the restraint.
     */
    it('leaves focus in the still-open dialog when a delete fails', async () => {
        const user = userEvent.setup();
        remove.mockRejectedValue(new Error('nope'));
        renderCard([n({ Id: 1, Text: 'Alpha' })]);
        await openMenu(user, 'Alpha');
        await user.click(rowAction(en.common.delete));
        const confirm = screen.getByRole('button', { name: en.common.delete });
        await user.click(confirm);

        await waitFor(() => expect(remove).toHaveBeenCalled());
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getAllByTestId('note-row')).toHaveLength(1);
        expect(confirm).toHaveFocus();
    });

    it('traps Tab inside the delete dialog and closes it on Escape', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha' })]);
        await openMenu(user, 'Alpha');
        await user.click(rowAction(en.common.delete));

        const dialog = screen.getByRole('dialog');
        const cancel = screen.getByRole('button', { name: en.common.cancel });
        const confirm = screen.getByRole('button', { name: en.common.delete });
        expect(cancel).toHaveFocus();
        await user.tab();
        expect(confirm).toHaveFocus();
        await user.tab();
        expect(cancel).toHaveFocus();
        expect(dialog).toHaveAttribute('aria-modal', 'true');

        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(remove).not.toHaveBeenCalled();
    });
});

describe('notes rail — editing', () => {
    async function startEdit(user: ReturnType<typeof userEvent.setup>, text: string) {
        await openMenu(user, text);
        await user.click(rowAction(en.common.edit));
        return screen.getByRole('textbox', { name: en.common.edit });
    }

    it('swaps the row for a textarea seeded with the note text', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha' })]);
        const box = await startEdit(user, 'Alpha');
        expect((box as HTMLTextAreaElement).value).toBe('Alpha');
    });

    it('saves on Ctrl+S', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha' })]);
        const box = await startEdit(user, 'Alpha');
        await user.clear(box);
        await user.type(box, 'Alpha revised');
        await user.keyboard('{Control>}s{/Control}');
        await waitFor(() => expect(update).toHaveBeenCalledWith(1, 'People', 7, 'Alpha revised', 1));
    });

    it('cancels on Escape without writing', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha' })]);
        const box = await startEdit(user, 'Alpha');
        await user.type(box, ' more');
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
        expect(update).not.toHaveBeenCalled();
    });

    it('hands focus back to the row\'s ⋯ when the edit is cancelled', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha' })]);
        await startEdit(user, 'Alpha');
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
        const row = screen.getAllByTestId('note-row')[0];
        await waitFor(() => expect(triggerFor(row)).toHaveFocus());
    });

    it('keeps the draft on blur', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha' })]);
        const box = await startEdit(user, 'Alpha');
        await user.type(box, ' more');
        await user.tab();
        expect((screen.getByRole('textbox', { name: en.common.edit }) as HTMLTextAreaElement).value)
            .toBe('Alpha more');
        expect(update).not.toHaveBeenCalled();
    });
});

describe('notes rail — composer', () => {
    it('starts closed, even for an owner with no notes', async () => {
        renderCard([]);
        await screen.findByText(en.notes.empty_edit);
        expect(screen.queryByRole('checkbox', { name: en.notes.set_preferred })).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: en.notes.new_note })).not.toBeInTheDocument();
    });

    it('pre-checks "set as preferred" only when the owner has no notes', async () => {
        const user = userEvent.setup();
        renderCard([]);
        await openComposer(user);
        expect(await screen.findByRole('checkbox', { name: en.notes.set_preferred })).toBeChecked();
    });

    it('leaves it unchecked when the owner already has notes', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha' })]);
        await openComposer(user);
        expect(screen.getByRole('checkbox', { name: en.notes.set_preferred })).not.toBeChecked();
    });

    it('marks the new note preferred when the box is checked', async () => {
        const user = userEvent.setup();
        renderCard([]);
        await openComposer(user);
        await user.type(screen.getByRole('textbox', { name: en.notes.new_note }), 'First ever');
        await user.click(screen.getByRole('button', { name: en.notes.add_button }));
        // The trailing `undefined` is the fact scope: an unscoped card creates
        // unscoped notes.
        await waitFor(() => expect(create).toHaveBeenCalledWith('People', 7, 'First ever', 1, undefined));
        await waitFor(() => expect(setPrimary).toHaveBeenCalledWith(99, 'People', 7, true, 1));
    });

    /**
     * `PersonDetailView` bumps `refreshKey` whenever the hero writes the preferred
     * note. A refetch must not resurrect a composer the user has dismissed, nor
     * re-tick a box they cleared.
     */
    it('stays closed across a refreshKey bump once dismissed', async () => {
        const user = userEvent.setup();
        const { rerender } = renderCard([], true, { refreshKey: 1 });
        await openComposer(user);
        await user.click(screen.getByRole('button', { name: en.common.cancel }));
        expect(screen.queryByRole('textbox', { name: en.notes.new_note })).not.toBeInTheDocument();

        rerender(
            <NextIntlClientProvider locale="en" messages={en}>
        <OwnerNotesCard ownerTable="People" ownerId={7} treeId={1} canEdit canDelete refreshKey={2} />
            </NextIntlClientProvider>,
        );
        await waitFor(() => expect(listForOwner).toHaveBeenCalledTimes(2));
        expect(screen.queryByRole('textbox', { name: en.notes.new_note })).not.toBeInTheDocument();
    });
});

describe('notes rail — scope label', () => {
    it('labels a fact-scoped note with its scope', async () => {
        renderCard([n({ Id: 1, Text: 'Baptism a day late.', IsPrimary: 0, OwnerFact: 'Birth' })]);
        expect(await screen.findByText(en.notes.scope_birth)).toBeInTheDocument();
        expect(await screen.findByTestId('note-scope')).toHaveTextContent(en.notes.scope_birth);
    });

    it('renders no scope label and no reserved space for an unscoped note', async () => {
        renderCard([n({ Id: 1, Text: 'General note.', IsPrimary: 0, OwnerFact: null })]);
        await screen.findByText('General note.');
        expect(screen.queryByText(/^scope_/)).not.toBeInTheDocument();
        expect(screen.queryByText(en.notes.scope_birth)).not.toBeInTheDocument();
        expect(screen.queryByText(en.notes.scope_death)).not.toBeInTheDocument();
        expect(screen.queryByText(en.notes.scope_marriage)).not.toBeInTheDocument();
        expect(screen.queryByTestId('note-scope')).not.toBeInTheDocument();
    });
});

describe('notes rail — unset preferred', () => {
    it('leaves an unset note in place rather than auto-promoting another', async () => {
        const user = userEvent.setup();
        renderCard([
            n({ Id: 1, Text: 'Second', IsPrimary: 0 }),
            n({ Id: 2, Text: 'The important one', IsPrimary: 1 }),
        ]);
        await openMenu(user, 'The important one');
        await user.click(rowAction(en.notes.clear_primary));

        await waitFor(() => expect(setPrimary).toHaveBeenCalledWith(2, 'People', 7, false, 1));
        await waitFor(() => expect(screen.queryByText(en.notes.preferred_label)).not.toBeInTheDocument());
        expect(screen.getAllByTestId('note-row')).toHaveLength(2);
    });
});

describe('notes rail — delete', () => {
    it('keeps contributor edit actions but hides delete', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Contributor note' })], true, { canDelete: false });
        await openMenu(user, 'Contributor note');
        expect(rowAction(en.common.edit)).toBeInTheDocument();
        expect(queryRowAction(en.common.delete)).not.toBeInTheDocument();
    });

    it('routes through the confirm modal, showing an excerpt', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha' })]);
        await openMenu(user, 'Alpha');
        await user.click(rowAction(en.common.delete));

        expect(screen.getByText(en.notes.delete_title)).toBeInTheDocument();
        expect(screen.getByText(en.notes.delete_blurb)).toBeInTheDocument();
        expect(screen.getByText('Alpha', { selector: 'blockquote' })).toBeInTheDocument();
        expect(remove).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: en.common.delete }));
        await waitFor(() => expect(remove).toHaveBeenCalledWith(1, 'People', 7, 1));
    });

    it('uses a distinct blurb when the target is the preferred note', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha', IsPrimary: 1 })]);
        await openMenu(user, 'Alpha');
        await user.click(rowAction(en.common.delete));

        expect(screen.getByText(en.notes.delete_blurb_preferred)).toBeInTheDocument();
        expect(screen.queryByText(en.notes.delete_blurb)).not.toBeInTheDocument();
    });
});

/**
 * `showPreferred={false}` — for the surfaces where nothing READS `IsPrimary`: the
 * family page, the tree sidebar, the timeline's rails. The affordance was a promise
 * the app never kept there. It is presentation only: no `IsPrimary` value is written
 * or cleared, so a note promoted on the person's page keeps its standing.
 */
describe('notes rail — preferred hidden', () => {
    const hidden = { showPreferred: false };

    it('offers no make-preferred item in the row menu', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha' })], true, hidden);
        await openMenu(user, 'Alpha');

        // Edit and Delete survive — proof the menu opened and the query is not vacuous.
        expect(rowAction(en.common.edit)).toBeInTheDocument();
        expect(rowAction(en.common.delete)).toBeInTheDocument();
        expect(queryRowAction(en.notes.make_primary)).not.toBeInTheDocument();
    });

    it('offers no unset item on a note that IS preferred, and never demotes it', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha', IsPrimary: 1 })], true, hidden);
        await openMenu(user, 'Alpha');

        expect(queryRowAction(en.notes.clear_primary)).not.toBeInTheDocument();
        expect(setPrimary).not.toHaveBeenCalled();
    });

    it('drops the section labels, leaving one flat list', async () => {
        renderCard([n({ Id: 1, Text: 'Alpha', IsPrimary: 1 }), n({ Id: 2, Text: 'Beta' })], true, hidden);
        expect(await screen.findByText('Alpha')).toBeInTheDocument();
        expect(screen.getByText('Beta')).toBeInTheDocument();
        expect(screen.queryByText(en.notes.preferred_label)).not.toBeInTheDocument();
        expect(screen.queryByText(en.notes.others_label)).not.toBeInTheDocument();
    });

    it('offers no set-as-preferred checkbox in the composer, and promotes nothing', async () => {
        const user = userEvent.setup();
        renderCard([], true, hidden);
        await openComposer(user);

        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        await user.type(screen.getByRole('textbox', { name: en.notes.new_note }), 'First one');
        await user.click(screen.getByRole('button', { name: en.notes.add_button }));

        await waitFor(() => expect(create).toHaveBeenCalled());
        // An empty owner's first note is normally pre-checked as preferred. With the
        // affordance hidden, an invisible checkbox must not promote it.
        expect(setPrimary).not.toHaveBeenCalled();
    });

    it('uses the plain delete blurb even for a preferred note', async () => {
        const user = userEvent.setup();
        renderCard([n({ Id: 1, Text: 'Alpha', IsPrimary: 1 })], true, hidden);
        await openMenu(user, 'Alpha');
        await user.click(rowAction(en.common.delete));

        // "the slot will be left empty" means nothing where no slot was on show.
        expect(screen.getByText(en.notes.delete_blurb)).toBeInTheDocument();
        expect(screen.queryByText(en.notes.delete_blurb_preferred)).not.toBeInTheDocument();
    });
});

/**
 * `factScope` — which of the owner's notes a card is for, by `NoteLink."OwnerFact"`.
 * A person's Birth/Death notes read on their timeline rows; the person's own rail
 * shows the unscoped ones. The card always FETCHES the whole list (one request feeds
 * every surface on the page) and narrows it here.
 */
describe('notes rail — fact scope', () => {
    const mixed = [
        n({ Id: 1, Text: 'A life in general.' }),
        n({ Id: 2, Text: 'Registered a week late.', OwnerFact: 'Birth' }),
        n({ Id: 3, Text: 'Certificate lists pneumonia.', OwnerFact: 'Death' }),
    ];

    it('shows every note when no scope is given', async () => {
        renderCard(mixed);
        expect(await screen.findAllByTestId('note-row')).toHaveLength(3);
    });

    it('shows only unscoped notes under "unscoped"', async () => {
        renderCard(mixed, true, { factScope: 'unscoped' });
        expect(await screen.findByText('A life in general.')).toBeInTheDocument();
        expect(screen.queryByText('Registered a week late.')).not.toBeInTheDocument();
        expect(screen.queryByText('Certificate lists pneumonia.')).not.toBeInTheDocument();
    });

    it('shows only the named fact when a fact is given', async () => {
        renderCard(mixed, true, { factScope: 'Birth' });
        expect(await screen.findByText('Registered a week late.')).toBeInTheDocument();
        expect(screen.queryByText('A life in general.')).not.toBeInTheDocument();
        expect(screen.queryByText('Certificate lists pneumonia.')).not.toBeInTheDocument();
    });

    it('creates new notes already scoped to that fact', async () => {
        const user = userEvent.setup();
        renderCard(mixed, true, { factScope: 'Death', showPreferred: false });
        await openComposer(user);
        await user.type(screen.getByRole('textbox', { name: en.notes.new_note }), 'Buried at St Mary.');
        await user.click(screen.getByRole('button', { name: en.notes.add_button }));

        // Without the trailing 'Death' the note would come back on the person's general
        // rail instead of the row it was written on.
        await waitFor(() => expect(create).toHaveBeenCalledWith('People', 7, 'Buried at St Mary.', 1, 'Death'));
    });

    it('creates unscoped notes with no fact at all', async () => {
        const user = userEvent.setup();
        renderCard(mixed, true, { factScope: 'unscoped' });
        await openComposer(user);
        await user.type(screen.getByRole('textbox', { name: en.notes.new_note }), 'Kept bees.');
        await user.click(screen.getByRole('button', { name: en.notes.add_button }));

        await waitFor(() => expect(create).toHaveBeenCalledWith('People', 7, 'Kept bees.', 1, undefined));
    });

    /**
     * The page needs the whole list even where the card shows a slice of it: the
     * timeline counts a person's Birth notes from what their rail reported.
     */
    it('reports the owner FULL list, not the filtered view', async () => {
        const onNotesChange = vi.fn();
        renderCard(mixed, true, { factScope: 'unscoped', onNotesChange });
        await waitFor(() => expect(onNotesChange).toHaveBeenCalled());
        expect(onNotesChange.mock.calls.at(-1)![0]).toHaveLength(3);
    });

    it('drops the per-row scope label when every row shares one scope', async () => {
        renderCard(mixed, true, { factScope: 'Birth' });
        await screen.findByText('Registered a week late.');
        // Unscoped card: the label distinguishes rows. Scoped card: it would repeat.
        expect(screen.queryByTestId('note-scope')).not.toBeInTheDocument();
    });

    it('keeps the scope label on an unfiltered card', async () => {
        renderCard(mixed);
        expect(await screen.findAllByTestId('note-scope')).toHaveLength(2);
    });

    /**
     * `updateNote` returns the Note row alone (`RETURNING n.*`); OwnerFact lives on the
     * NoteLink, so the merge has to carry it over the way it already carries IsPrimary.
     * Without that, editing a note on a scoped rail un-scoped it locally — the row the
     * user had just saved vanished out from under them and the count dropped to zero.
     */
    it('keeps an edited note on its scoped rail', async () => {
        const user = userEvent.setup();
        renderCard(mixed, true, { factScope: 'Birth', showPreferred: false });

        const row = await screen.findByTestId('note-row');
        await user.click(triggerFor(row));
        await user.click(rowAction(en.common.edit));

        const box = screen.getByRole('textbox', { name: en.common.edit });
        await user.clear(box);
        await user.type(box, 'Registered a fortnight late.');
        await user.click(screen.getByRole('button', { name: en.common.save }));

        await waitFor(() => expect(update).toHaveBeenCalled());
        expect(await screen.findByText('Registered a fortnight late.')).toBeInTheDocument();
        expect(screen.queryByText(en.notes.empty_edit)).not.toBeInTheDocument();
    });
});
