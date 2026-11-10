/* eslint-disable @next/next/no-img-element */
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { PersonResult } from '@/lib/db/schema';

// Mock next-intl — not testing translations here. Interpolates {placeholders}
// the way real next-intl does so aria-labels like "Remove {name}" resolve.
const translations: Record<string, string> = {
    born_year: 'b. {year}',
    died_year: 'd. {year}',
    search_for_person: 'Search for a person...',
    remove: 'Remove',
    remove_named: 'Remove {name}',
    male: 'Male',
    female: 'Female',
    unknown_sex: 'Unknown sex',
    unknown: 'Unknown',
    child_of: 'child of {names}',
    partner_of: 'partner of {names}',
};
vi.mock('next-intl', () => ({
    useTranslations: () => (key: string, values?: Record<string, unknown>) => {
        let out = translations[key] ?? key;
        if (values) {
            for (const [k, v] of Object.entries(values)) out = out.replace(`{${k}}`, String(v));
        }
        return out;
    },
}));

// Mock LanguageProvider — not testing locale here
vi.mock('@/app/components/LanguageProvider', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }),
}));

// Mock ProfileImage — it relies on image load events not available in jsdom
vi.mock('@/app/components/ProfileImage', () => ({
    default: ({ alt }: { alt: string }) => <img alt={alt} data-testid="profile-image" />,
}));

// Mock getInitials — pure utility, not under test here
vi.mock('@/lib/utils/initials', () => ({
    getInitials: (first: string | null, last: string | null) =>
        `${first?.[0] ?? ''}${last?.[0] ?? ''}`,
}));

// Resolve getDataClient to the real HttpDataClient synchronously. The production
// getDataClient does `await import('./http')` — a dynamic import whose resolution
// isn't driven by fake timers, so the debounced search never completes under
// vi.useFakeTimers(). The real HttpPeopleClient.search still calls the per-test
// mocked global fetch with the real `/api/people/search?...` URL, so every
// assertion below (URL params, rendered results, onChange) exercises real behavior.
vi.mock('@/lib/data', async () => {
    const { HttpDataClient } = await import('@/lib/data/http');
    const client = new HttpDataClient();
    return { getDataClient: () => Promise.resolve(client) };
});

import PersonPicker from '@/app/components/PersonPicker';

// ---- Fixture ----------------------------------------------------------------

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

// ---- Helpers ----------------------------------------------------------------

function mockFetchWith(people: PersonResult[]) {
    vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ people }),
        })
    );
}

