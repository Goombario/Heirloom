/* eslint-disable @next/next/no-img-element */
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { PersonResult } from '@/lib/db/schema';

const treeState = vi.hoisted(() => ({ activeTreeId: 7 }));

const translations: Record<string, string> = {
    born_year: 'b. {year}',
    placeholder: 'Search people and families...',
    start_typing: 'Start typing to search',
    searching: 'Searching…',
    no_results: 'No results found',
    search_failed: 'Search failed',
    keyboard_hint: 'to navigate',
    keyboard_select: 'to select',
    group_people: 'People',
    group_families: 'Families',
    child_of: 'child of {names}',
    partner_of: 'partner of {names}',
};
vi.mock('next-intl', () => ({
    useTranslations: () => {
    const t = (key: string, values?: Record<string, unknown>) =>
        Object.entries(values ?? {}).reduce((out, [k, v]) => out.replace(`{${k}}`, String(v)), translations[key] ?? key);
    // Minimal t.rich: substitute {date} and wrap <d>…</d> with the tag renderer.
    t.rich = (key: string, values: { date: string; d: (chunks: string) => unknown }) => {
        const [before, rest = ''] = (translations[key] ?? key).replace('{date}', values.date).split('<d>');
        const [inner, after = ''] = rest.split('</d>');
        return [before, values.d(inner), after];
    };
    return t;
},
}));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/app/contexts/TreeContext', () => ({
    useTree: () => ({ activeTreeId: treeState.activeTreeId }),
}));

// Detail-cache prewarming fires on hover/focus; not under test here.
vi.mock('@/app/people/view/personCache', () => ({ prefetchPerson: vi.fn() }));
vi.mock('@/app/families/view/familyCache', () => ({ prefetchFamily: vi.fn() }));

// ProfileImage relies on image load/decode events happy-dom does not drive.
// Exposing mediaId lets the tests assert which thumbnail a row asked for.
vi.mock('@/app/components/ProfileImage', () => ({
    default: ({ mediaId, alt }: { mediaId: number; alt: string }) => (
        <img alt={alt} data-testid="profile-image" data-media-id={String(mediaId)} />
    ),
}));

// Same reason as PersonPicker's suite: resolve getDataClient synchronously to the
// real HTTP client so the debounced search still hits the mocked global fetch with
// the real URLs, but is not gated on a dynamic import that fake timers cannot drive.
vi.mock('@/lib/data', async () => {
    const { HttpDataClient } = await import('@/lib/data/http');
    const client = new HttpDataClient();
    return { getDataClient: () => Promise.resolve(client) };
});

import GlobalSearch from '@/app/components/GlobalSearch';

// ---- Fixtures ---------------------------------------------------------------

function makePerson(overrides: Partial<PersonResult> = {}): PersonResult {
    return {
        Id: 1,
        FirstName: 'Jane',
        LastName: 'Doe',
        Sex: 'F',
        BirthDate: '1913-01-01',
        DeathDate: null,
        ...overrides,
    };
}

type FamilyRow = {
    Id: number;
    husbandName: string | null;
    wifeName: string | null;
    MarriageDate: string | null;
    partner1Sex?: string | null;
    partner2Sex?: string | null;
    husbandMediaId?: number | null;
    wifeMediaId?: number | null;
    husbandFocalX?: number | null;
    husbandFocalY?: number | null;
    husbandFocalRadius?: number | null;
    wifeFocalX?: number | null;
    wifeFocalY?: number | null;
    wifeFocalRadius?: number | null;
};

