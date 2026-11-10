/** @vitest-environment happy-dom */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { runDataChecks } from '@/lib/data-checks/engine';
import { RULE_KIND } from '@/lib/data-checks/rules';
import type { DataChecksSummary } from '@/lib/data/types';

vi.mock('next/link', () => ({
    default: ({ href, children, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => null }));

import { DatesToCheckCard } from '@/app/components/data-checks/DatesToCheckCard';

// Anne Doyle (8), a mother over 55, is unlikely; she sorts first by ID but must
// come after the impossible checks: Mary Ellen's (1) and Thomas Kelly's (7).
const problems = runDataChecks({
    people: [
        { Id: 1, Sex: 'F', BirthDate: '1813', DeathDate: '1814-01-27', IsDeceased: 1 },
        { Id: 2, Sex: 'M', BirthDate: '1810', DeathDate: '1871', IsDeceased: 1 },
        { Id: 3, Sex: 'F', BirthDate: '1843-03-03', DeathDate: null, IsDeceased: 1 },
        { Id: 7, Sex: 'M', BirthDate: '1851-03-14', DeathDate: 'ABT 1841', IsDeceased: 1 },
        { Id: 8, Sex: 'F', BirthDate: '1802', DeathDate: null, IsDeceased: 1 },
        { Id: 9, Sex: 'M', BirthDate: '1860', DeathDate: null, IsDeceased: 1 },
    ],
    events: [],
    families: [
        { Id: 10, Partner1Id: 2, Partner2Id: 1, MarriageDate: 'EST 1842', childIds: [3] },
        { Id: 11, Partner1Id: null, Partner2Id: 8, MarriageDate: null, childIds: [9] },
    ],
}).map((p) => ({ ...p, confirmation: null }));
const people = [
    { Id: 1, FirstName: 'Mary Ellen', LastName: 'Byrne', Sex: 'F', BirthDate: '1813', DeathDate: '1814-01-27' },
    { Id: 7, FirstName: 'Thomas', LastName: 'Kelly', Sex: 'M', BirthDate: '1851-03-14', DeathDate: 'ABT 1841' },
    { Id: 8, FirstName: 'Anne', LastName: 'Doyle', Sex: 'F', BirthDate: '1802', DeathDate: null },
];
// What the summary service sends: the count still to check and the first three.
const summary: DataChecksSummary = { openCount: problems.length, top: { problems: problems.slice(0, 3), people, families: [] } };

const renderCard = (s: DataChecksSummary | null) => render(
    <NextIntlClientProvider locale="en" messages={en}><DatesToCheckCard summary={s} treeId={1} /></NextIntlClientProvider>,
);

describe('Home: Dates to check card (#834)', () => {
    it('shows the count and the first three entries, impossible first, with Review all', () => {
        expect(problems.length).toBeGreaterThan(3);
        renderCard(summary);
        const card = screen.getByRole('region', { name: /Dates to check/ });
        const links = within(card).getAllByRole('link');
        const entries = links.slice(0, -1);
        expect(entries).toHaveLength(3);
        const ids = entries.map((a) => decodeURIComponent(a.getAttribute('href')!.split('entry=')[1]));
        expect(ids.every((id) => RULE_KIND[id.split(':')[0] as keyof typeof RULE_KIND] === 'impossible')).toBe(true);
        expect(within(card).queryByText('Anne Doyle')).toBeNull();
        expect(within(card).getByRole('heading')).toHaveTextContent(`Dates to check (${problems.length})`);
        expect(links[links.length - 1]).toHaveTextContent(`Review all ${problems.length}`);
        expect(links[links.length - 1]).toHaveAttribute('href', '/data-checks');
    });

    it('hides when there is nothing to check and while loading', () => {
        for (const s of [{ openCount: 0, top: { problems: [], people: [], families: [] } }, null]) {
            const { container, unmount } = renderCard(s);
            expect(container).toBeEmptyDOMElement();
            unmount();
        }
    });
});
