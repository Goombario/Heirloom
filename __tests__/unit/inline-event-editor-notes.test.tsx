/**
 * The editor's free-text box, and what a synthetic vital row does NOT have.
 *
 * #545 made that box a write-only composer on a birth/death row: it created a
 * fact-scoped note on save and told the user to go read it on the person's notes
 * rail. Those notes now read on the timeline row itself, so the person's rail no
 * longer lists them and that instruction was false. The composer is gone; the
 * vital editor carries the notes rail directly (see life-events-notes-rail).
 *
 * What these tests protect:
 *   - a synthetic vital shows NO description box — there is no Events row to hold
 *     one, and its death cause belongs to the Cause input;
 *   - saving a vital creates no note and writes no Events row, so nothing is left
 *     behind by the removed composer;
 *   - on a REAL event row the box still writes Events."Description", and now says
 *     "Description" rather than "Note" — it never was one (see #561 for how that
 *     column exports).
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const eventsCreate = vi.fn();
const eventsUpdate = vi.fn();
const peopleUpdate = vi.fn();
const notesCreate = vi.fn();
const placesPinChains = vi.fn();

const client = {
    events: { create: eventsCreate, update: eventsUpdate },
    people: { update: peopleUpdate },
    notes: { create: notesCreate },
    places: { pinChains: placesPinChains, geocodeUpsert: vi.fn(), geocodeUpsertHierarchy: vi.fn() },
};

vi.mock('@/lib/data', () => ({
    getDataClient: () => Promise.resolve(client),
}));

vi.mock('@/app/contexts/TreeContext', () => ({
    useTree: () => ({ activeTreeId: 99 }),
}));

const stableT = (key: string) => key;
vi.mock('next-intl', () => ({
    useTranslations: () => stableT,
}));

vi.mock('@/app/components/LanguageProvider', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }),
}));

vi.mock('@/app/components/LocationField', () => ({
    __esModule: true,
    default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <input placeholder="place" value={value} onChange={(e) => onChange(e.target.value)} />
    ),
}));

vi.mock('@/app/components/media/OwnerMediaCard', () => ({
    OwnerMediaCard: () => null,
}));

import InlineEventEditor from '@/app/components/InlineEventEditor';

/** The desktop event panel's save button: "Add event" for a new event, "Save changes" for an edit. */
const SAVE = /^(add_event|save_changes)$/;

/** The Description textarea — labelled, so it is found the way a user finds it. */
const descriptionBox = () => screen.getByRole('textbox', { name: /field_description/ });
const queryDescriptionBox = () => screen.queryByRole('textbox', { name: /field_description/ });

function renderVital(vital: 'BIRT' | 'DEAT', description: string | null = null) {
    return render(
        <InlineEventEditor
            target={{ kind: 'person', personId: 4 }}
            event={{ Id: 0, Type: vital, Date: '1984', Place: null, Description: description } as never}
            vitalLock={vital}
            onCancel={() => {}}
            onSaved={() => {}}
        />
    );
}

function renderAddVital(vital: 'BIRT' | 'DEAT') {
    return render(
        <InlineEventEditor
            target={{ kind: 'person', personId: 4 }}
            defaultType={vital}
            allowVital={{ birth: vital === 'BIRT', death: vital === 'DEAT' }}
            onCancel={() => {}}
            onSaved={() => {}}
        />
    );
}

