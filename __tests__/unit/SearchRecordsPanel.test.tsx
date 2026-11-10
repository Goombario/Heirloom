/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const h = vi.hoisted(() => ({ openInSystemBrowser: vi.fn(() => Promise.resolve()) }));

// The desktop path stops the browser following the link, which happy-dom can't open.
vi.mock('@/lib/desktop', () => ({
    isDesktopApp: () => true,
    isWebUrl: (url: string) => /^https?:\/\//i.test(url),
    openInSystemBrowser: h.openInSystemBrowser,
}));
vi.mock('next-intl', () => ({
    useTranslations: () => (key: string, values?: Record<string, unknown>) =>
        values ? `${key}:${Object.values(values).join(',')}` : key,
}));

import { SearchRecordsPanel } from '@/app/components/research/SearchRecordsPanel';
import { personResearchSubject } from '@/lib/research/subject';

const subject = personResearchSubject(
    {
        FirstName: 'Edith May', LastName: 'Hollis', Sex: 'F', BirthDate: 'ABT 1868', BirthPlace: 'Maidstone, Kent, England',
        DeathDate: '14 FEB 1931', DeathPlace: 'Buffalo, Erie, New York, USA', IsDeceased: 1,
        spouses: [{ person: { FirstName: 'Walter', LastName: 'Ashby' }, family: { Id: 40, MarriageDate: '1890', MarriagePlace: null } }],
    },
    [{ Type: 'Married', Name: 'Edith Ashby', FromDate: '1890' }],
    'PersonDeath',
    1,
    2026,
)!;

const familySearch = () => new URL(screen.getByRole('link', { name: 'open_site:FamilySearch' }).getAttribute('href')!);

describe('SearchRecordsPanel', () => {
    it('sends the fact details in each site link', () => {
        render(<SearchRecordsPanel subject={subject} canCite />);
        const url = familySearch();
        expect(url.searchParams.get('q.givenName')).toBe('Edith May');
        expect(url.searchParams.get('q.surname')).toBe('Ashby');
        expect(screen.getByRole('heading', { name: 'details_title' })).toBeInTheDocument();
        expect(screen.getByText('readiness.ready')).toBeInTheDocument();
        // Chronicling America is offered for a death in the USA, with its "Mrs." alternate.
        expect(screen.getByRole('link', { name: 'open_site:Chronicling America' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /^open_alternate:Chronicling America,/ })).toBeInTheDocument();
    });

    it('edits a chip in place, and the links follow', async () => {
        const user = userEvent.setup();
        render(<SearchRecordsPanel subject={subject} canCite />);
        const chip = screen.getByRole('button', { name: /details\.surname\s*Ashby/ });
        await user.click(chip);
        expect(chip).toHaveAttribute('aria-expanded', 'true');
        const editor = screen.getByRole('group', { name: 'edit_detail:details.surname' });
        const input = within(editor).getByRole('textbox', { name: 'editor.surname' });
        expect(input).toHaveFocus();
        // The maiden surname is one tap away.
        await user.click(within(editor).getByRole('button', { name: 'Hollis' }));
        expect(familySearch().searchParams.get('q.surname')).toBe('Hollis');

        await user.clear(input);
        await user.type(input, 'Ashbee{Enter}');
        expect(screen.queryByRole('group', { name: 'edit_detail:details.surname' })).not.toBeInTheDocument();
        expect(familySearch().searchParams.get('q.surname')).toBe('Ashbee');
        expect(screen.getByRole('button', { name: /details\.surname\s*Ashbee/ })).toHaveFocus();
    });

    it('leaves a detail out with × and adds it back from the dashed chip', async () => {
        const user = userEvent.setup();
        render(<SearchRecordsPanel subject={subject} canCite />);
        await user.click(screen.getByRole('button', { name: 'leave_out:details.given' }));
        expect(familySearch().searchParams.has('q.givenName')).toBe(false);
        expect(screen.getByText('readiness.thin')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'restore_detail:details.given' }));
        expect(familySearch().searchParams.get('q.givenName')).toBe('Edith May');
    });

    it('edits the sex, and closes the editor on Escape', async () => {
        const user = userEvent.setup();
        render(<SearchRecordsPanel subject={subject} canCite />);
        await user.click(screen.getByRole('button', { name: /details\.sex\s*sex_F/ }));
        await user.click(screen.getByRole('radio', { name: 'sex_M' }));
        expect(familySearch().searchParams.get('q.sex')).toBe('Male');
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('group', { name: 'edit_detail:details.sex' })).not.toBeInTheDocument();
    });

    it('asks for the outcome after opening a site, and "Nothing found" only marks the row', async () => {
        const user = userEvent.setup();
        const onFound = vi.fn();
        render(<SearchRecordsPanel subject={subject} canCite onFound={onFound} />);
        expect(screen.queryByRole('button', { name: 'found_it' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('link', { name: 'open_site:FamilySearch' }));
        expect(h.openInSystemBrowser).toHaveBeenCalledWith(familySearch().toString());
        expect(screen.getByText('· state_opened')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'nothing_found' }));
        expect(screen.getByText('· state_none')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'found_it' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('link', { name: 'open_site:Find a Grave' }));
        await user.click(screen.getByRole('button', { name: 'found_it' }));
        expect(onFound).toHaveBeenCalledWith(expect.objectContaining({ id: 'findagrave' }), 'death');
    });

    it('hides the outcome buttons from a viewer', async () => {
        const user = userEvent.setup();
        render(<SearchRecordsPanel subject={subject} canCite={false} />);
        await user.click(screen.getByRole('link', { name: 'open_site:FamilySearch' }));
        expect(screen.queryByRole('button', { name: 'found_it' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'nothing_found' })).not.toBeInTheDocument();
    });

    it('marks a cited site', () => {
        render(<SearchRecordsPanel subject={subject} canCite cited={new Set(['familysearch'])} />);
        expect(screen.getByText('· state_cited')).toBeInTheDocument();
    });

    it('shows the living warning above the footer, and folds the rest under More', async () => {
        const user = userEvent.setup();
        render(<SearchRecordsPanel subject={{ ...subject, mayBeLiving: true }} canCite />);
        expect(screen.getByText('living_named:Edith')).toBeInTheDocument();
        expect(screen.getByText('footer')).toBeVisible();
        expect(screen.getByText('footer_more')).not.toBeVisible();
        await user.click(screen.getByRole('button', { name: 'more' }));
        expect(screen.getByText('footer_more')).toBeVisible();
    });
});
