/** @vitest-environment happy-dom */
/**
 * #1232: a parent's label follows the parent's own sex, not the family slot, so a
 * parent of unknown sex reads "Parent" rather than "Father" or "Mother".
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import type { PersonWithRelations } from '@/lib/db/schema';

vi.mock('@/lib/data', () => ({ getDataClient: vi.fn() }));
vi.mock('@/app/people/view/RelationshipAddPanel', () => ({ RelationshipAddPanel: () => null }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => null }));

import { RelationshipList } from '@/app/components/person-form/RelationshipList';

const person = (Id: number, FirstName: string, Sex: string | null) => ({ Id, FirstName, LastName: 'Fiction', Sex, BirthDate: null, DeathDate: null });

function renderParents(father: ReturnType<typeof person>, mother: ReturnType<typeof person>, links: [string, string] = ['Birth', 'Birth']) {
    const subject = {
        ...person(1, 'Ada', 'F'),
        parents: [{
            father, mother, family: { Id: 10, MarriageDate: null, MarriagePlace: null },
            relationshipType: links[0], partner1Relationship: links[0], partner2Relationship: links[1], siblings: [],
        }],
        spouses: [],
        siblings: [],
    } as unknown as PersonWithRelations;
    render(
        <NextIntlClientProvider locale="en" messages={en}>
            <RelationshipList person={subject} treeId={1} title="Relationships" onChanged={() => {}} />
        </NextIntlClientProvider>,
    );
}

describe('RelationshipList parent labels (#1232)', () => {
    it('labels parents of unknown sex "Parent"', () => {
        renderParents(person(2, 'Lee', 'U'), person(3, 'Sam', null));
        expect(screen.getAllByText(en.personDetail.parent)).toHaveLength(2);
        expect(screen.queryByText(en.personDetail.father)).not.toBeInTheDocument();
        expect(screen.queryByText(en.personDetail.mother)).not.toBeInTheDocument();
    });

    it('follows the parent, not the slot', () => {
        renderParents(person(2, 'Ann', 'F'), person(3, 'Tom', 'M'), ['Step', 'Birth']);
        expect(screen.getByText(en.personDetail.mother_step)).toBeInTheDocument();
        expect(screen.getByText(en.personDetail.father)).toBeInTheDocument();
    });
});
