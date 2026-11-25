/** @vitest-environment happy-dom */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const h = vi.hoisted(() => ({
    familiesSearch: vi.fn(),
    familiesGet: vi.fn(),
    peopleGet: vi.fn(),
    createMany: vi.fn(),
}));

vi.mock('@/lib/data', () => ({
    getDataClient: () => Promise.resolve({
        families: { search: h.familiesSearch, get: h.familiesGet },
        people: { get: h.peopleGet, search: vi.fn().mockResolvedValue([]) },
        citations: { createMany: h.createMany },
    }),
}));
vi.mock('@/app/components/useErrorToast', () => ({
    useErrorToast: () => ({ redirectIfUnauthorized: () => false }),
}));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('next-intl', () => ({
    useTranslations: () => (key: string, values?: Record<string, unknown>) =>
        values && 'count' in values ? `${key}:${values.count}` : key === 'cite_on_marriage_to' ? `${key}:${values?.name}` : key,
}));

import { CiteOnPanel } from '@/app/library/source-modal/CiteOnPanel';
import type { CitedByRow } from '@/lib/db/queries/citations';
import type { Source } from '@/lib/data/types';

const census = { Id: 30, Title: '1901 Census of Asteria, household 12', Type: 'Census' } as Source;
const people: Record<number, object> = {
    1: { Id: 1, FirstName: 'Tom', LastName: 'Bracken', BirthDate: '1859', events: [{ Id: 50, Type: 'RESI', Date: '1901', Place: 'Brackwater' }] },
    2: { Id: 2, FirstName: 'Ann', LastName: 'Bracken', BirthDate: '1885', events: [] },
    3: { Id: 3, FirstName: 'Ben', LastName: 'Bracken', BirthDate: '1888', events: [] },
    4: { Id: 4, FirstName: 'Cal', LastName: 'Bracken', BirthDate: '1890', events: [] },
};

function renderPanel(citedBy: Partial<CitedByRow>[] = []) {
    const onCited = vi.fn();
    render(
        <CiteOnPanel source={census} treeId={7} citedBy={citedBy as CitedByRow[]} titleId="t" isMobile={false} onCancel={() => {}} onCited={onCited} />,
    );
    return { onCited };
}

async function addHousehold(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByRole('textbox', { name: 'search_families_plain' }), 'Bracken');
    await user.click(await screen.findByRole('button', { name: /Tom Bracken/ }));
    await screen.findByRole('heading', { name: /Cal Bracken/ });
}

