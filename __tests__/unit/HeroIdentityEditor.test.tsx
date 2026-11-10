/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 1 }) }));
vi.mock('@/lib/data', () => ({
    getDataClient: async () => ({ places: { pinChains: async () => ({}) } }),
}));
// The real date and place fields are covered by their own suites; plain inputs keep
// this one about what the hero editor saves.
vi.mock('@/app/components/DateInput', () => ({
    default: ({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) => (
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    ),
}));
vi.mock('@/app/components/LocationField', () => ({
    default: ({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) => (
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    ),
}));

import { HeroIdentityEditor } from '@/app/people/view/HeroIdentityEditor';

const person = {
    Id: 7,
    FirstName: 'Ada',
    LastName: 'Lovelace',
    Sex: 'F',
    IsDeceased: 0,
    BirthDate: '10 DEC 1815',
    BirthPlace: 'London',
    DeathDate: null,
    DeathPlace: null,
} as never;

function renderEditor() {
    const onSave = vi.fn(async () => {});
    render(<HeroIdentityEditor person={person} onSave={onSave} onDelete={vi.fn()} onCancel={vi.fn()} saving={false} canDelete />);
    return onSave;
}

describe('HeroIdentityEditor vital dates (#795)', () => {
    it('edits birth and death date and place, sending only the columns that changed', () => {
        const onSave = renderEditor();
        expect(screen.getByLabelText('birth_date')).toHaveValue('10 DEC 1815');
        expect(screen.getByLabelText('birth_place')).toHaveValue('London');

        fireEvent.change(screen.getByLabelText('death_date'), { target: { value: '27 NOV 1852' } });
        fireEvent.change(screen.getByLabelText('birth_place'), { target: { value: '  ' } });
        fireEvent.click(screen.getByText('save_changes'));

        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            vitals: { DeathDate: '27 NOV 1852', BirthPlace: null },
            // Entering a death marks the person deceased, as the timeline's Death row does.
            IsDeceased: '1',
        }));
    });

    it('sends no vital columns when none changed', () => {
        const onSave = renderEditor();
        fireEvent.click(screen.getByText('save_changes'));
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ vitals: {}, IsDeceased: '0' }));
    });

    it('puts the vital fields after name, sex and living status in tab order', () => {
        renderEditor();
        const order = Array.from(document.querySelectorAll('input, button, [role="radio"]'));
        const living = screen.getByLabelText('living_status');
        const birthDate = screen.getByLabelText('birth_date');
        expect(order.indexOf(birthDate)).toBeGreaterThan(order.indexOf(living.querySelector('button, [role="radio"]') ?? living));
    });
});

describe('HeroIdentityEditor Escape (#798, KB-3)', () => {
    it('asks before Escape discards an edited name', async () => {
        const { UnsavedChangesProvider } = await import('@/app/components/UnsavedChangesProvider');
        const confirm = vi.fn().mockReturnValue(false);
        vi.stubGlobal('confirm', confirm);
        const onCancel = vi.fn();
        render(
            <UnsavedChangesProvider>
                <HeroIdentityEditor person={person} onSave={vi.fn(async () => {})} onDelete={vi.fn()} onCancel={onCancel} saving={false} canDelete />
            </UnsavedChangesProvider>,
        );
        const first = screen.getByDisplayValue('Ada');
        fireEvent.change(first, { target: { value: 'Adax' } });
        fireEvent.keyDown(first, { key: 'Escape' });
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });
});

describe('HeroIdentityEditor Living or Unknown over a death (#895)', () => {
    const dead = { ...(person as object), IsDeceased: 1, DeathDate: '27 NOV 1852', DeathPlace: 'Marylebone', DeathCause: 'Cancer' } as never;
    function renderDead() {
        const onSave = vi.fn(async () => {});
        render(<HeroIdentityEditor person={dead} onSave={onSave} onDelete={vi.fn()} onCancel={vi.fn()} saving={false} canDelete />);
        return onSave;
    }
    const pick = (label: string) => fireEvent.click(within(screen.getByRole('radiogroup', { name: 'living_status' })).getByRole('radio', { name: label }));

    it('asks before saving Living, then clears the death details on confirm', () => {
        const onSave = renderDead();
        pick('living');
        fireEvent.click(screen.getByText('save_changes'));
        expect(onSave).not.toHaveBeenCalled();
        expect(screen.getByText('clear_death_body_living')).toBeInTheDocument();

        fireEvent.click(screen.getByText('clear_death_confirm'));
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            IsDeceased: '0',
            clearDeath: true,
            vitals: expect.objectContaining({ DeathDate: null, DeathPlace: null }),
        }));
    });

    it('asks for Unknown too, and Cancel puts the status back without saving', () => {
        const onSave = renderDead();
        pick('unknown');
        fireEvent.click(screen.getByText('save_changes'));
        expect(screen.getByText('clear_death_body_unknown')).toBeInTheDocument();

        fireEvent.click(within(screen.getByRole('dialog')).getByText('cancel'));
        expect(onSave).not.toHaveBeenCalled();
        expect(within(screen.getByRole('radiogroup', { name: 'living_status' })).getByRole('radio', { name: 'deceased' })).toHaveAttribute('aria-checked', 'true');
    });

    it('does not ask when the status was not changed', () => {
        const onSave = renderDead();
        fireEvent.click(screen.getByText('save_changes'));
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ IsDeceased: '1', clearDeath: false }));
    });
});
