/** @vitest-environment happy-dom */

import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { DesktopCases } from '@/app/cases/DesktopCases';
import type { CaseWithRelations } from '@/lib/db/schema';

vi.mock('@/app/hooks/useActiveTreeName', () => ({ useActiveTreeName: () => 'Arbor family' }));
vi.mock('@/app/hooks/useTimestamp', () => ({ useTimestamp: () => ({ timestamp: (v: string) => v, activityTime: (v: string) => v.slice(0, 10) }) }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => <span /> }));

const base = { UserId: 1, Description: null, media: [], citations: [], comments: [] };
const cases: CaseWithRelations[] = [
    {
        ...base, Id: 1, Title: 'Who were Ada’s parents?', Status: 'in_progress', Tags: ['Moss'], CreatedAt: '2026-11-01T00:00:00Z', UpdatedAt: '2026-11-10T00:00:00Z',
        people: [{ Id: 7, FirstName: 'Ada', LastName: 'Moss', Sex: 'F' }, { Id: 8, FirstName: 'Bert', LastName: 'Moss', Sex: 'M' }],
        latestComment: { Id: 3, CaseId: 1, UserId: 1, Body: 'Try the 1881 census', CreatedAt: '2026-11-10T00:00:00Z', Kind: null },
        leads: { total: 4, settled: 1 },
    },
    {
        ...base, Id: 2, Title: 'Where was Bert baptised?', Status: 'closed', Outcome: 'answered', Tags: [], CreatedAt: '2026-10-01T00:00:00Z', UpdatedAt: '2026-11-11T00:00:00Z',
        people: [], leads: { total: 2, settled: 2 },
    },
    {
        ...base, Id: 3, Title: 'Did Cora emigrate?', Status: 'on_hold', Tags: [], CreatedAt: '2026-09-01T00:00:00Z', UpdatedAt: '2026-10-01T00:00:00Z',
        people: [], leads: { total: 0, settled: 0 },
    },
];

const renderList = () => render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <DesktopCases cases={cases} loading={false} loadError={null} onRetry={() => {}} canEdit onNewCase={() => {}}
            search="" onSearch={() => {}} tag="" onTag={() => {}} tags={['Moss']} treeId={1} />
    </NextIntlClientProvider>,
);

const titles = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('link')[0].textContent);

describe('the Research list on desktop (#59)', () => {
    it('lists every case as a row, closed ones included, newest activity first', () => {
        renderList();
        expect(screen.getByRole('heading', { level: 1, name: 'Research' })).toBeInTheDocument();
        expect(screen.getByText('3 cases in this tree')).toBeInTheDocument();
        expect(titles()).toEqual(['Where was Bert baptised?', 'Who were Ada’s parents?', 'Did Cora emigrate?']);
        expect(screen.queryByText('Closed recently')).not.toBeInTheDocument();

        const ada = screen.getByRole('link', { name: 'Who were Ada’s parents?' }).closest('tr')!;
        expect(ada).toHaveTextContent('“Try the 1881 census”');
        expect(ada).toHaveTextContent('Moss');
        expect(ada).toHaveTextContent('1 of 4 settled');
        expect(within(ada).getByRole('group', { name: 'Ada Moss, Bert Moss' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Where was Bert baptised?' }).closest('tr')).toHaveTextContent('ClosedAnswered');
    });

    it('filters by status with counts and sorts by a column', () => {
        renderList();
        fireEvent.click(screen.getByRole('button', { name: /On hold/ }));
        expect(titles()).toEqual(['Did Cora emigrate?']);
        expect(screen.getByText('1 of 3')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^All/ }));
        fireEvent.click(screen.getByRole('columnheader', { name: /Leads/ }));
        expect(titles()).toEqual(['Where was Bert baptised?', 'Who were Ada’s parents?', 'Did Cora emigrate?']);
        fireEvent.click(screen.getByRole('columnheader', { name: /Question/ }));
        expect(titles()).toEqual(['Did Cora emigrate?', 'Where was Bert baptised?', 'Who were Ada’s parents?']);
    });
});