describe('Cite on… (#799, EV-7)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.familiesSearch.mockResolvedValue([{ Id: 9, husbandName: 'Tom Bracken', wifeName: null, childCount: 3, MarriageDate: null }]);
        h.familiesGet.mockResolvedValue({ husband: { Id: 1 }, wife: null, children: [{ Id: 2 }, { Id: 3 }, { Id: 4 }] });
        h.peopleGet.mockImplementation((id: number) => Promise.resolve(people[id]));
        h.createMany.mockResolvedValue([]);
    });

    it('puts focus in the household search for a census (#861)', () => {
        renderPanel();
        expect(screen.getByRole('textbox', { name: 'search_families_plain' })).toHaveFocus();
    });

    it('puts focus in the person picker for any other source (#861)', () => {
        render(
            <CiteOnPanel source={{ ...census, Type: 'Document' }} treeId={7} citedBy={[]} titleId="t" isMobile={false} onCancel={() => {}} onCited={vi.fn()} />,
        );
        expect(screen.getByPlaceholderText('cite_on_add_person')).toHaveFocus();
    });

    it("cites a father's and three children's births from one household pick, in one write", async () => {
        const user = userEvent.setup();
        const { onCited } = renderPanel();
        await addHousehold(user);

        // The census year's residence is ticked for you; the births take one switch.
        expect(screen.getByRole('checkbox', { name: /RESI/ })).toBeChecked();
        await user.click(screen.getByRole('button', { name: 'BIRT' }));
        await user.type(screen.getByRole('textbox', { name: 'cite_on_shared_page' }), 'Folio 3');
        await user.click(screen.getByRole('radio', { name: 'certainty_3' }));
        // One record link for the household (#41).
        await user.type(screen.getByRole('textbox', { name: 'field_record_link' }), ' https://example.test/census/12 ');
        await user.click(screen.getByRole('button', { name: 'cite_on_submit:5' }));

        await waitFor(() => expect(h.createMany).toHaveBeenCalledOnce());
        const [input, treeId] = h.createMany.mock.calls[0];
        expect(treeId).toBe(7);
        expect(input).toMatchObject({ SourceId: 30, Page: 'Folio 3', Quay: '3', Url: 'https://example.test/census/12' });
        expect(input.facts.map((f: { FactTable: string; FactId: number }) => `${f.FactTable}:${f.FactId}`)).toEqual([
            'PersonBirth:1', 'Events:50', 'PersonBirth:2', 'PersonBirth:3', 'PersonBirth:4',
        ]);
        expect(onCited).toHaveBeenCalledWith(5);
    });

    it('keeps a fact that already cites the source unticked and out of the write', async () => {
        const user = userEvent.setup();
        renderPanel([{ factTable: 'PersonBirth', factId: 2 }]);
        await addHousehold(user);

        const ann = screen.getByRole('heading', { name: /Ann Bracken/ }).closest('li')!;
        const annBirth = within(ann).getByRole('checkbox', { name: /BIRT/ });
        expect(annBirth).toBeDisabled();
        expect(within(ann).getByText('cite_on_already')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'BIRT' }));
        await user.type(within(screen.getByRole('heading', { name: /Ben Bracken/ }).closest('li')!).getByRole('textbox'), 'line 9');
        await user.click(screen.getByRole('button', { name: 'cite_on_submit:4' }));
        await waitFor(() => expect(h.createMany).toHaveBeenCalledOnce());
        const facts = h.createMany.mock.calls[0][0].facts as { FactTable: string; FactId: number; Page: string | null }[];
        expect(facts.some(f => f.FactId === 2)).toBe(false);
        expect(facts.find(f => f.FactId === 3)?.Page).toBe('line 9');
    });

    it('picking a household already listed adds no one and leaves nothing loading', async () => {
        const user = userEvent.setup();
        renderPanel();
        await addHousehold(user);
        await user.click(screen.getByRole('button', { name: 'cite_on_add_family_members' }));
        await user.type(screen.getByRole('textbox', { name: 'search_families_plain' }), 'Bracken');
        await user.click(await screen.findByRole('button', { name: /Tom Bracken/ }));
        await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
        // The family block and its four members, each once.
        expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(5);
        expect(h.peopleGet).toHaveBeenCalledTimes(4);
    });

    it('labels the shared fields and the certainty group', async () => {
        renderPanel();
        expect(screen.getByLabelText('cite_on_shared_page')).toBeInTheDocument();
        expect(screen.getByRole('radiogroup', { name: 'field_certainty' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'cite_on_submit:0' })).toBeDisabled();
    });

    // #908: a row's own page wins; an empty row shows, and gets, the default page.
    it('shows the default page as each empty row\'s placeholder', async () => {
        const user = userEvent.setup();
        renderPanel();
        await addHousehold(user);
        const tom = screen.getByRole('heading', { name: /Tom Bracken/ }).closest('li')!;
        const row = within(tom).getByRole('textbox');
        expect(row).toHaveAttribute('placeholder', 'ph_row_page');
        await user.type(screen.getByRole('textbox', { name: 'cite_on_shared_page' }), 'Folio 3');
        expect(row).toHaveAttribute('placeholder', 'Folio 3');
    });

    // #31: the family is cited too, in its own block above its members.
    describe('a family block', () => {
        const family = { Id: 9, Partner1Id: 1, Partner2Id: 5, MarriageDate: '1884', MarriagePlace: 'Brackwater', Type: 'Marriage' };
        const tom = { ...people[1], spouses: [{ person: { Id: 5, FirstName: 'Eda', LastName: 'Bracken' }, family, children: [] }] };
        beforeEach(() => {
            h.familiesGet.mockResolvedValue({
                family,
                husband: { Id: 1, FirstName: 'Tom', LastName: 'Bracken' },
                wife: { Id: 5, FirstName: 'Eda', LastName: 'Bracken' },
                children: [{ Id: 4 }],
                events: [{ Id: 70, Type: 'DIV', Date: '1901', Place: null }],
            });
            h.peopleGet.mockImplementation((id: number) => Promise.resolve(id === 1 ? tom : id === 5 ? { Id: 5, FirstName: 'Eda', LastName: 'Bracken', events: [], spouses: [{ person: { Id: 1, FirstName: 'Tom', LastName: 'Bracken' }, family, children: [] }] } : people[id]));
        });

        it('comes first, with the marriage and the family events, ticked by year', async () => {
            const user = userEvent.setup();
            renderPanel();
            await addHousehold(user);
            const headings = screen.getAllByRole('heading', { level: 3 });
            expect(headings[0]).toHaveTextContent('Tom Bracken & Eda Bracken');
            const block = headings[0].closest('li')!;
            expect(within(block).getByText('cite_on_family_label')).toBeInTheDocument();
            expect(within(block).getByRole('checkbox', { name: /marriage_kind/i })).not.toBeChecked();
            // The 1901 census ticks the 1901 divorce.
            expect(within(block).getByRole('checkbox', { name: /DIV/ })).toBeChecked();
            // The members' own blocks don't repeat the marriage.
            expect(screen.queryByRole('checkbox', { name: /cite_on_marriage_to/ })).not.toBeInTheDocument();

            await user.click(within(block).getByRole('checkbox', { name: /marriage_kind/i }));
            await user.click(screen.getByRole('button', { name: /^cite_on_submit/ }));
            await waitFor(() => expect(h.createMany).toHaveBeenCalledOnce());
            const keys = h.createMany.mock.calls[0][0].facts.map((f: { FactTable: string; FactId: number }) => `${f.FactTable}:${f.FactId}`);
            expect(keys).toEqual(expect.arrayContaining(['Families:9', 'Events:70', 'Events:50']));
            expect(keys.filter((k: string) => k === 'Families:9')).toHaveLength(1);
        });

        it('counts an imported marriage citation as already cited', async () => {
            const user = userEvent.setup();
            renderPanel([{ factTable: 'FamilyMarriage', factId: 9 }]);
            await addHousehold(user);
            const block = screen.getAllByRole('heading', { level: 3 })[0].closest('li')!;
            expect(within(block).getByRole('checkbox', { name: /marriage_kind/i })).toBeDisabled();
            expect(within(block).getByText('cite_on_already')).toBeInTheDocument();
        });

        it('takes the family off with its own remove, and its members keep their marriage row', async () => {
            const user = userEvent.setup();
            renderPanel();
            await addHousehold(user);
            await user.click(screen.getByRole('button', { name: /cite_on_remove_family/ }));
            expect(screen.queryByText('cite_on_family_label')).not.toBeInTheDocument();
            expect(screen.getByRole('checkbox', { name: 'cite_on_marriage_to:Eda Bracken · 1884 · Brackwater' })).toBeInTheDocument();
            // Shown once, in Tom's block, though Eda's marriage is the same fact.
            expect(screen.getAllByRole('checkbox', { name: /cite_on_marriage_to/ })).toHaveLength(1);
        });
    });
});
