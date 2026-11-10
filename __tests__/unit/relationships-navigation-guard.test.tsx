/** @vitest-environment happy-dom */

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import RelationshipsSection from '@/app/components/person-form/RelationshipsSection';

const h = vi.hoisted(() => ({
    navigationHandlers: [] as Array<(event: { preventDefault: () => void }) => void>,
}));

vi.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));
vi.mock('next/link', () => ({
    default: ({ href, onNavigate, children }: { href: string; onNavigate?: (event: { preventDefault: () => void }) => void; children: ReactNode }) => {
        if (onNavigate) h.navigationHandlers.push(onNavigate);
        return <a href={href}>{children}</a>;
    },
}));
vi.mock('@/lib/data', () => ({ getDataClient: vi.fn() }));
vi.mock('@/app/components/PersonPicker', () => ({ default: () => <div /> }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => <div /> }));
vi.mock('@/app/components/ui', () => ({
    Button: ({ children, ...props }: { children: ReactNode }) => <button {...props}>{children}</button>,
    Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    fieldClass: () => 'field',
    Lifespan: () => null,
}));

const person = (id: number, firstName: string) => ({
    Id: id,
    FirstName: firstName,
    LastName: 'Fiction',
    Sex: null,
    PrimaryMediaId: null,
    FocalX: null,
    FocalY: null,
    FocalRadius: null,
});

describe('RelationshipsSection navigation guard', () => {
    beforeEach(() => {
        h.navigationHandlers.length = 0;
    });

    it('threads the owning form guard through parent, family, and child links', () => {
        const onNavigate = vi.fn();
        const parent = person(2, 'Parent');
        const partner = person(3, 'Partner');
        const child = person(4, 'Child');

        render(
            <RelationshipsSection
                relations={{
                    parents: [{ family: { Id: 10 } as never, father: parent, mother: null }],
                    spouses: [{ family: { Id: 20, MarriageDate: null } as never, person: partner, children: [child] }],
                } as never}
                familiesAsSpouse={[]}
                familiesAsChild={[]}
                treeId={1}
                personId={1}
                personLastName="Fiction"
                onChanged={vi.fn()}
                onNavigate={onNavigate}
            />,
        );

        // React may render twice in the test environment; each committed set
        // still wires all three replacing links to the same owning-form guard.
        expect(h.navigationHandlers.length).toBeGreaterThanOrEqual(3);
        h.navigationHandlers.slice(-3).forEach((handler) => handler({ preventDefault: vi.fn() }));
        expect(onNavigate).toHaveBeenCalledTimes(3);
    });
});
