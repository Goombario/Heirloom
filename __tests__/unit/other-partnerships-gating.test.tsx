/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('next-intl', () => ({
    useTranslations: () => (key: string, args?: Record<string, unknown>) =>
        args ? `${key}(${Object.values(args).join(',')})` : key,
}));
vi.mock('@/app/families/view/familyCache', () => ({ prefetchFamily: () => {} }));
vi.mock('@/app/people/view/personCache', () => ({ prefetchPerson: () => {} }));

import { otherPartnershipsVisibility } from '@/app/families/view/derive';
import { OtherPartnerships } from '@/app/families/view/sections';
import type { PartnerFamilies } from '@/app/families/view/useFamilyDetail';

const CURRENT = 1;
const person = (id: number, name: string) => ({ Id: id, FirstName: name, LastName: 'Test' });
// Arthur: this family + one other. Ethel: this family only.
const arthur = {
    person: person(9, 'Arthur'),
    spouses: [
        { person: person(10, 'Ethel'), family: { Id: CURRENT, MarriageDate: '1900' } },
        { person: person(11, 'Rose'), family: { Id: 2, MarriageDate: '1925' } },
    ],
} as unknown as PartnerFamilies;
const ethel = {
    person: person(10, 'Ethel'),
    spouses: [{ person: person(9, 'Arthur'), family: { Id: CURRENT, MarriageDate: '1900' } }],
} as unknown as PartnerFamilies;
const ethelRemarried = {
    ...ethel,
    spouses: [...ethel.spouses, { person: person(12, 'Sam'), family: { Id: 3, MarriageDate: '1930' } }],
} as unknown as PartnerFamilies;

describe('otherPartnershipsVisibility', () => {
    it('shows only the partner who has another partnership, and still shows the card', () => {
        expect(otherPartnershipsVisibility(arthur, ethel, CURRENT)).toEqual({ p1: true, p2: false, card: true });
    });
    it('shows both halves when both have others', () => {
        expect(otherPartnershipsVisibility(arthur, ethelRemarried, CURRENT)).toEqual({ p1: true, p2: true, card: true });
    });
    it('hides the card entirely when neither has another partnership', () => {
        expect(otherPartnershipsVisibility(ethel, ethel, CURRENT)).toEqual({ p1: false, p2: false, card: false });
    });
    it('treats a missing partner as having none', () => {
        expect(otherPartnershipsVisibility(null, null, CURRENT)).toEqual({ p1: false, p2: false, card: false });
    });
});

describe('OtherPartnerships rendering under that gate', () => {
    it('renders no empty half for the partner the gate excluded', () => {
        const vis = otherPartnershipsVisibility(arthur, ethel, CURRENT);
        const { container } = render(
            <div>
                {vis.p1 && <OtherPartnerships pf={arthur} currentFamilyId={CURRENT} treeId={1} />}
                {vis.p2 && <OtherPartnerships pf={ethel} currentFamilyId={CURRENT} treeId={1} />}
            </div>
        );
        expect(container.textContent).toContain('for_partner(Arthur Test)');
        expect(container.textContent).not.toContain('for_partner(Ethel Test)');
        expect(container.textContent).not.toContain('no_other_partnerships');
    });
});

describe('OtherPartnerships sort — qualified and undated marriage dates', () => {
    it('orders a qualified marriage date by its real year and sinks an undated one last', () => {
        // Rose: ABT 1915 (should sort by 1915, not fail to parse). Nora: undated
        // (should sink to the end, not to year 0 ahead of everyone).
        const multi = {
            person: person(9, 'Arthur'),
            spouses: [
                { person: person(11, 'Rose'), family: { Id: 2, MarriageDate: 'ABT 1915' } },
                { person: person(13, 'Nora'), family: { Id: 4, MarriageDate: null } },
                { person: person(10, 'Ethel'), family: { Id: CURRENT, MarriageDate: '1900' } },
            ],
        } as unknown as PartnerFamilies;
        const { container } = render(<OtherPartnerships pf={multi} currentFamilyId={CURRENT} treeId={1} />);
        const text = container.textContent ?? '';
        const ethelIdx = text.indexOf('Ethel');
        const roseIdx = text.indexOf('Rose');
        const noraIdx = text.indexOf('Nora');
        expect(ethelIdx).toBeGreaterThanOrEqual(0);
        expect(roseIdx).toBeGreaterThan(ethelIdx);
        expect(noraIdx).toBeGreaterThan(roseIdx);
    });
});
