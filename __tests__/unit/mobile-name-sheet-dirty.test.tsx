/** @vitest-environment happy-dom */
/**
 * The phone Add name sheet starts with "Show as first name" switched on for a
 * first nickname. That automatic start is not a change, so closing an untouched
 * sheet must not ask "Discard your changes?".
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => {
    const t = Object.assign((key: string) => key, { has: () => false });
    return { useTranslations: () => t };
});
vi.mock('@/lib/data', () => ({ getDataClient: vi.fn() }));
vi.mock('@/app/components/DateInput', () => ({ default: () => null }));
vi.mock('@/app/components/ui/Sheet', () => ({
    Sheet: ({ dirty, children }: { dirty?: boolean; children: React.ReactNode }) => (
        <div data-testid="sheet" data-dirty={String(!!dirty)}>{children}</div>
    ),
    ConfirmSheet: () => null,
}));

import { NameSheet } from '@/app/people/view/mobile/ProfileSheets';
import type { PersonWithRelations } from '@/lib/db/schema';
import type { NameVariant } from '@/app/components/person-form/NamesPanel';

const person = { Id: 1, FirstName: 'Mary Ellen', LastName: 'Smith' } as PersonWithRelations;

function renderSheet(variants: NameVariant[] = []) {
    return render(
        <NameSheet variant={null} variants={variants} open onClose={() => {}} person={person} treeId={1}
            canDelete facts={[]} sourceNumbers={new Map()} run={vi.fn()} citeSheets={() => null} />,
    );
}

const dirty = () => screen.getByTestId('sheet').getAttribute('data-dirty');

describe('phone Add name sheet', () => {
    it('is clean when opened, even with the first-name switch on by default', () => {
        renderSheet();
        expect(screen.getByRole('switch')).toBeChecked();
        expect(dirty()).toBe('false');
    });

    it('is dirty once a name is typed', () => {
        renderSheet();
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Molly' } });
        expect(dirty()).toBe('true');
    });

    it('is dirty when the switch is turned off', () => {
        renderSheet();
        fireEvent.click(screen.getByRole('switch'));
        expect(dirty()).toBe('true');
    });
});
