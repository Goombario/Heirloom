/**
 * @vitest-environment happy-dom
 *
 * Deferred place-write behavior for InlineEventEditor (design spec §6.1).
 * LocationField is mocked to a plain input + exposed onResolve/onRemove hooks
 * so this test isolates InlineEventEditor's own flush logic, not LocationField's
 * debounced Photon resolution (already covered in LocationField.test.tsx).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const eventsCreate = vi.fn();
const eventsUpdate = vi.fn();
const peopleUpdate = vi.fn();
const placesGeocodeUpsertHierarchy = vi.fn();
const placesGeocodeUpsert = vi.fn();
const placesPinChains = vi.fn();

const client = {
    events: { create: eventsCreate, update: eventsUpdate },
    people: { update: peopleUpdate },
    places: { geocodeUpsertHierarchy: placesGeocodeUpsertHierarchy, geocodeUpsert: placesGeocodeUpsert, pinChains: placesPinChains },
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

// InlineEventEditor renders DateInput, which reads the active language for
// date-format parsing — not under test here, so stub it to 'en'.
vi.mock('@/app/components/LanguageProvider', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }),
}));

// Stand-in for LocationField: a plain input, plus a "Resolve" button the test
// clicks to simulate a debounced resolution completing (onResolve) and a
// "Remove" button to simulate Remove Pin (onRemove) — both wired to fixed
// payloads so the test controls exactly what InlineEventEditor receives.
vi.mock('@/app/components/LocationField', () => ({
    __esModule: true,
    default: ({ value, onChange, onResolve, onRemove, initialChain }: {
        value: string; onChange: (v: string) => void;
        onResolve?: (levels: unknown) => void; onRemove?: () => void;
        initialChain?: { name: string; latitude: number | null; longitude: number | null; pinSuppressed: boolean; displayName: string | null }[] | null;
    }) => (
        <div>
            <input placeholder="place" value={value} onChange={(e) => onChange(e.target.value)} />
            <button type="button" onClick={() => onResolve?.([{ name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2 }])}>Resolve</button>
            <button type="button" onClick={() => onRemove?.()}>Remove</button>
            {initialChain && initialChain.length > 0 && (
                <span data-testid="initial-pin">{initialChain[initialChain.length - 1].latitude},{initialChain[initialChain.length - 1].longitude}</span>
            )}
        </div>
    ),
}));

import InlineEventEditor from '@/app/components/InlineEventEditor';

beforeEach(() => {
    eventsCreate.mockResolvedValue({ Id: 7 });
    eventsUpdate.mockResolvedValue({ Id: 7 });
    peopleUpdate.mockResolvedValue(undefined);
    placesGeocodeUpsertHierarchy.mockResolvedValue(undefined);
    placesGeocodeUpsert.mockResolvedValue(undefined);
    placesPinChains.mockResolvedValue({});
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('InlineEventEditor — new-event type default (FL-1)', () => {
    it('starts with no type, keeps Save disabled, and lists Birth, Death and Burial first', async () => {
        const user = userEvent.setup();
        render(<InlineEventEditor target={{ kind: 'person', personId: 1 }} allowVital={{ birth: true, death: true }} onCancel={() => {}} onSaved={() => {}} />);
        const trigger = screen.getByRole('combobox', { name: 'field_type' });
        expect(trigger).toHaveTextContent('choose_event');
        expect(screen.getByText('save_event').closest('button')).toBeDisabled();
        await user.click(trigger);
        const labels = screen.getAllByRole('option').map((o) => o.textContent);
        expect(labels.slice(0, 4)).toEqual(['choose_event', 'BIRT', 'DEAT', 'BURI']);
        await user.click(screen.getByRole('option', { name: 'BURI' }));
        expect(screen.getByText('save_event').closest('button')).toBeEnabled();
    });
});

describe('InlineEventEditor — pending place resolution (design spec §6.1)', () => {
    it('flushes a resolved hierarchy only after the event save succeeds', async () => {
        const user = userEvent.setup();
        render(<InlineEventEditor target={{ kind: 'person', personId: 1 }} defaultType="RESI" onCancel={() => {}} onSaved={() => {}} />);
        await user.type(screen.getByPlaceholderText('place'), 'Dover, Kent, England');
        await user.click(screen.getByText('Resolve'));
        expect(placesGeocodeUpsertHierarchy).not.toHaveBeenCalled();
        await user.click(screen.getByText('save_event'));
        await waitFor(() => expect(placesGeocodeUpsertHierarchy).toHaveBeenCalledWith(
            [{ name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2 }], 99,
        ));
    });

    it('Remove pin flushes a suppression on save, not the hierarchy call', async () => {
        const user = userEvent.setup();
        render(<InlineEventEditor target={{ kind: 'person', personId: 1 }} defaultType="RESI" onCancel={() => {}} onSaved={() => {}} />);
        await user.type(screen.getByPlaceholderText('place'), 'Dover, Kent, England');
        await user.click(screen.getByText('Remove'));
        await user.click(screen.getByText('save_event'));
        await waitFor(() => expect(placesGeocodeUpsert).toHaveBeenCalledWith(
            { name: 'Dover, Kent, England', latitude: null, longitude: null, pinSuppressed: true }, 99,
        ));
        expect(placesGeocodeUpsertHierarchy).not.toHaveBeenCalled();
    });

    it('an untouched place flushes nothing', async () => {
        const user = userEvent.setup();
        const onSaved = vi.fn();
        render(<InlineEventEditor target={{ kind: 'person', personId: 1 }} defaultType="RESI" onCancel={() => {}} onSaved={onSaved} />);
        await user.click(screen.getByText('save_event'));
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(placesGeocodeUpsertHierarchy).not.toHaveBeenCalled();
        expect(placesGeocodeUpsert).not.toHaveBeenCalled();
    });
});

/**
 * Guards fix (B) of #480 at the component boundary. The pure `vitalPatchFor`
 * tests cover ABSENT-vs-EMPTY, but only this editor decides WHICH it sends, and
 * `cause` state is seeded to '' when the Cause input is not rendered. Without
 * these, dropping the `showCauseInput ? cause : undefined` guard on the save call
 * reintroduces the silent data loss with every other test still green.
 */