beforeEach(() => {
    eventsCreate.mockResolvedValue({ Id: 7 });
    eventsUpdate.mockResolvedValue(undefined);
    peopleUpdate.mockResolvedValue(undefined);
    notesCreate.mockResolvedValue({ Id: 11 });
    placesPinChains.mockResolvedValue({});
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('InlineEventEditor — a synthetic vital row has no free-text box', () => {
    it('offers no description box on a birth row', () => {
        renderVital('BIRT');
        // There is no Events row behind an intrinsic vital, so there is no
        // Description to edit. The row's notes are a rail, passed in as `notesSlot`.
        expect(queryDescriptionBox()).not.toBeInTheDocument();
    });

    it('keeps the cause on its own input, not in a text box beside it', () => {
        renderVital('DEAT', 'Heart failure');
        // The synthetic event's Description carries DeathCause — it belongs to the
        // Cause input and to nothing else.
        expect(screen.getByDisplayValue('Heart failure')).toBeInTheDocument();
        expect(queryDescriptionBox()).not.toBeInTheDocument();
    });

    it('creates no note and writes no Events row when a vital is saved', async () => {
        const user = userEvent.setup();
        renderVital('DEAT');

        await user.click(screen.getByRole('button', { name: SAVE }));

        // The vital still saves to the People columns, as it always did…
        await waitFor(() => expect(peopleUpdate).toHaveBeenCalled());
        // …and #545's composer left nothing behind that still writes on save.
        expect(notesCreate).not.toHaveBeenCalled();
        expect(eventsCreate).not.toHaveBeenCalled();
        expect(eventsUpdate).not.toHaveBeenCalled();
    });

    it('renders the notes rail it is given, inside its own block', () => {
        const { container } = render(
            <InlineEventEditor
                target={{ kind: 'person', personId: 4 }}
                event={{ Id: 0, Type: 'BIRT', Date: '1984', Place: null, Description: null } as never}
                vitalLock="BIRT"
                onCancel={() => {}}
                onSaved={() => {}}
                notesSlot={<div data-testid="rail">the rail</div>}
            />
        );
        // Inside the editor, not a sibling stacked beneath it — that stacking is what
        // made it read as a second, competing notes section.
        const rail = screen.getByTestId('rail');
        expect(container.firstElementChild?.contains(rail)).toBe(true);
    });
});

describe('InlineEventEditor — an add-event vital composes a scoped note', () => {
    it('shows and saves Cause for an add-event Death', async () => {
        const user = userEvent.setup();
        renderAddVital('DEAT');

        const cause = screen.getByRole('textbox', { name: /field_cause/ });
        await user.type(cause, 'Heart failure');
        await user.click(screen.getByRole('button', { name: SAVE }));

        await waitFor(() => expect(peopleUpdate).toHaveBeenCalledWith(
            4,
            expect.objectContaining({ DeathCause: 'Heart failure', IsDeceased: 1 }),
            99,
        ));
    });

    it('saves a Death note through the person note owner', async () => {
        const user = userEvent.setup();
        renderAddVital('DEAT');

        const note = screen.getByRole('textbox', { name: /field_note/ });
        await user.type(note, 'Remembered by the family.');
        await user.click(screen.getByRole('button', { name: SAVE }));

        await waitFor(() => expect(notesCreate).toHaveBeenCalledWith(
            'People', 4, 'Remembered by the family.', 99, 'Death',
        ));
        expect(peopleUpdate).toHaveBeenCalled();
        expect(eventsCreate).not.toHaveBeenCalled();
    });

    it('explains that a Birth note is scoped to the fact', () => {
        renderAddVital('BIRT');
        expect(screen.getByRole('textbox', { name: /field_note/ })).toHaveAccessibleDescription('note_scoped_birth_hint');
        expect(screen.queryByRole('textbox', { name: /field_cause/ })).not.toBeInTheDocument();
    });
});

describe('InlineEventEditor — the box on a REAL event row still writes Description', () => {
    function renderRealEvent() {
        return render(
            <InlineEventEditor
                target={{ kind: 'person', personId: 4 }}
                event={{ Id: 5, Type: 'RESI', Date: '1911', Place: null, Description: 'Lodging with his brother.' } as never}
                onCancel={() => {}}
                onSaved={() => {}}
            />
        );
    }

    it('writes Events."Description" and creates no note', async () => {
        const user = userEvent.setup();
        renderRealEvent();

        expect(descriptionBox()).toHaveValue('Lodging with his brother.');
        await user.clear(descriptionBox());
        await user.type(descriptionBox(), 'Moved out by the spring.');
        await user.click(screen.getByRole('button', { name: SAVE }));

        await waitFor(() => expect(eventsUpdate).toHaveBeenCalled());
        expect(eventsUpdate.mock.calls[0][1]).toMatchObject({ Description: 'Moved out by the spring.' });
        expect(notesCreate).not.toHaveBeenCalled();
    });

    /**
     * It was labelled "Note", which put a second thing calling itself a note directly
     * above the event's actual notes rail. It is the event's own value — the field
     * that holds "Blacksmith" on an OCCU — and the label now says so.
     */
    it('labels the box Description, and no longer offers one called Note', () => {
        renderRealEvent();
        expect(descriptionBox()).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: /field_note/ })).not.toBeInTheDocument();
    });
});
