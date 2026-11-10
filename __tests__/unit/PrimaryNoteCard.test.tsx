/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import type { Note } from '@/lib/data/types';

const create = vi.fn();
const update = vi.fn();
const setPrimary = vi.fn();
const remove = vi.fn();

vi.mock('@/lib/data', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/data')>()),
    getDataClient: async () => ({ notes: { create, update, setPrimary, remove } }) as unknown as Awaited<
        ReturnType<typeof import('@/lib/data').getDataClient>
    >,
}));

import { PrimaryNoteCard } from '@/app/people/view/PrimaryNoteCard';

/**
 * The hero "biographical note" on /people/view. It edits the person's PREFERRED
 * note (ADR 0010/0012) while keeping the original single-click editing feel of the
 * retired InlineNotesCard — the notes list below is the full CRUD surface, this
 * slot is the one-line biography.
 *
 * The behaviour that matters: writing here when the person has no preferred note
 * must CREATE one and mark it preferred in the same gesture, so the slot is never
 * a dead end; writing when one exists must EDIT that note rather than adding a
 * second one that silently outranks nothing.
 */
function wrap(ui: React.ReactNode) {
    return render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);
}

const existing: Note = {
    Id: 5, OwnerId: 1, TreeId: 1, Text: 'He was a farmer',
    GedcomXref: null, BackfilledFromPersonId: null, CreatedAt: '', IsPrimary: 1,
};

beforeEach(() => {
    vi.clearAllMocks();
    create.mockResolvedValue({ ...existing, Id: 9, Text: 'New bio', IsPrimary: 0 });
    update.mockResolvedValue({ ...existing, Text: 'Edited bio' });
    setPrimary.mockResolvedValue(undefined);
    remove.mockResolvedValue(undefined);
});

describe('PrimaryNoteCard — display', () => {
    it('shows the preferred note text', () => {
        wrap(<PrimaryNoteCard personId={3} personName="Percy" treeId={1} primaryNote={existing} canEdit onChanged={() => {}} />);
        expect(screen.getByText('He was a farmer')).toBeTruthy();
    });

    it('invites a click when empty and editable', () => {
        wrap(<PrimaryNoteCard personId={3} personName="Percy" treeId={1} primaryNote={null} canEdit onChanged={() => {}} />);
        expect(screen.getByText(en.personDetail.bio_prompt.replace('{name}', 'Percy'))).toBeTruthy();
    });

    it('shows the read-only empty text when not editable', () => {
        wrap(<PrimaryNoteCard personId={3} personName="Percy" treeId={1} primaryNote={null} canEdit={false} onChanged={() => {}} />);
        expect(screen.getByText(en.personDetail.bio_empty)).toBeTruthy();
    });

    it('is not clickable without edit permission', () => {
        const { container } = wrap(
            <PrimaryNoteCard personId={3} personName="Percy" treeId={1} primaryNote={existing} canEdit={false} onChanged={() => {}} />
        );
        expect(container.querySelector('button')).toBeNull();
    });
});