describe('InlineEventEditor — death cause is sent when its input renders (#480)', () => {
    it('shows and sends DeathCause on the "Add event → Death" path', async () => {
        const user = userEvent.setup();
        render(
            <InlineEventEditor
                target={{ kind: 'person', personId: 1 }}
                defaultType="DEAT"
                allowVital={{ birth: false, death: true }}
                onCancel={() => {}}
                onSaved={() => {}}
            />
        );
        await user.type(screen.getByLabelText('field_cause'), 'Heart failure');
        await user.click(screen.getByText('save_event'));

        await waitFor(() => expect(peopleUpdate).toHaveBeenCalled());
        const patch = peopleUpdate.mock.calls[0][1];
        expect(patch).toMatchObject({ DeathCause: 'Heart failure', IsDeceased: 1 });
    });

    it('sends the edited cause when the synthetic death row does render the input', async () => {
        const user = userEvent.setup();
        render(
            <InlineEventEditor
                target={{ kind: 'person', personId: 1 }}
                event={{ Id: 0, Type: 'DEAT', Date: '1984', Place: null, Description: 'Heart failure' } as never}
                vitalLock="DEAT"
                onCancel={() => {}}
                onSaved={() => {}}
            />
        );
        await user.click(screen.getByText('save_event'));

        await waitFor(() => expect(peopleUpdate).toHaveBeenCalled());
        expect(peopleUpdate.mock.calls[0][1]).toMatchObject({ DeathCause: 'Heart failure' });
    });

    it('clears the cause when the rendered input is emptied', async () => {
        const user = userEvent.setup();
        render(
            <InlineEventEditor
                target={{ kind: 'person', personId: 1 }}
                event={{ Id: 0, Type: 'DEAT', Date: '1984', Place: null, Description: 'Heart failure' } as never}
                vitalLock="DEAT"
                onCancel={() => {}}
                onSaved={() => {}}
            />
        );
        await user.clear(screen.getByDisplayValue('Heart failure'));
        await user.click(screen.getByText('save_event'));

        await waitFor(() => expect(peopleUpdate).toHaveBeenCalled());
        // An emptied input IS a statement — this one must reach the column as null.
        expect(peopleUpdate.mock.calls[0][1]).toMatchObject({ DeathCause: null });
    });
});

describe('InlineEventEditor — edit-mode pre-existing pin display', () => {
    it('looks up the existing event Place pin chain once mounted in edit mode', async () => {
        placesPinChains.mockResolvedValueOnce({
            'Dover, Kent, England': [{ name: 'Dover, Kent, England', latitude: 51.1, longitude: 1.2, pinSuppressed: false, displayName: null }],
        });
        render(
            <InlineEventEditor
                target={{ kind: 'person', personId: 1 }}
                event={{ Id: 5, Type: 'BAPM', Date: '1840', Place: 'Dover, Kent, England', Description: null } as never}
                onCancel={() => {}}
                onSaved={() => {}}
            />
        );
        await waitFor(() => expect(placesPinChains).toHaveBeenCalledWith(['Dover, Kent, England'], 99));
        await waitFor(() => expect(screen.getByTestId('initial-pin')).toHaveTextContent('51.1,1.2'));
    });

    it('does not call pinChains() when creating a new event', async () => {
        render(<InlineEventEditor target={{ kind: 'person', personId: 1 }} defaultType="RESI" onCancel={() => {}} onSaved={() => {}} />);
        await new Promise((r) => setTimeout(r, 0));
        expect(placesPinChains).not.toHaveBeenCalled();
    });
});

describe('InlineEventEditor — persisted event writes', () => {
    it('uses the returned event ID through update when editing an existing event', async () => {
        const user = userEvent.setup();
        const onSaved = vi.fn();
        render(
            <InlineEventEditor
                target={{ kind: 'person', personId: 1 }}
                event={{ Id: 17, Type: 'BAPM', Date: '1840', Place: null, Description: null } as never}
                onCancel={() => {}}
                onSaved={onSaved}
            />
        );
        await user.click(screen.getByText('save_event'));

        await waitFor(() => expect(eventsUpdate).toHaveBeenCalledWith(
            17,
            expect.objectContaining({ Type: 'BAPM', PersonId: 1, FamilyId: null }),
            99,
        ));
        expect(eventsCreate).not.toHaveBeenCalled();
        expect(onSaved).toHaveBeenCalledTimes(1);
    });

    it('renders a translated generic error instead of the raw save failure', async () => {
        const user = userEvent.setup();
        eventsCreate.mockRejectedValueOnce(new Error('PGlite: relation Events does not exist'));
        render(<InlineEventEditor target={{ kind: 'person', personId: 1 }} defaultType="RESI" onCancel={() => {}} onSaved={() => {}} />);

        await user.click(screen.getByText('save_event'));

        await waitFor(() => expect(screen.getByText('error_generic')).toBeInTheDocument());
        expect(screen.queryByText('PGlite: relation Events does not exist')).not.toBeInTheDocument();
    });
});
