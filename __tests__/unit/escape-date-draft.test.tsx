/** @vitest-environment happy-dom */
// A date box commits only when it loses focus, so an editor's own dirty state
// can't see a date that was typed and not yet blurred. Escape must still ask
// before throwing it away (#861 item 1). These use the real DateInput.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 1, activePermission: 'owner' }) }));
vi.mock('@/lib/data', () => ({
    getDataClient: async () => ({ places: { pinChains: async () => ({}) } }),
}));
vi.mock('@/app/components/LanguageProvider', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }),
}));
vi.mock('@/app/components/LocationField', () => ({
    default: ({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) => (
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    ),
}));
vi.mock('@/app/components/PersonPicker', () => ({ default: () => <div /> }));

import { HeroIdentityEditor } from '@/app/people/view/HeroIdentityEditor';
import InlineEventEditor from '@/app/components/InlineEventEditor';
import InlineMarriageEditor from '@/app/families/view/InlineMarriageEditor';
import type { Person } from '@/lib/db/schema';

const person = {
    Id: 7, FirstName: 'Ada', LastName: 'Lovelace', Sex: 'F', IsDeceased: 0,
    BirthDate: '10 DEC 1815', BirthPlace: 'London', DeathDate: null, DeathPlace: null,
} as never;
const partner = (Id: number) => ({ Id, FirstName: 'A', LastName: 'B' } as Person);

/** Type into the date box labelled `label` and press Escape without leaving it. */
function typeThenEscape(label: string | RegExp, text: string) {
    const box = screen.getByLabelText(label);
    box.focus();
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: 'Escape' });
}

function stubConfirm(answer: boolean) {
    const confirm = vi.fn().mockReturnValue(answer);
    vi.stubGlobal('confirm', confirm);
    return confirm;
}

afterEach(() => vi.unstubAllGlobals());

describe('Escape with a typed, unblurred date (#861)', () => {
    it('asks in the person hero editor', () => {
        const confirm = stubConfirm(false);
        const onCancel = vi.fn();
        render(<HeroIdentityEditor person={person} onSave={vi.fn(async () => {})} onDelete={vi.fn()} onCancel={onCancel} saving={false} canDelete />);
        typeThenEscape('death_date', '1852');
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('cancels when the discard is confirmed', () => {
        stubConfirm(true);
        const onCancel = vi.fn();
        render(<HeroIdentityEditor person={person} onSave={vi.fn(async () => {})} onDelete={vi.fn()} onCancel={onCancel} saving={false} canDelete />);
        typeThenEscape('death_date', '1852');
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('does not ask when nothing was typed', () => {
        const confirm = stubConfirm(false);
        const onCancel = vi.fn();
        render(<HeroIdentityEditor person={person} onSave={vi.fn(async () => {})} onDelete={vi.fn()} onCancel={onCancel} saving={false} canDelete />);
        fireEvent.keyDown(screen.getByLabelText('death_date'), { key: 'Escape' });
        expect(confirm).not.toHaveBeenCalled();
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('asks in the inline event editor', () => {
        const confirm = stubConfirm(false);
        const onCancel = vi.fn();
        render(<InlineEventEditor target={{ kind: 'person', personId: 1 }} defaultType="RESI" onCancel={onCancel} onSaved={vi.fn()} />);
        typeThenEscape('first_label', '1901');
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('asks in the inline marriage editor', () => {
        const confirm = stubConfirm(false);
        const onCancel = vi.fn();
        render(<InlineMarriageEditor familyId={1} treeId={1} marriageDate={null} marriagePlace={null} kindLabel="Marriage" canDelete={false} onCancel={onCancel} onSaved={vi.fn()} />);
        typeThenEscape(/started_date/, '1920');
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
    });
});
