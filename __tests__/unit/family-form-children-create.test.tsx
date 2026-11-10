/**
 * @vitest-environment happy-dom
 *
 * #477 — the children UI is reachable while CREATING a family, not only after the
 * first save. The staging/flush behavior itself lives in use-family-form.test.ts;
 * this pins the surface, which is what the report was actually about.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import React from 'react';
import en from '@/messages/en.json';
import type { ChildRow } from '@/app/components/family-form/state';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/app/components/PersonPicker', () => ({ default: () => <div data-testid="person-picker" /> }));
vi.mock('@/app/components/LocationField', () => ({ default: () => <div /> }));
vi.mock('@/app/components/DateInput', () => ({ default: () => <input /> }));
vi.mock('@/app/components/AttachSourceSidebar', () => ({ default: () => null }));

const hookState: Record<string, unknown> = {};
vi.mock('@/app/components/family-form/useFamilyForm', () => ({
    useFamilyForm: () => hookState,
}));

import FamilyForm from '@/app/components/FamilyForm';

function baseState(over: Record<string, unknown>) {
    const noop = () => {};
    return {
        isNew: true, familyId: null, activeTreeId: 1,
        formRef: { current: null }, form: { MarriageDate: '', MarriagePlace: '', Type: 'Marriage', Notes: '' },
        handleChange: noop, setMarriagePlaceResolution: noop, marriagePlaceInitialChain: null,
        loading: false, saving: false, deleting: false, showDeleteConfirm: false, setShowDeleteConfirm: noop,
        error: null, partner1: null, setPartner1: noop, partner2: null, setPartner2: noop,
        children: [] as ChildRow[], showChildPicker: false, setShowChildPicker: noop,
        citations: [], partner1Families: [], partner2Families: [],
        attachTarget: null, setAttachTarget: noop, setPendingCitations: noop,
        handleSubmit: noop, handleDelete: noop, addChild: noop, updateChildType: noop, removeChild: noop,
        cite: () => null, reloadCitations: noop,
        ...over,
    };
}

function wrap(over: Record<string, unknown>) {
    Object.keys(hookState).forEach((k) => delete hookState[k]);
    Object.assign(hookState, baseState(over));
    return render(
        <NextIntlClientProvider locale="en" messages={en}>
            <FamilyForm mode="new" />
        </NextIntlClientProvider>,
    );
}

const child = (Id: number, partner1Relationship = 'Birth', partner2Relationship = partner1Relationship): ChildRow => ({
    person: { Id, FirstName: 'Kid', LastName: String(Id), BirthDate: null, DeathDate: null, Sex: null },
    partner1Relationship,
    partner2Relationship,
} as ChildRow);

describe('FamilyForm children section on create', () => {
    it('offers the add-child button while the family is new', () => {
        wrap({});
        expect(screen.getByText(en.editFamily.add_child)).toBeTruthy();
    });

    // The two partner slots are pickers too, so the child picker is one more
    // than the closed state renders.
    it('opens the existing person picker on create', () => {
        const closed = wrap({}).container.querySelectorAll('[data-testid="person-picker"]').length;
        cleanup();
        const open = wrap({ showChildPicker: true }).container.querySelectorAll('[data-testid="person-picker"]').length;
        expect(open).toBe(closed + 1);
    });

    // Previously a static string stood in place of the list, so a staged child
    // had nowhere to appear.
    it('lists staged children with their relationship-type select', () => {
        const { container } = wrap({ children: [child(5, 'Adoption')] });
        expect(container.textContent).toContain('Kid 5');
        expect((container.querySelector('[role="combobox"][aria-label="Relationship type"]') as HTMLElement).dataset.value).toBe('Adoption');
        expect(container.textContent).not.toContain(en.editFamily.children_empty_new);
    });

    // A blended family's child is one partner's birth child and the other's
    // stepchild, so with two partners each gets its own select (#982).
    it('asks for the relationship to each partner when both are set', () => {
        const { container } = wrap({
            partner1: { Id: 1, FirstName: 'Tom', LastName: 'Doe' },
            partner2: { Id: 2, FirstName: 'Ann', LastName: 'Roe' },
            children: [child(5, 'Birth', 'Step')],
        });
        const select = (name: string) => container.querySelector(`[role="combobox"][aria-label="Relationship to ${name}"]`) as HTMLElement;
        expect(select('Tom').dataset.value).toBe('Birth');
        expect(select('Ann').dataset.value).toBe('Step');
    });

    it('shows the new-family empty state only while nothing is staged', () => {
        const { container } = wrap({ children: [] });
        expect(container.textContent).toContain(en.editFamily.children_empty_new);
    });
});

describe('FamilyForm optional partnership read errors', () => {
    it('shows a partner-specific retry without presenting a failed lookup as empty', () => {
        const retry = vi.fn();
        const { container } = wrap({
            isNew: false,
            familyId: 77,
            partner1: { Id: 1, FirstName: 'Ada', LastName: 'Lovelace' },
            partner1Families: [],
            partner1FamiliesError: 'Could not load partnerships',
            retryPartner1Families: retry,
        });

        expect(screen.getByRole('alert').textContent).toContain('Could not load partnerships');
        expect(container.textContent).not.toContain(en.editFamily.no_other_partnerships);
        screen.getByRole('button', { name: en.common.retry }).click();
        expect(retry).toHaveBeenCalledOnce();
    });
});
