/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import IdentitySection from '@/app/components/person-form/IdentitySection';
import VitalsSection from '@/app/components/person-form/VitalsSection';
import type { UsePersonForm } from '@/app/components/person-form/usePersonForm';

// Both composites forward the caller's id to their text box, as the real ones do.
vi.mock('@/app/components/DateInput', () => ({ default: ({ id }: { id?: string }) => <input id={id} /> }));
vi.mock('@/app/components/LocationField', () => ({ default: ({ id }: { id?: string }) => <input id={id} /> }));

const fm = {
    form: { FirstName: '', LastName: '', Sex: '', IsDeceased: '', BirthDate: '', BirthPlace: '', DeathDate: '', DeathPlace: '', DeathCause: '' },
    setField: vi.fn(), cite: () => null, fieldErrors: {}, firstNameRef: createRef<HTMLInputElement>(),
    variants: [], newVariantType: 'Nickname', newVariantName: '', setNewVariantType: vi.fn(), setNewVariantName: vi.fn(),
    addNameVariant: vi.fn(), removeNameVariant: vi.fn(), updateNameVariant: vi.fn(), setPrimaryVariant: vi.fn(), hasPrimaryVariant: false,
    setBirthPlaceResolution: vi.fn(), placeIds: { birth: null, death: null, marriage: null }, setPlaceId: vi.fn(), setDeathPlaceResolution: vi.fn(), birthPlaceInitialChain: null, deathPlaceInitialChain: null,
} as unknown as UsePersonForm;

// #855: every person form field is named by its visible label, and the date and
// place fields say which fact they belong to.
describe('person form field labels', () => {
    it('names each identity and vitals field', () => {
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <IdentitySection fm={fm} />
                <VitalsSection fm={fm} treeId={1} />
            </NextIntlClientProvider>,
        );
        for (const name of ['first_name', 'last_name', 'birth_date', 'birth_place', 'death_date', 'death_place', 'death_cause'] as const) {
            expect(screen.getByLabelText(en.editPerson[name], { exact: false }).tagName).toBe('INPUT');
        }
        // The visible label stays the short "Date" under each fact heading.
        expect(screen.getAllByText(en.editPerson.date, { selector: '[aria-hidden="true"]' })).toHaveLength(2);
    });
});
