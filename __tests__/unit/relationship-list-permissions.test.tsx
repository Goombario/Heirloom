/** @vitest-environment happy-dom */
/**
 * #848: the person page's relationship ✕ (a parent link, a partnership, a
 * child) is on the delete rung, as the services that back it are. A
 * contributor keeps "+ Add".
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

const person = (Id: number, FirstName: string) => ({ Id, FirstName, LastName: 'Fiction', BirthDate: null, DeathDate: null });
const family = (Id: number) => ({ Id, MarriageDate: null, MarriagePlace: null });
const subject = {
    ...person(1, 'Ada'),
    parents: [{ father: person(2, 'Tom'), mother: person(3, 'Ann'), family: family(10), relationshipType: 'Birth', siblings: [] }],
    spouses: [{ person: person(4, 'Ben'), family: family(11), children: [person(5, 'Cal')] }],
    siblings: [],
} as unknown as PersonWithRelations;

function renderList(props: { canEdit?: boolean; canDelete?: boolean }) {
    render(
        <NextIntlClientProvider locale="en" messages={en}>
            <RelationshipList person={subject} treeId={1} title="Relationships" onChanged={() => {}} {...props} />
        </NextIntlClientProvider>,
    );
}

const removes = () => [
    ...screen.queryAllByRole('button', { name: en.personDetail.remove_parent_link }),
    ...screen.queryAllByRole('button', { name: en.personDetail.remove_partner_q }),
    ...screen.queryAllByRole('button', { name: en.personDetail.remove_child_q }),
];

describe('RelationshipList permissions (#848)', () => {
    it('gives a contributor "+ Add" and no remove', () => {
        renderList({ canEdit: true, canDelete: false });
        expect(screen.getByRole('button', { name: new RegExp(en.common.add) })).toBeInTheDocument();
        expect(removes()).toHaveLength(0);
    });

    it('gives owner and edit rungs a remove on each parent, the partner and the child', () => {
        renderList({ canEdit: true, canDelete: true });
        expect(removes()).toHaveLength(4);
    });
});