describe('PrimaryNoteCard — editing', () => {
    it('opens a textarea on click, seeded with the current text', async () => {
        const user = userEvent.setup();
        wrap(<PrimaryNoteCard personId={3} personName="Percy" treeId={1} primaryNote={existing} canEdit onChanged={() => {}} />);
        const button = screen.getByRole('button', { name: 'He was a farmer' });
        expect(button.getAttribute('aria-describedby')).toBe('bio-edit-description-3');
        expect(screen.getByText(en.personDetail.bio_edit_aria)).toBeTruthy();
        await user.click(button);
        expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('He was a farmer');
    });

    it('creates a note AND marks it preferred when there is none', async () => {
        const user = userEvent.setup();
        const onChanged = vi.fn();
        wrap(<PrimaryNoteCard personId={3} personName="Percy" treeId={1} primaryNote={null} canEdit onChanged={onChanged} />);

        await user.click(screen.getByRole('button', { name: en.personDetail.bio_prompt.replace('{name}', 'Percy') }));
        await user.type(screen.getByRole('textbox'), 'New bio');
        await user.tab(); // blur saves

        await waitFor(() => expect(create).toHaveBeenCalledWith('People', 3, 'New bio', 1));
        await waitFor(() => expect(setPrimary).toHaveBeenCalledWith(9, 'People', 3, true, 1));
        expect(update).not.toHaveBeenCalled();
        await waitFor(() => expect(onChanged).toHaveBeenCalled());
    });

    it('edits the existing preferred note instead of creating a second', async () => {
        const user = userEvent.setup();
        wrap(<PrimaryNoteCard personId={3} personName="Percy" treeId={1} primaryNote={existing} canEdit onChanged={() => {}} />);

        await user.click(screen.getByRole('button', { name: 'He was a farmer' }));
        await user.clear(screen.getByRole('textbox'));
        await user.type(screen.getByRole('textbox'), 'Edited bio');
        await user.tab();

        await waitFor(() => expect(update).toHaveBeenCalledWith(5, 'People', 3, 'Edited bio', 1));
        expect(create).not.toHaveBeenCalled();
        // Already preferred — no redundant round trip.
        expect(setPrimary).not.toHaveBeenCalled();
    });

    it('does not write when the text is unchanged', async () => {
        const user = userEvent.setup();
        wrap(<PrimaryNoteCard personId={3} personName="Percy" treeId={1} primaryNote={existing} canEdit onChanged={() => {}} />);
        await user.click(screen.getByRole('button', { name: 'He was a farmer' }));
        await user.tab();
        expect(create).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    it('does not create an empty note', async () => {
        const user = userEvent.setup();
        wrap(<PrimaryNoteCard personId={3} personName="Percy" treeId={1} primaryNote={null} canEdit onChanged={() => {}} />);
        await user.click(screen.getByRole('button', { name: en.personDetail.bio_prompt.replace('{name}', 'Percy') }));
        await user.type(screen.getByRole('textbox'), '   ');
        await user.tab();
        expect(create).not.toHaveBeenCalled();
    });

    it('detaches the note when the text is cleared', async () => {
        const user = userEvent.setup();
        wrap(<PrimaryNoteCard personId={3} personName="Percy" treeId={1} primaryNote={existing} canEdit onChanged={() => {}} />);
        await user.click(screen.getByRole('button', { name: 'He was a farmer' }));
        await user.clear(screen.getByRole('textbox'));
        await user.tab();
        // Unlinks from THIS person (deleted only if orphaned), matching the old
        // "clear the bio" gesture without destroying a note shared elsewhere.
        await waitFor(() => expect(remove).toHaveBeenCalledWith(5, 'People', 3, 1));
        expect(update).not.toHaveBeenCalled();
    });

    it('abandons the edit on Escape', async () => {
        const user = userEvent.setup();
        wrap(<PrimaryNoteCard personId={3} personName="Percy" treeId={1} primaryNote={existing} canEdit onChanged={() => {}} />);
        await user.click(screen.getByRole('button', { name: 'He was a farmer' }));
        await user.type(screen.getByRole('textbox'), ' and a poet');
        await user.keyboard('{Escape}');
        expect(update).not.toHaveBeenCalled();
        expect(screen.getByText('He was a farmer')).toBeTruthy();
    });
});

/**
 * Every person who predates the preferred concept has notes with `IsPrimary = 0` —
 * the People."Notes" backfill and every GEDCOM import produce them that way. A
 * strict "preferred only" hero would show an empty biography to people who plainly
 * have one, so the page falls back to the oldest note and editing through this slot
 * records the choice.
 */
describe('PrimaryNoteCard — legacy note with no preferred flag', () => {
    const unflagged: Note = { ...existing, IsPrimary: 0 };

    it('displays a note that was never marked preferred', () => {
        wrap(<PrimaryNoteCard personId={3} personName="Percy" treeId={1} primaryNote={unflagged} canEdit onChanged={() => {}} />);
        expect(screen.getByText('He was a farmer')).toBeTruthy();
    });

    it('promotes it on edit, so the choice is recorded', async () => {
        const user = userEvent.setup();
        wrap(<PrimaryNoteCard personId={3} personName="Percy" treeId={1} primaryNote={unflagged} canEdit onChanged={() => {}} />);
        await user.click(screen.getByRole('button', { name: 'He was a farmer' }));
        await user.clear(screen.getByRole('textbox'));
        await user.type(screen.getByRole('textbox'), 'Edited bio');
        await user.tab();

        await waitFor(() => expect(update).toHaveBeenCalledWith(5, 'People', 3, 'Edited bio', 1));
        await waitFor(() => expect(setPrimary).toHaveBeenCalledWith(5, 'People', 3, true, 1));
        expect(create).not.toHaveBeenCalled();
    });
});