function mockFetch(people: PersonResult[], families: FamilyRow[] = []) {
    const fetchMock = vi.fn(async (url: string) => ({
        ok: true,
        json: async () => (url.includes('/api/people/search') ? { people } : { families }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function urlsFrom(fetchMock: ReturnType<typeof vi.fn>): string[] {
    return fetchMock.mock.calls.map((c) => c[0] as string);
}

// Every query below is synchronous `getBy*`: the component's own 200ms debounce is
// driven by fake timers, and testing-library's `findBy*` polls on real timers that
// never advance while they are installed.
async function openAndType(text: string, ms = 300) {
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: text } });
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
    return input;
}

// ---- Tests ------------------------------------------------------------------

describe('GlobalSearch', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        treeState.activeTreeId = 7;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('searches families server-side instead of listing the whole tree', async () => {
        const fetchMock = mockFetch([], []);
        render(<GlobalSearch />);
        await openAndType('doe');

        const urls = urlsFrom(fetchMock);
        expect(urls.some((u) => u.includes('/api/families/search'))).toBe(true);
        // The regression this guards: `families.list()` fetched every family in the
        // tree on each debounce tick and filtered by name in JS.
        expect(urls.some((u) => /\/api\/families(\?|$)/.test(u))).toBe(false);
    });

    it('passes the query and active tree to both search endpoints', async () => {
        const fetchMock = mockFetch([], []);
        render(<GlobalSearch />);
        await openAndType('doe');

        const urls = urlsFrom(fetchMock);
        const people = urls.find((u) => u.includes('/api/people/search'))!;
        const families = urls.find((u) => u.includes('/api/families/search'))!;
        expect(people).toContain('q=doe');
        expect(people).toContain('treeId=7');
        expect(families).toContain('q=doe');
        expect(families).toContain('treeId=7');
    });

    it('renders a person thumbnail from the primary media the search already returns', async () => {
        mockFetch([makePerson({ PrimaryMediaId: 42, FocalX: 40, FocalY: 60 })]);
        render(<GlobalSearch />);
        await openAndType('jane');

        const img = screen.getByTestId('profile-image');
        expect(img).toHaveAttribute('data-media-id', '42');
    });

    it('groups results under type headers and names a parent or partner (#768)', async () => {
        mockFetch(
            [
                makePerson({ Id: 1, ParentName1: 'Rowan Arbor', ParentName2: 'Hazel Bracken' }),
                makePerson({ Id: 2, PartnerName: 'Linden Vale' }),
            ],
            [{ Id: 9, husbandName: 'Rowan Arbor', wifeName: 'Hazel Bracken', MarriageDate: null }],
        );
        render(<GlobalSearch />);
        await openAndType('jane');

        const people = screen.getByRole('group', { name: 'People' });
        expect(within(people).getAllByRole('option')).toHaveLength(2);
        expect(screen.getByRole('group', { name: 'Families' })).toBeInTheDocument();
        expect(screen.getByText(/child of Rowan Arbor & Hazel Bracken/)).toBeInTheDocument();
        expect(screen.getByText(/partner of Linden Vale/)).toBeInTheDocument();
        expect(screen.queryByText('Person')).toBeNull();
    });

    it('shows a compact lifespan instead of a raw ISO date (#700, #766)', async () => {
        mockFetch([makePerson({ BirthDate: '1889-02-15', DeathDate: '1960-02-20' })]);
        render(<GlobalSearch />);
        await openAndType('jane');

        const lifespan = screen.getByText('1889 – 1960');
        // Amber `date-mono` on a plain row; the selected (first) row keeps only the mono face.
        expect(lifespan.className).toMatch(/mono/);
        expect(screen.queryByText(/1889-02-15/)).toBeNull();
    });

    it('falls back to the initials disc for a person with no photo', async () => {
        mockFetch([makePerson({ FirstName: 'Ada', LastName: 'Byron' })]);
        render(<GlobalSearch />);
        await openAndType('ada');

        expect(screen.queryByTestId('profile-image')).not.toBeInTheDocument();
        expect(screen.getByText('AB')).toBeInTheDocument();
    });

    it('keeps the row name as the only accessible name for the result', async () => {
        mockFetch([makePerson({ PrimaryMediaId: 42 })]);
        render(<GlobalSearch />);
        await openAndType('jane');

        // The avatar is decorative — the option's name comes from the row text, so
        // adding a thumbnail must not introduce a second reading of the name.
        const option = screen.getByRole('option');
        expect(option).toHaveTextContent('Jane Doe');
        expect(screen.getByTestId('profile-image')).toHaveAttribute('alt', '');
    });

    it('shows both partner photos on a family row', async () => {
        mockFetch([], [{
            Id: 9,
            husbandName: 'John Doe',
            wifeName: 'Jane Doe',
            MarriageDate: null,
            husbandMediaId: 11,
            wifeMediaId: 12,
        }]);
        render(<GlobalSearch />);
        await openAndType('doe');

        const mediaIds = screen.getAllByTestId('profile-image').map((img) => img.getAttribute('data-media-id'));
        expect(mediaIds).toEqual(['11', '12']);
    });

    it('keeps the two-disc pair for a family with only one known partner', async () => {
        mockFetch([], [{ Id: 9, husbandName: 'John Doe', wifeName: null, MarriageDate: null, husbandMediaId: 11 }]);
        render(<GlobalSearch />);
        await openAndType('doe');

        // Only the known partner has a face, but the missing one still holds its
        // slot: a lone disc would make the row indistinguishable from a person.
        expect(screen.getAllByTestId('profile-image')).toHaveLength(1);
        expect(screen.getByText('JD')).toBeInTheDocument();
        expect(screen.getByTestId('search-avatar-placeholder')).toHaveTextContent('?');
    });

    it('gives the placeholder no accessible content of its own', async () => {
        mockFetch([], [{ Id: 9, husbandName: null, wifeName: 'Jane Roe', MarriageDate: null }]);
        render(<GlobalSearch />);
        await openAndType('roe');

        const option = screen.getByRole('option');
        expect(option).toHaveTextContent('Jane Roe');
        expect(screen.getByTestId('search-avatar-placeholder')).toHaveAttribute('aria-hidden', 'true');
    });

    it('shows no placeholder on a person row', async () => {
        mockFetch([makePerson()]);
        render(<GlobalSearch />);
        await openAndType('jane');

        expect(screen.queryByTestId('search-avatar-placeholder')).not.toBeInTheDocument();
    });

    it('falls back to partner initials when a family has no photos', async () => {
        mockFetch([], [{ Id: 9, husbandName: 'John Doe', wifeName: 'Jane Roe', MarriageDate: null }]);
        render(<GlobalSearch />);
        await openAndType('doe');

        expect(screen.queryByTestId('profile-image')).not.toBeInTheDocument();
        expect(screen.getByText('JD')).toBeInTheDocument();
        expect(screen.getByText('JR')).toBeInTheDocument();
    });

    it('renders family results alongside people', async () => {
        mockFetch(
            [makePerson()],
            [{ Id: 9, husbandName: 'John Doe', wifeName: 'Jane Doe', MarriageDate: '1935-06-01' }]
        );
        render(<GlobalSearch />);
        await openAndType('doe');

        expect(screen.getByText('John Doe & Jane Doe')).toBeInTheDocument();
        expect(screen.getAllByRole('option')).toHaveLength(2);
    });

    it('hides old-tree results before the replacement search completes', async () => {
        mockFetch([makePerson()]);
        const view = render(<GlobalSearch />);
        await openAndType('jane');
        expect(screen.getByText('Jane Doe')).toBeInTheDocument();

        treeState.activeTreeId = 8;
        view.rerender(<GlobalSearch />);

        // The old row must not remain actionable during the debounce/fetch gap.
        expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
        expect(screen.getByText('Searching…')).toBeInTheDocument();
    });

    it('returns focus to the trigger when Escape closes it (#690, INT-2)', () => {
        render(
            <>
                <button type="button" onClick={() => document.dispatchEvent(new CustomEvent('open-global-search'))}>open search</button>
                <GlobalSearch />
            </>,
        );
        const trigger = screen.getByRole('button', { name: 'open search' });
        trigger.focus();
        fireEvent.click(trigger);
        expect(screen.getByRole('combobox')).toHaveFocus();
        fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });
});
