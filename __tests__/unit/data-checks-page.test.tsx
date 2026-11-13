/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import '@testing-library/jest-dom';
import en from '@/messages/en.json';
import { runDataChecks } from '@/lib/data-checks/engine';
import { neighbourhood } from '@/lib/data-checks/preview';
import type { DataCheckInput } from '@/lib/data-checks/rules';
import type { DataChecksResult } from '@/lib/data/types';

const h = vi.hoisted(() => ({
    params: new URLSearchParams(),
    permission: 'owner' as string,
    list: vi.fn(),
    confirm: vi.fn(),
    neighbourhood: vi.fn(),
    redirect: () => false,
    updatePerson: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: h.push, replace: h.replace }),
    useSearchParams: () => h.params,
}));
vi.mock('next/link', () => ({
    default: ({ href, children, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/app/contexts/TreeContext', () => ({
    useTree: () => ({ activeTreeId: 1, activePermission: h.permission }),
}));
vi.mock('@/app/components/useErrorToast', () => ({
    useErrorToast: () => ({ redirectIfUnauthorized: h.redirect }),
}));
vi.mock('@/app/components/LanguageProvider', () => ({
    useLanguage: () => ({ language: 'en', timezone: 'UTC' }),
}));
vi.mock('@/lib/data', () => ({
    getDataClient: async () => ({
        dataChecks: { list: h.list, confirm: h.confirm, neighbourhood: h.neighbourhood },
        people: { update: h.updatePerson },
    }),
}));

import DataChecksView from '@/app/data-checks/DataChecksView';

const input: DataCheckInput = {
        people: [
            { Id: 1, Sex: 'F', BirthDate: '1813', DeathDate: '1814-01-27', IsDeceased: 1 },
            { Id: 2, Sex: 'M', BirthDate: '1810', DeathDate: '1871', IsDeceased: 1 },
            { Id: 3, Sex: 'F', BirthDate: '1843-03-03', DeathDate: null, IsDeceased: 1 },
            { Id: 8, Sex: 'F', BirthDate: '1802', DeathDate: null, IsDeceased: 1 },
            { Id: 9, Sex: 'M', BirthDate: '1860', DeathDate: null, IsDeceased: 1 },
        ],
        events: [],
        families: [
            { Id: 10, Partner1Id: 2, Partner2Id: 1, MarriageDate: 'EST 1842', childIds: [3] },
            { Id: 11, Partner1Id: null, Partner2Id: 8, MarriageDate: null, childIds: [9] },
        ],
};

const result: DataChecksResult = {
    problems: runDataChecks(input).map((p) => ({ ...p, confirmation: null })),
    people: [
        { Id: 1, FirstName: 'Mary Ellen', LastName: 'Byrne', Sex: 'F', BirthDate: '1813', DeathDate: '1814-01-27' },
        { Id: 2, FirstName: 'Patrick', LastName: 'Doyle', Sex: 'M', BirthDate: '1810', DeathDate: '1871' },
        { Id: 3, FirstName: 'Bridget', LastName: 'Doyle', Sex: 'F', BirthDate: '1843-03-03', DeathDate: null },
        { Id: 8, FirstName: 'Anne', LastName: 'Doyle', Sex: 'F', BirthDate: '1802', DeathDate: null },
        { Id: 9, FirstName: 'Michael', LastName: 'Doyle', Sex: 'M', BirthDate: '1860', DeathDate: null },
    ],
    families: [{ Id: 10, Partner1Id: 2, Partner2Id: 1 }, { Id: 11, Partner1Id: null, Partner2Id: 8 }],
};

function renderPage() {
    return render(
        <NextIntlClientProvider locale="en" messages={en}>
            <DataChecksView />
        </NextIntlClientProvider>,
    );
}

describe('Data checks page (#831)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.params = new URLSearchParams();
        h.permission = 'owner';
        h.list.mockResolvedValue(result);
        h.confirm.mockResolvedValue(result.problems[2]);
        h.neighbourhood.mockResolvedValue(neighbourhood(input, 1));
        h.updatePerson.mockResolvedValue({});
    });

    it('groups the list by kind, impossible first, and shows the first entry', async () => {
        renderPage();
        const nav = await screen.findByRole('navigation', { name: 'Entries' });
        const headings = within(nav).getAllByRole('heading').map((el) => el.textContent);
        expect(headings).toEqual(['Impossible2', 'Unlikely1']);
        expect(within(nav).getByRole('link', { name: /A child born after her death/ })).toHaveAttribute(
            'href', '/data-checks?entry=child_born_after_mother_death%3A1',
        );
        expect(screen.getByRole('heading', { level: 2, name: 'Mary Ellen Byrne died before her child was born' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: "Open Mary Ellen's page" })).toHaveAttribute('href', '/people/view?id=1');
    });

    it("marks only the date to fix: Mary Ellen's death, not Bridget's birth", async () => {
        renderPage();
        const detail = await screen.findByTestId('data-check-detail');
        const rows = within(detail).getAllByRole('listitem').filter((li) => li.closest('ol'));
        expect(rows.map((r) => r.textContent)).toEqual([
            'Jan 27, 1814Mary Ellen diedDate to checkEdit date',
            'Mar 3, 1843Bridget born',
        ]);
        // Impossible checks can only be fixed.
        expect(within(detail).queryByRole('button', { name: 'Confirm as correct' })).toBeNull();
    });

    it('confirms an unlikely check only with a reason', async () => {
        h.params = new URLSearchParams('entry=mother_too_old:8');
        renderPage();
        const detail = await screen.findByTestId('data-check-detail');
        expect(within(detail).getByText('Unusual: please confirm.')).toBeInTheDocument();
        fireEvent.click(within(detail).getByRole('button', { name: 'Confirm as correct' }));
        const confirm = within(detail).getByRole('button', { name: 'Confirm' });
        expect(confirm).toBeDisabled();
        fireEvent.change(within(detail).getByLabelText('Why is this right?'), { target: { value: 'Baptism register gives her age' } });
        fireEvent.click(confirm);
        await waitFor(() => expect(h.confirm).toHaveBeenCalledWith('mother_too_old:8', 'Baptism register gives her age', 1));
    });

    it("doesn't offer Confirm to a viewer", async () => {
        h.permission = 'view';
        h.params = new URLSearchParams('entry=mother_too_old:8');
        renderPage();
        const detail = await screen.findByTestId('data-check-detail');
        expect(within(detail).queryByRole('button', { name: 'Confirm as correct' })).toBeNull();
    });

    it('filters to a family from the hero flag, named by its partners', async () => {
        h.params = new URLSearchParams('family=10');
        renderPage();
        const nav = await screen.findByRole('navigation', { name: 'Entries' });
        expect(within(nav).queryByText('Anne Doyle')).toBeNull();
        expect(screen.getByText('Family: Patrick & Mary Ellen')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove the family filter' }));
        expect(h.replace).toHaveBeenCalledWith('/data-checks');
    });

    it('says when there is nothing to check', async () => {
        h.list.mockResolvedValue({ problems: [], people: [], families: [] });
        renderPage();
        expect(await screen.findByText('No dates to check')).toBeInTheDocument();
    });

    describe('fixing a date in place (#832)', () => {
        const editButton = async () => {
            const detail = await screen.findByTestId('data-check-detail');
            return within(detail).getByRole('button', { name: 'Edit date: Mary Ellen died' });
        };

        it("offers Edit date on the row to fix only, and not to a viewer", async () => {
            renderPage();
            const button = await editButton();
            expect(button).toHaveAttribute('title', 'Edit date: Mary Ellen died');
            const detail = screen.getByTestId('data-check-detail');
            expect(within(detail).getAllByRole('button', { name: /^Edit date/ })).toHaveLength(1);
        });

        it("hides Edit date from a viewer", async () => {
            h.permission = 'view';
            renderPage();
            const detail = await screen.findByTestId('data-check-detail');
            expect(within(detail).queryByRole('button', { name: /^Edit date/ })).toBeNull();
        });

        it("says as you type whether the date clears the problem: 1814 doesn't, 1874 does", async () => {
            renderPage();
            fireEvent.click(await editButton());
            const box = screen.getByLabelText('Mary Ellen died');
            expect(box).toHaveFocus();
            await waitFor(() => expect(h.neighbourhood).toHaveBeenCalledWith(1, 1));

            fireEvent.change(box, { target: { value: '1814' } });
            expect(await screen.findByText("This date doesn't clear the problem.")).toBeInTheDocument();
            fireEvent.change(box, { target: { value: '1874' } });
            const status = await screen.findByText('This date clears the problem.');
            // It sits under the date, before Save, so it stays above a wrapped Save/Cancel at 390 (#843).
            expect(status.compareDocumentPosition(screen.getByRole('button', { name: 'Save' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it('saves on Enter without leaving the box, re-runs the checks, and moves to the next entry', async () => {
            renderPage();
            fireEvent.click(await editButton());
            const box = screen.getByLabelText('Mary Ellen died');
            fireEvent.change(box, { target: { value: '1874' } });

            const fixed = runDataChecks({
                ...input, people: input.people.map((p) => (p.Id === 1 ? { ...p, DeathDate: '1874' } : p)),
            }).map((p) => ({ ...p, confirmation: null }));
            // Both of Mary Ellen's checks clear, so the next entry still there is Anne's.
            expect(fixed.map((p) => p.id)).toEqual(['mother_too_old:8']);
            h.list.mockResolvedValue({ ...result, problems: fixed });

            fireEvent.submit(box.closest('form')!);
            await waitFor(() => expect(h.updatePerson).toHaveBeenCalledWith(1, { DeathDate: '1874' }, 1));
            await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/data-checks?entry=mother_too_old%3A8', { scroll: false }));
            expect(h.list).toHaveBeenCalledTimes(2);
        });

        it("focuses the next entry's heading after a fix, even when the reload briefly shows another entry", async () => {
            // Fixing the second of three entries: while the route catches up, the
            // reloaded list shows its first entry (Mary Ellen's other check), not the next one (Anne's).
            h.params = new URLSearchParams('entry=partnership_after_death:1');
            const { rerender } = renderPage();
            const detail = await screen.findByTestId('data-check-detail');
            fireEvent.click(within(detail).getAllByRole('button', { name: /^Edit date: Mary Ellen/ })[0]);
            const box = screen.getByRole('textbox');
            fireEvent.change(box, { target: { value: '1874' } });
            h.list.mockResolvedValue({ ...result, problems: result.problems.filter((p) => p.id !== 'partnership_after_death:1') });

            fireEvent.submit(box.closest('form')!);
            await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/data-checks?entry=mother_too_old%3A8', { scroll: false }));
            // The reload renders first; the route changes after it.
            await screen.findByRole('heading', { level: 2, name: 'Mary Ellen Byrne died before her child was born' });
            h.params = new URLSearchParams('entry=mother_too_old:8');
            rerender(<NextIntlClientProvider locale="en" messages={en}><DataChecksView /></NextIntlClientProvider>);
            await waitFor(() => expect(within(screen.getByTestId('data-check-detail')).getByRole('heading', { level: 2 })).toHaveFocus());
            expect(document.activeElement).toHaveTextContent(/^Anne/);
        });

        it('stays on the entry when the problem is still there', async () => {
            renderPage();
            fireEvent.click(await editButton());
            const box = screen.getByLabelText('Mary Ellen died');
            fireEvent.change(box, { target: { value: '1814' } });
            fireEvent.submit(box.closest('form')!);
            await waitFor(() => expect(h.updatePerson).toHaveBeenCalledWith(1, { DeathDate: '1814' }, 1));
            await waitFor(() => expect(h.list).toHaveBeenCalledTimes(2));
            expect(h.replace).not.toHaveBeenCalled();
        });

        it('cancels on Escape and returns focus to the button', async () => {
            renderPage();
            fireEvent.click(await editButton());
            const box = screen.getByLabelText('Mary Ellen died');
            fireEvent.keyDown(box, { key: 'Escape' });
            await waitFor(() => expect(screen.queryByLabelText('Mary Ellen died')).toBeNull());
            expect(await editButton()).toHaveFocus();
            expect(h.updatePerson).not.toHaveBeenCalled();
        });
    });
});