async function typeAndWait(input: HTMLElement, text: string, ms = 350) {
    fireEvent.change(input, { target: { value: text } });
    // advanceTimersByTimeAsync flushes the microtask queue between timer callbacks,
    // so the debounced search's awaited getDataClient() dynamic import + client call resolve.
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

// ---- Tests ------------------------------------------------------------------

describe('PersonPicker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    // 1. Renders with placeholder
    it('renders the search input with the default placeholder', () => {
        render(<PersonPicker value={null} onChange={() => {}} />);
        expect(screen.getByPlaceholderText('Search for a person...')).toBeInTheDocument();
    });

    it('renders the search input with a custom placeholder', () => {
        render(<PersonPicker value={null} onChange={() => {}} placeholder="Find someone" />);
        expect(screen.getByPlaceholderText('Find someone')).toBeInTheDocument();
    });

    // 2. Does not search under 2 chars
    it('does not call fetch when query is 1 character', async () => {
        mockFetchWith([]);
        render(<PersonPicker value={null} onChange={() => {}} />);
        const input = screen.getByRole('combobox');
        await typeAndWait(input, 'A');
        expect(fetch).not.toHaveBeenCalled();
    });

    // 3. Calls search API on 2+ chars
    it('calls /api/people/search with q and limit=10 when 2+ chars typed', async () => {
        mockFetchWith([]);
        render(<PersonPicker value={null} onChange={() => {}} />);
        const input = screen.getByRole('combobox');
        await typeAndWait(input, 'Jo');
        expect(fetch).toHaveBeenCalledOnce();
        const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(url).toContain('/api/people/search');
        expect(url).toContain('q=Jo');
        expect(url).toContain('limit=10');
    });

    // 4. treeId appended
    it('appends treeId to the search URL when provided', async () => {
        mockFetchWith([]);
        render(<PersonPicker value={null} onChange={() => {}} treeId={42} />);
        const input = screen.getByRole('combobox');
        await typeAndWait(input, 'Jo');
        const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(url).toContain('treeId=42');
    });

    // 5. Shows results
    it('shows result rows when the API returns people', async () => {
        const person = makePerson({ FirstName: 'Jane', LastName: 'Doe' });
        mockFetchWith([person]);
        render(<PersonPicker value={null} onChange={() => {}} />);
        const input = screen.getByRole('combobox');
        await typeAndWait(input, 'Ja');
        expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });

    // 6. showSex shows sex label
    it('shows "Female" in the result when showSex is true and Sex is "F"', async () => {
        const person = makePerson({ Sex: 'F' });
        mockFetchWith([person]);
        render(<PersonPicker value={null} onChange={() => {}} showSex />);
        const input = screen.getByRole('combobox');
        await typeAndWait(input, 'Ja');
        expect(screen.getByText(/Female/)).toBeInTheDocument();
    });

    // 7. showDates shows year
    it('shows the birth year in the result when showDates is true', async () => {
        const person = makePerson({ BirthDate: '1913-01-01' });
        mockFetchWith([person]);
        render(<PersonPicker value={null} onChange={() => {}} showDates />);
        const input = screen.getByRole('combobox');
        await typeAndWait(input, 'Ja');
        expect(screen.getByText(/1913/)).toBeInTheDocument();
    });

    // 8. Single-select: selecting fires onChange
    it('calls onChange with the PersonResult when a result is clicked (single mode)', async () => {
        const person = makePerson();
        mockFetchWith([person]);
        const onChange = vi.fn();
        render(<PersonPicker value={null} onChange={onChange} />);
        const input = screen.getByRole('combobox');
        await typeAndWait(input, 'Ja');
        const resultButton = screen.getByRole('option', { name: /Jane Doe/ });
        fireEvent.mouseDown(resultButton);
        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenCalledWith(person);
    });

    // 9. Single-select: selected person shows pill
    it('hides the input and shows the person name as a pill when a value is set', () => {
        const person = makePerson({ FirstName: 'Jane', LastName: 'Doe' });
        render(<PersonPicker value={person} onChange={() => {}} />);
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });

    // 10. Single-select: Remove clears value
    it('calls onChange(null) when Remove is clicked in single mode', () => {
        const person = makePerson();
        const onChange = vi.fn();
        render(<PersonPicker value={person} onChange={onChange} />);
        const removeBtn = screen.getByRole('button', { name: /Remove/i });
        fireEvent.click(removeBtn);
        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenCalledWith(null);
    });

    // 11. Multi-select: selecting adds to array
    it('calls onChange with an array containing the person when selected in multi mode', async () => {
        const person = makePerson();
        mockFetchWith([person]);
        const onChange = vi.fn();
        render(<PersonPicker multiple value={[]} onChange={onChange} />);
        const input = screen.getByRole('combobox');
        await typeAndWait(input, 'Ja');
        const resultButton = screen.getByRole('option', { name: /Jane Doe/ });
        fireEvent.mouseDown(resultButton);
        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenCalledWith([person]);
    });

    // 12. Multi-select: × removes from array
    it('calls onChange with the person removed when × is clicked on a pill in multi mode', () => {
        const person1 = makePerson({ Id: 1, FirstName: 'Jane', LastName: 'Doe' });
        const person2 = makePerson({ Id: 2, FirstName: 'John', LastName: 'Smith' });
        const onChange = vi.fn();
        render(<PersonPicker multiple value={[person1, person2]} onChange={onChange} />);
        // Click × on Jane Doe's pill
        const removePill = screen.getByLabelText('Remove Jane Doe');
        fireEvent.click(removePill);
        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenCalledWith([person2]);
    });

    // 13. excludeIds filters results
    it('does not show a person whose Id is in excludeIds', async () => {
        const person1 = makePerson({ Id: 1, FirstName: 'Jane', LastName: 'Doe' });
        const person2 = makePerson({ Id: 2, FirstName: 'John', LastName: 'Smith' });
        mockFetchWith([person1, person2]);
        render(<PersonPicker value={null} onChange={() => {}} excludeIds={[1]} />);
        const input = screen.getByRole('combobox');
        await typeAndWait(input, 'Jo');
        expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
        expect(screen.getByText('John Smith')).toBeInTheDocument();
    });

    // 14. disabled prop
    it('hides the search input when disabled is true', () => {
        render(<PersonPicker value={null} onChange={() => {}} disabled />);
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('hides the Remove button when disabled is true in single mode', () => {
        const person = makePerson();
        render(<PersonPicker value={person} onChange={() => {}} disabled />);
        expect(screen.queryByRole('button', { name: /Remove/i })).not.toBeInTheDocument();
    });

    // 15. Fetch error: 401 shows 'Session expired'
    it('shows "Session expired" when the API returns 401', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
        render(<PersonPicker value={null} onChange={() => {}} />);
        const input = screen.getByRole('combobox');
        await typeAndWait(input, 'Jo');
        expect(screen.getByText('Session expired')).toBeInTheDocument();
    });

    // 16. Fetch error: non-401 shows 'Search failed'
    it('shows "Search failed" when the API returns a non-401 error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
        render(<PersonPicker value={null} onChange={() => {}} />);
        const input = screen.getByRole('combobox');
        await typeAndWait(input, 'Jo');
        expect(screen.getByText('Search failed')).toBeInTheDocument();
    });

    // 17. Person with no name renders '(Unknown)'
    it('renders "(Unknown)" in the result row when FirstName and LastName are both null', async () => {
        const person = makePerson({ FirstName: null, LastName: null });
        mockFetchWith([person]);
        render(<PersonPicker value={null} onChange={() => {}} />);
        const input = screen.getByRole('combobox');
        await typeAndWait(input, 'Ja');
        expect(screen.getByText('(Unknown)')).toBeInTheDocument();
    });

    // #793 (task audit ED-9): same-named people are told apart by their parents,
    // else a partner, the same line global search shows.
    it('shows parents, else a partner, under same-named results', async () => {
        mockFetchWith([
            makePerson({ Id: 1, FirstName: 'Ксения', LastName: 'Белозёрова', ParentName1: 'Иван Белозёров', ParentName2: 'Анна Орлова' }),
            makePerson({ Id: 2, FirstName: 'Ксения', LastName: 'Белозёрова', PartnerName: 'Пётр Тихомиров' }),
        ]);
        render(<PersonPicker value={null} onChange={() => {}} />);
        await typeAndWait(screen.getByRole('combobox'), 'Ксения');
        expect(screen.getByText('child of Иван Белозёров & Анна Орлова')).toBeInTheDocument();
        expect(screen.getByText('partner of Пётр Тихомиров')).toBeInTheDocument();
    });

    // #793 (task audit MD-1): Enter picked a row the user could not see was
    // chosen. Now Enter picks only the highlighted row, announced through
    // aria-activedescendant, and does nothing when no row is highlighted.
    it('Enter picks the highlighted option and does nothing with none highlighted', async () => {
        const onChange = vi.fn();
        mockFetchWith([
            makePerson({ Id: 1, FirstName: 'Никифор', LastName: 'Vale' }),
            makePerson({ Id: 2, FirstName: 'Порфирий', LastName: 'Иванович' }),
        ]);
        render(<PersonPicker value={null} onChange={onChange} />);
        const input = screen.getByRole('combobox');
        input.focus();
        await typeAndWait(input, 'Порфирий');

        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onChange).not.toHaveBeenCalled();
        expect(input).not.toHaveAttribute('aria-activedescendant');

        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        const options = screen.getAllByRole('option');
        expect(input).toHaveAttribute('aria-activedescendant', options[1].id);
        expect(options[1]).toHaveAttribute('aria-selected', 'true');
        expect(options[0]).toHaveAttribute('aria-selected', 'false');
        // Focus never leaves the input while the arrows move the highlight.
        expect(document.activeElement).toBe(input);

        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange.mock.calls[0][0].Id).toBe(2);
    });

    it('ArrowUp from the first option clears the highlight, and hover moves it', async () => {
        mockFetchWith([makePerson({ Id: 1 }), makePerson({ Id: 2, FirstName: 'John' })]);
        render(<PersonPicker value={null} onChange={() => {}} />);
        const input = screen.getByRole('combobox');
        await typeAndWait(input, 'Jo');
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'ArrowUp' });
        expect(input).not.toHaveAttribute('aria-activedescendant');
        fireEvent.mouseEnter(screen.getAllByRole('option')[1]);
        expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id);
    });

    it('Enter with the list open does not submit a surrounding form', async () => {
        const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
        mockFetchWith([makePerson()]);
        render(<form onSubmit={onSubmit}><PersonPicker value={null} onChange={() => {}} /></form>);
        const input = screen.getByRole('combobox');
        await typeAndWait(input, 'Ja');
        const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        input.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    // 18. Single-select selected state: bordered row with an outline-variant Remove
    it('single-select selected state renders a bordered row with an outline Remove (not a pill)', () => {
        const person = makePerson({ Id: 1, FirstName: 'Albert', LastName: '' });
        render(<PersonPicker value={person} onChange={vi.fn()} />);
        const removeBtn = screen.getByRole('button', { name: /Remove/i });
        // The Remove control is the <Button variant="outline"> primitive — assert its
        // outline-variant marker classes (bg-transparent + the control-border edge,
        // #694), not the retired `btn-outline` bespoke class.
        expect(removeBtn).toHaveClass('bg-transparent', 'border-[color:var(--color-control-border,var(--color-border))]');
    });
});
